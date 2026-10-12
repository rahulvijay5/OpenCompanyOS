import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSqlClient, schema } from "@opencompanyos/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { buildContext } from "../build.js";
import { sourcePrefixForEvidence } from "../evidence.js";
import { resolveEvidenceKind, resolveQueryIntent } from "../intent.js";
import { issueNumbers } from "../resolve.js";
import {
  EVALUATION_CLOCK,
  mean,
  scoreSuiteQuestion,
  type QuestionOutcome,
  type SuiteQuestion,
} from "./context-quality-v2-score.js";
import { resolveEvalDatabaseUrl } from "./database.js";
import {
  FUSION_METHOD,
  assembleExperimentArms,
  findConstraintViolations,
  type ConstraintViolation,
  type EvidenceFact,
  type ScoredSource,
} from "./hybrid-arms.js";
import {
  EVAL_DATABASE_NAME,
  EVAL_REPOSITORY,
  EVAL_TENANT_SLUG,
} from "./local-embedding.js";
import { localSemanticStatement } from "./local-semantic-search.js";

const root = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../eval/context-quality",
);
const suitePath = path.join(root, "context-quality-v2/questions.json");
const reportFile = "hybrid-retrieval-v1-embeddinggemma.json";
const blockedReports = new Set([
  "context-quality-v2-baseline.json",
  "context-quality-v2-branch-identifier.json",
]);

type SuiteFile = { questions: SuiteQuestion[] };

type ArmName = "A" | "B" | "C" | "D";

export async function runHybridRetrievalV1(env: NodeJS.ProcessEnv = process.env) {
  const resolution = resolveEvalDatabaseUrl(env);
  if (resolution.status !== "ready") {
    throw new Error(resolution.reason);
  }
  const suite = JSON.parse(await readFile(suitePath, "utf8")) as SuiteFile;
  const sql = createSqlClient(resolution.url);
  const db = drizzle(sql, { schema });
  try {
    const names = await sql<{ name: string }[]>`select current_database() as name`;
    const database = names[0]?.name ?? "unknown";
    if (database !== EVAL_DATABASE_NAME) {
      throw new Error(`eval_database_rejected:${database}`);
    }
    const tenant = await db.query.tenants.findFirst({
      where: eq(schema.tenants.slug, EVAL_TENANT_SLUG),
    });
    const repository = await db.query.repositories.findFirst({
      where: eq(schema.repositories.tenantId, tenant?.id ?? ""),
    });
    if (!tenant || !repository || repository.fullName !== EVAL_REPOSITORY) {
      throw new Error("eval_repository_missing");
    }
    const identity = await sql<
      { chunks: number; questions: number; gemini_chunks: number; gemini_questions: number; stored_embeddings: number }[]
    >`
      select
        (select count(*) from eval_local_chunk_embeddings
          where experiment = 'embeddinggemma-ollama-v1'
            and model_name = 'embeddinggemma'
            and preprocessing = 'embeddinggemma-document-v1'
            and normalization_method = 'l2-unit'
            and dimensions = 768)::int as chunks,
        (select count(*) from eval_local_query_embeddings
          where experiment = 'embeddinggemma-ollama-v1'
            and model_name = 'embeddinggemma'
            and preprocessing = 'embeddinggemma-query-v1'
            and normalization_method = 'l2-unit'
            and dimensions = 768)::int as questions,
        (select count(*) from eval_chunk_embeddings)::int as gemini_chunks,
        (select count(*) from eval_query_embeddings)::int as gemini_questions,
        (select count(c.embedding) from document_chunks c
          join documents d on d.id = c.document_id
          where d.tenant_id = ${tenant.id})::int as stored_embeddings
    `;
    const check = identity[0];
    if (
      !check ||
      check.chunks !== 634 ||
      check.questions !== 38 ||
      check.gemini_chunks !== 300 ||
      check.gemini_questions !== 38 ||
      check.stored_embeddings !== 0
    ) {
      throw new Error(`local_vector_identity_rejected:${JSON.stringify(check ?? null)}`);
    }

    const questions = [];
    for (const question of suite.questions) {
      const lexicalStarted = Date.now();
      const built = await buildContext(db, {
        tenantId: tenant.id,
        query: question.question,
        config: null,
        ...(question.window
          ? { from: new Date(question.window.from), to: new Date(question.window.to) }
          : {}),
        now: new Date(EVALUATION_CLOCK),
      });
      const lexicalMs = Date.now() - lexicalStarted;
      const evidenceKind = resolveEvidenceKind(question.question);
      const lexical: ScoredSource[] = built.evidence.map((item) => ({
        documentId: item.id,
        sourceId: item.sourceId,
        score: item.score,
      }));
      const range = retrievalWindow(question);
      let semanticMs = 0;
      let semantic: { documentId: string; sourceId: string | null; score: number }[] = [];
      if (evidenceKind) {
        const semanticStarted = Date.now();
        const prefix = sourcePrefixForEvidence(evidenceKind);
        if (prefix) {
          const rows = await db.execute<{ document_id: string; source_id: string | null; score: number }>(
            localSemanticStatement({
              tenantId: tenant.id,
              repositoryIds: [repository.id],
              questionId: question.id,
              sourceIdPrefix: prefix,
              subjectNumbers: issueNumbers(question.question),
              since: range.from,
              until: range.to,
            }),
          );
          semantic = rows.map((row) => ({
            documentId: row.document_id,
            sourceId: row.source_id,
            score: Number(row.score),
          }));
        }
        semanticMs = Date.now() - semanticStarted;
      }
      const arms = assembleExperimentArms({
        semanticApplies: evidenceKind !== undefined,
        lexical,
        semantic,
      });
      const armIds: Record<ArmName, string[]> = {
        A: arms.A,
        B: arms.B,
        C: arms.C,
        D: arms.D,
      };
      const facts = await loadFacts(sql, tenant.id, [...new Set(Object.values(armIds).flat())]);
      const prefix = evidenceKind ? sourcePrefixForEvidence(evidenceKind) ?? null : null;
      const from = range.from;
      const to = range.to;
      const scoredArms = (["A", "B", "C", "D"] as const).map((arm) => {
        const sourceIds = armIds[arm];
        const outcome: QuestionOutcome = {
          evidenceSourceIds: sourceIds,
          subjectStatus: built.subject.status,
          currentStateSourceIds: built.currentState.map((item) => item.sourceId),
          currentStateTitles: built.currentState.map((item) => item.title ?? ""),
          insufficientEvidence: sourceIds.length === 0,
        };
        return {
          arm,
          sourceIds,
          expectedSourceIds: question.expectedSourceIds,
          constraintViolations: findConstraintViolations({
            sourceIds,
            facts,
            sourceIdPrefix: prefix,
            subjectNumbers: issueNumbers(question.question),
            from,
            to,
          }),
          latencyMs: arm === "A" ? lexicalMs : semanticMs,
          ...scoreSuiteQuestion(question, outcome),
        };
      });
      questions.push({
        id: question.id,
        category: question.category,
        labelQuality: question.labelQuality,
        disposition: question.disposition,
        intent: resolveQueryIntent(question.question) ?? "metadata",
        fusionMethod: arms.fusionMethod,
        arms: scoredArms,
      });
    }

    return {
      version: 1,
      fusionMethod: FUSION_METHOD,
      fusionLimitation:
        "Arm C fuses Arm A's capped evidence with semantic hits. It does not test fusion against the full lexical candidate ranking.",
      evaluationClock: EVALUATION_CLOCK,
      database,
      tenantSlug: EVAL_TENANT_SLUG,
      model: "embeddinggemma",
      experiment: "embeddinggemma-ollama-v1",
      writes: "none",
      hostedApiCalls: 0,
      questionCount: questions.length,
      metrics: {
        A: summarizeArms(questions, "A"),
        B: summarizeArms(questions, "B"),
        C: summarizeArms(questions, "C"),
        D: summarizeArms(questions, "D"),
      },
      questions,
    };
  } finally {
    await sql.end();
  }
}

function retrievalWindow(question: SuiteQuestion): { from: Date | null; to: Date | null } {
  if (question.window) {
    return { from: new Date(question.window.from), to: new Date(question.window.to) };
  }
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  return { from: new Date(new Date(EVALUATION_CLOCK).getTime() - weekMs), to: null };
}

async function loadFacts(
  sql: ReturnType<typeof createSqlClient>,
  tenantId: string,
  sourceIds: string[],
) {
  const ids = sourceIds.filter((id) => !id.startsWith("unmapped:"));
  const facts = new Map<string, EvidenceFact>();
  if (ids.length === 0) {
    return facts;
  }
  const rows = await sql<
    {
      source_event_id: string;
      event_time: Date | null;
      issue_number: string | null;
      pull_request_number: string | null;
      subject_number: string | null;
    }[]
  >`
    select source_event_id, event_time, payload->>'issueNumber' as issue_number,
           payload->>'pullRequestNumber' as pull_request_number,
           payload->>'number' as subject_number
    from events
    where tenant_id = ${tenantId}
      and source_event_id in ${sql(ids)}
  `;
  for (const row of rows) {
    facts.set(row.source_event_id, {
      eventTime: row.event_time ? new Date(row.event_time).toISOString() : null,
      issueNumber: row.issue_number,
      pullRequestNumber: row.pull_request_number,
      subjectNumber: row.subject_number,
    });
  }
  return facts;
}

function summarizeArms(
  questions: Array<{ arms: Array<{ arm: ArmName; metric: string; passed: boolean | null; recall: number | null; precision: number | null; constraintViolations: ConstraintViolation[] }> }>,
  arm: ArmName,
) {
  const rows = questions.map((question) => question.arms.find((item) => item.arm === arm)).filter((row) => row !== undefined);
  const byMetric = (metric: string) => rows.filter((row) => row.metric === metric);
  const summarize = (metricRows: typeof rows, precision: boolean) => {
    const recalls = metricRows.flatMap((row) => (row.recall === null ? [] : [row.recall]));
    const precisions = precision
      ? metricRows.flatMap((row) => (row.precision === null ? [] : [row.precision]))
      : [];
    return {
      denominator: metricRows.length,
      passed: metricRows.filter((row) => row.passed === true).length,
      failed: metricRows.filter((row) => row.passed === false).length,
      meanRecall: mean(recalls),
      meanPrecision: precision ? mean(precisions) : null,
    };
  };
  return {
    precisionRecall: summarize(byMetric("precision_recall"), true),
    partialRecall: summarize(byMetric("partial_recall"), false),
    verifiedEmptyAbstention: {
      denominator: byMetric("verified_empty_abstention").length,
      passed: byMetric("verified_empty_abstention").filter((row) => row.passed === true).length,
      failed: byMetric("verified_empty_abstention").filter((row) => row.passed === false).length,
    },
    windowContract: {
      denominator: byMetric("window_contract").length,
      passed: byMetric("window_contract").filter((row) => row.passed === true).length,
      failed: byMetric("window_contract").filter((row) => row.passed === false).length,
    },
    unknownIdentifier: {
      denominator: byMetric("unknown_identifier").length,
      passed: byMetric("unknown_identifier").filter((row) => row.passed === true).length,
      failed: byMetric("unknown_identifier").filter((row) => row.passed === false).length,
    },
    unscored: byMetric("unscored").length,
    constraintViolations: rows.reduce((sum, row) => sum + row.constraintViolations.length, 0),
  };
}

const isEntry = process.argv[1]?.endsWith("hybrid-retrieval-v1.ts") === true;
if (isEntry) {
  const requested = process.argv[2] ?? reportFile;
  if (blockedReports.has(requested) || requested !== reportFile) {
    throw new Error(`report_path_rejected:${requested}`);
  }
  const report = await runHybridRetrievalV1();
  const reportPath = path.join(root, "reports", reportFile);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ questions: report.questionCount, metrics: report.metrics, writes: report.writes }));
}
