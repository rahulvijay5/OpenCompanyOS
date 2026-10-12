import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSqlClient, schema } from "@opencompanyos/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { buildContext } from "../build.js";
import { resolveQueryIntent } from "../intent.js";
import {
  EVALUATION_CLOCK,
  mean,
  scoreSuiteQuestion,
  type QuestionOutcome,
  type ScoredQuestion,
  type SuiteQuestion,
} from "./context-quality-v2-score.js";
import { resolveEvalDatabaseUrl } from "./database.js";
import {
  EVAL_DATABASE_NAME,
  FASTAPI_FULL_NAME,
  FASTAPI_V2_SLUG,
} from "./import-fastapi-v2.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../eval/context-quality");
const suitePath = path.join(root, "context-quality-v2/questions.json");
const reportFile = process.argv[2] ?? "context-quality-v2-baseline.json";
const reportPath = path.join(root, "reports", path.basename(reportFile));

type SuiteFile = {
  unsupportedCategories: Array<{ category: string; reason: string }>;
  questions: SuiteQuestion[];
};

export async function runContextQualityV2(env: NodeJS.ProcessEnv = process.env) {
  const resolution = resolveEvalDatabaseUrl(env);
  if (resolution.status !== "ready") {
    throw new Error(resolution.reason);
  }
  const suite = JSON.parse(await readFile(suitePath, "utf8")) as SuiteFile;
  if (suite.questions.length < 35 || suite.questions.length > 40) {
    throw new Error(`question_count:${suite.questions.length}`);
  }
  const executedAt = new Date().toISOString();
  const sql = createSqlClient(resolution.url);
  const db = drizzle(sql, { schema });
  try {
    const names = await sql<{ name: string }[]>`select current_database() as name`;
    const database = names[0]?.name ?? "unknown";
    if (database !== EVAL_DATABASE_NAME) {
      throw new Error(`eval_database_rejected:${database}`);
    }
    const tenant = await db.query.tenants.findFirst({
      where: eq(schema.tenants.slug, FASTAPI_V2_SLUG),
    });
    const repository = await db.query.repositories.findFirst({
      where: eq(schema.repositories.tenantId, tenant?.id ?? ""),
    });
    if (!tenant || !repository || repository.fullName !== FASTAPI_FULL_NAME) {
      throw new Error("eval_repository_missing");
    }

    const questions: Array<
      SuiteQuestion &
        QuestionOutcome &
        ScoredQuestion & {
          intent: string;
          latencyMs: number;
          subjectFactTitleMatched: boolean | null;
          answerGeneration: "not_run_no_model";
        }
    > = [];
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
      const latencyMs = Date.now() - started;
      const outcome = {
        evidenceSourceIds: built.evidence.map((item) => item.sourceId),
        subjectStatus: built.subject.status,
        currentStateSourceIds: built.currentState.map((item) => item.sourceId),
        currentStateTitles: built.currentState.map((item) => item.title ?? ""),
        insufficientEvidence: built.uncertainties.some(
          (item) => item.code === "insufficient_evidence",
        ),
      };
      const scored = scoreSuiteQuestion(question, outcome);
      const expectedTitle =
        typeof question.expectedFacts?.title === "string" ? question.expectedFacts.title : null;
      questions.push({
        ...question,
        intent: resolveQueryIntent(question.question) ?? "metadata",
        latencyMs,
        ...outcome,
        subjectFactTitleMatched:
          expectedTitle === null ? null : outcome.currentStateTitles.includes(expectedTitle),
        answerGeneration: "not_run_no_model",
        ...scored,
      });
    }

    const byMetric = (metric: string) => questions.filter((question) => question.metric === metric);
    const precisionRecall = byMetric("precision_recall");
    const partial = byMetric("partial_recall");
    const abstention = byMetric("verified_empty_abstention");
    const windows = byMetric("window_contract");
    const unknown = byMetric("unknown_identifier");
    const unscored = byMetric("unscored");
    const hybrid = questions.filter((question) => question.hybridCandidate);
    const categories = [...new Set(questions.map((question) => question.category))].map(
      (category) => {
        const rows = questions.filter((question) => question.category === category);
        const scoredRows = rows.filter((question) => question.passed !== null);
        return {
          category,
          questions: rows.length,
          scored: scoredRows.length,
          passed: scoredRows.filter((question) => question.passed).length,
          failed: scoredRows.filter((question) => question.passed === false).length,
          unscored: rows.length - scoredRows.length,
        };
      },
    );
    const recommendation = hybrid.length > 0
      ? "A verified answerable discussion misses because the stored comments use different words from the question. That is a reason to try hybrid retrieval on that slice. It is not a reason to treat this corpus as a general quality score. Reviews, issue bodies, commits, and linked issues are missing source data and should not be solved with embeddings."
      : "No verified complete discussion set failed only because the wording differed. Do not start hybrid retrieval on the strength of this run.";

    return {
      version: 2,
      realCorpus: {
        status: "not_run" as const,
        reason:
          "This is a bounded FastAPI slice. It is not production readiness and it is not general retrieval accuracy.",
      },
      evaluationClock: EVALUATION_CLOCK,
      executedAt,
      database,
      tenantSlug: FASTAPI_V2_SLUG,
      modelCalls: 0,
      writes: "none",
      answerGeneration: "not_run_no_model",
      questionCount: questions.length,
      unsupportedCategories: suite.unsupportedCategories,
      denominators: {
        precisionRecall: precisionRecall.length,
        partialRecall: partial.length,
        verifiedEmptyAbstention: abstention.length,
        windowContract: windows.length,
        unknownIdentifier: unknown.length,
        unscored: unscored.length,
      },
      metrics: {
        precisionRecall: summarize(precisionRecall, true),
        partialRecall: summarize(partial, false),
        verifiedEmptyAbstention: passCount(abstention),
        windowContract: passCount(windows),
        unknownIdentifier: passCount(unknown),
      },
      latencyMs: {
        mean: mean(questions.map((question) => question.latencyMs)),
        max: Math.max(...questions.map((question) => question.latencyMs)),
      },
      categories,
      hybridCandidates: hybrid.map((question) => question.id),
      recommendation,
      questions,
    };
  } finally {
    await sql.end();
  }
}

function passCount(rows: Array<{ passed: boolean | null }>) {
  return {
    denominator: rows.length,
    passed: rows.filter((row) => row.passed === true).length,
    failed: rows.filter((row) => row.passed === false).length,
  };
}

function summarize(
  rows: Array<{ passed: boolean | null; recall: number | null; precision: number | null }>,
  includePrecision: boolean,
) {
  const recalls = rows.flatMap((row) => (row.recall === null ? [] : [row.recall]));
  const precisions = includePrecision
    ? rows.flatMap((row) => (row.precision === null ? [] : [row.precision]))
    : [];
  return {
    denominator: rows.length,
    passed: rows.filter((row) => row.passed === true).length,
    failed: rows.filter((row) => row.passed === false).length,
    meanRecall: mean(recalls),
    meanPrecision: includePrecision ? mean(precisions) : null,
    precisionDenominator: includePrecision ? precisions.length : 0,
  };
}

const isEntry = process.argv[1]?.endsWith("context-quality-v2.ts") === true;
if (isEntry) {
  const report = await runContextQualityV2();
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        questions: report.questionCount,
        denominators: report.denominators,
        metrics: report.metrics,
        latencyMs: report.latencyMs,
        hybridCandidates: report.hybridCandidates,
        modelCalls: report.modelCalls,
        evaluationClock: report.evaluationClock,
      },
      null,
      2,
    ),
  );
}
