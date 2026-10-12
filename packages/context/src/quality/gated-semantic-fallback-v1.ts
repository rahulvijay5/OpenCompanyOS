import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSqlClient, schema } from "@opencompanyos/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { buildContext } from "../build.js";
import { sourcePrefixForEvidence } from "../evidence.js";
import { resolveEvidenceKind } from "../intent.js";
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
  GATED_THRESHOLDS,
  applyGatedFallback,
  thresholdMeetsCriteria,
  type GateCandidate,
  type ThresholdQuestionResult,
} from "./gated-semantic-fallback.js";
import {
  findConstraintViolations,
  type ConstraintViolation,
  type EvidenceFact,
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
const reportFile = "gated-semantic-fallback-v1-embeddinggemma.json";
const blockedReports = new Set([
  "context-quality-v2-baseline.json",
  "context-quality-v2-branch-identifier.json",
  "hybrid-retrieval-v1-embeddinggemma.json",
]);

type SuiteFile = { questions: SuiteQuestion[] };

type ThresholdScore = {
  threshold: number;
  selectedSourceIds: string[];
  rejectedSourceIds: string[];
  abstention: ThresholdQuestionResult["abstention"];
  constraintViolations: ConstraintViolation[];
  expectedSourceIds: string[];
  metric: string;
  passed: boolean | null;
  precision: number | null;
  recall: number | null;
};

type GatedQuestion = {
  id: string;
  category: string;
  labelQuality: string;
  metric: string;
  baselinePassed: boolean | null;
  baselineSourceIds: string[];
  rawCandidates: GateCandidate[];
  bestScore: number | null;
  secondBestScore: number | null;
  margin: number | null;
  marginUsedForSelection: false;
  latencyMs: number;
  thresholds: ThresholdScore[];
};

export async function runGatedSemanticFallbackV1(env: NodeJS.ProcessEnv = process.env) {
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

    const questions: GatedQuestion[] = [];
    for (const question of suite.questions) {
      const started = Date.now();
      const built = await buildContext(db, {
        tenantId: tenant.id,
        query: question.question,
        config: null,
        ...(question.window
          ? { from: new Date(question.window.from), to: new Date(question.window.to) }
          : {}),
        now: new Date(EVALUATION_CLOCK),
      });
      const evidenceKind = resolveEvidenceKind(question.question);
      const discussion = evidenceKind === "issue_comment";
      const lexicalSourceIds = built.evidence.map((item) => item.sourceId);
      const range = retrievalWindow(question);
      let candidates: GateCandidate[] = [];
      if (discussion && lexicalSourceIds.length === 0) {
        const prefix = sourcePrefixForEvidence("issue_comment");
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
          candidates = rows.flatMap((row) =>
            row.source_id
              ? [{ sourceId: row.source_id, score: Number(row.score) }]
              : [{ sourceId: `unmapped:${row.document_id}`, score: Number(row.score) }],
          );
        }
      }
      const latencyMs = Date.now() - started;
      const baseline = scoreQuestion(question, built, lexicalSourceIds);
      const decisions = GATED_THRESHOLDS.map((threshold) => {
        const decision = applyGatedFallback({
          discussion,
          lexicalSourceIds,
          candidates,
          threshold,
        });
        return { decision, scored: scoreQuestion(question, built, decision.selectedSourceIds) };
      });
      const factIds = [
        ...new Set([
          ...lexicalSourceIds,
          ...candidates.map((candidate) => candidate.sourceId),
          ...decisions.flatMap((item) => item.decision.selectedSourceIds),
        ]),
      ];
      const facts = await loadFacts(sql, tenant.id, factIds);
      const prefix = evidenceKind ? sourcePrefixForEvidence(evidenceKind) ?? null : null;
      const thresholds = decisions.map((item) => ({
        threshold: item.decision.threshold,
        selectedSourceIds: item.decision.selectedSourceIds,
        rejectedSourceIds: item.decision.rejected.map((candidate) => candidate.sourceId),
        abstention: item.decision.abstention,
        constraintViolations: findConstraintViolations({
          sourceIds: item.decision.selectedSourceIds,
          facts,
          sourceIdPrefix: prefix,
          subjectNumbers: issueNumbers(question.question),
          from: range.from,
          to: range.to,
        }),
        ...item.scored,
      }));
      questions.push({
        id: question.id,
        category: question.category,
        labelQuality: question.labelQuality,
        metric: baseline.metric,
        baselinePassed: baseline.passed,
        baselineSourceIds: lexicalSourceIds,
        rawCandidates: candidates,
        bestScore: decisions[0]?.decision.bestScore ?? null,
        secondBestScore: decisions[0]?.decision.secondBestScore ?? null,
        margin: decisions[0]?.decision.margin ?? null,
        marginUsedForSelection: false,
        latencyMs,
        thresholds,
      });
    }

    const metrics = Object.fromEntries(
      GATED_THRESHOLDS.map((threshold) => {
        const rows = questions.map((question) => {
          const item = question.thresholds.find((entry) => entry.threshold === threshold);
          if (!item) {
            throw new Error(`threshold_missing:${threshold}`);
          }
          const criteriaRow: ThresholdQuestionResult = {
            id: question.id,
            metric: item.metric,
            passed: item.passed,
            precision: item.precision,
            baselinePassed: question.baselinePassed,
            selectedSourceIds: item.selectedSourceIds,
            expectedSourceIds: item.expectedSourceIds,
            abstention: item.abstention,
            rawCandidateCount: question.rawCandidates.length,
            constraintViolations: item.constraintViolations,
          };
          return { criteriaRow, recall: item.recall };
        });
        return [
          String(threshold),
          {
            ...summarize(rows.map((row) => ({ ...row.criteriaRow, recall: row.recall }))),
            criteria: thresholdMeetsCriteria(rows.map((row) => row.criteriaRow)),
          },
        ];
      }),
    );

    return {
      version: 1,
      thresholds: GATED_THRESHOLDS,
      marginUsedForSelection: false,
      evaluationClock: EVALUATION_CLOCK,
      database,
      tenantSlug: EVAL_TENANT_SLUG,
      model: "embeddinggemma",
      experiment: "embeddinggemma-ollama-v1",
      writes: "none",
      hostedApiCalls: 0,
      questionCount: questions.length,
      metrics,
      questions,
    };
  } finally {
    await sql.end();
  }
}

function scoreQuestion(
  question: SuiteQuestion,
  built: {
    subject: { status: string };
    currentState: { sourceId: string; title: string | null }[];
  },
  sourceIds: readonly string[],
) {
  const outcome: QuestionOutcome = {
    evidenceSourceIds: [...sourceIds],
    subjectStatus: built.subject.status,
    currentStateSourceIds: built.currentState.map((item) => item.sourceId),
    currentStateTitles: built.currentState.map((item) => item.title ?? ""),
    insufficientEvidence: sourceIds.length === 0,
  };
  return {
    expectedSourceIds: question.expectedSourceIds,
    ...scoreSuiteQuestion(question, outcome),
  };
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

function summarize(
  rows: Array<{
    metric: string;
    passed: boolean | null;
    recall: number | null;
    precision: number | null;
    constraintViolations: readonly { reason: string }[];
  }>,
) {
  const byMetric = (metric: string) => rows.filter((row) => row.metric === metric);
  const summarizeMetric = (metricRows: typeof rows, precision: boolean) => {
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
  const count = (metric: string) => {
    const metricRows = byMetric(metric);
    return {
      denominator: metricRows.length,
      passed: metricRows.filter((row) => row.passed === true).length,
      failed: metricRows.filter((row) => row.passed === false).length,
    };
  };
  return {
    precisionRecall: summarizeMetric(byMetric("precision_recall"), true),
    partialRecall: summarizeMetric(byMetric("partial_recall"), false),
    verifiedEmptyAbstention: count("verified_empty_abstention"),
    windowContract: count("window_contract"),
    unknownIdentifier: count("unknown_identifier"),
    unscored: byMetric("unscored").length,
    constraintViolations: rows.reduce((sum, row) => sum + row.constraintViolations.length, 0),
    wrongParent: rows.reduce(
      (sum, row) =>
        sum + row.constraintViolations.filter((violation) => violation.reason === "wrong_parent").length,
      0,
    ),
  };
}

const isEntry = process.argv[1]?.endsWith("gated-semantic-fallback-v1.ts") === true;
if (isEntry) {
  const requested = process.argv[2] ?? reportFile;
  if (blockedReports.has(requested) || requested !== reportFile) {
    throw new Error(`report_path_rejected:${requested}`);
  }
  const report = await runGatedSemanticFallbackV1();
  const reportPath = path.join(root, "reports", reportFile);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({
      questions: report.questionCount,
      metrics: report.metrics,
      writes: report.writes,
    }),
  );
}
