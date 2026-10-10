import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { schema, createSqlClient } from "@opencompanyos/db";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { CONTEXT_PACKAGE_VERSION } from "../types.js";
import { resolveEvalDatabaseUrl } from "./database.js";
import {
  SUITE_VERSION,
  checkDatasetIntegrity,
  loadDataset,
  repoRoot,
  summarize,
} from "./dataset.js";
import { REPORT_NOTES, type CaseResult, type EvalReport } from "./report.js";
import { entitySourceIds, scoreQuestion, type ScoredPackage } from "./score.js";
import { cleanupIsolatedRun, createIsolatedRun } from "./seed.js";

export type EvaluationRun = {
  report: EvalReport;
  exitCode: number;
  packages: ScoredPackage[];
};

export async function runContextQualityEvaluation(
  env: NodeJS.ProcessEnv = process.env,
): Promise<EvaluationRun> {
  const dataset = await loadDataset();
  const integrityCases = checkDatasetIntegrity(dataset);
  const integrity = summarize(integrityCases);
  const unsupportedCases: CaseResult[] = dataset.unsupported.map((item) => ({
    id: item.id,
    status: "inconclusive",
    reasons: [`unsupported category: ${item.category}`],
  }));
  const packages: ScoredPackage[] = [];

  const base = {
    suite: "context-quality" as const,
    suiteVersion: SUITE_VERSION,
    contextPackageVersion: CONTEXT_PACKAGE_VERSION,
    referenceTime: dataset.referenceTime,
    llmCalls: 0,
    notes: REPORT_NOTES,
    datasetIntegrity: { ...integrity, cases: integrityCases },
    optionalLlm: {
      status: "not_run" as const,
      llmCalls: 0,
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      inconclusive: 0,
      cases: [],
    },
    unsupported: { ...summarize(unsupportedCases), cases: unsupportedCases },
  };

  if (integrity.failed > 0) {
    const skipped = skipQuestions(dataset.questions.map((question) => question.id), "Dataset integrity failed.");
    const databaseCase: CaseResult = {
      id: "seed-and-score",
      status: "skipped",
      reasons: ["Dataset integrity failed."],
    };
    const report: EvalReport = {
      ...base,
      runId: null,
      contextPackage: { ...summarize(skipped), cases: skipped },
      database: {
        status: "skipped",
        source: null,
        reason: "Dataset integrity failed.",
        ...summarize([databaseCase]),
        cases: [databaseCase],
      },
    };
    return { report, exitCode: exitCodeFor(report), packages };
  }

  const resolution = resolveEvalDatabaseUrl(env);
  if (resolution.status === "skipped") {
    const skipped = skipQuestions(
      dataset.questions.map((question) => question.id),
      resolution.reason,
    );
    const databaseCase: CaseResult = {
      id: "seed-and-score",
      status: "skipped",
      reasons: [resolution.reason],
    };
    const report: EvalReport = {
      ...base,
      runId: null,
      contextPackage: { ...summarize(skipped), cases: skipped },
      database: {
        status: "skipped",
        source: null,
        reason: resolution.reason,
        ...summarize([databaseCase]),
        cases: [databaseCase],
      },
    };
    return { report, exitCode: exitCodeFor(report), packages };
  }

  const sql = createSqlClient(resolution.url);
  const db = drizzle(sql, { schema });
  let run: Awaited<ReturnType<typeof createIsolatedRun>> | null = null;
  try {
    run = await createIsolatedRun(db, dataset.fixtures);
    const facts = new Map(dataset.facts.map((fact) => [fact.id, fact]));
    const sourceByEntityId = await entitySourceIds(db, run.tenantId);
    const cases: CaseResult[] = [];
    for (const question of dataset.questions) {
      const scored = await scoreQuestion({
        db,
        tenantId: run.tenantId,
        userId: run.userId,
        question,
        facts,
        referenceTime: dataset.referenceTime,
        repositoryIds: run.repositoryIds,
        sourceByEntityId,
      });
      cases.push(scored.result);
      if (scored.scored) {
        packages.push(scored.scored);
      }
    }
    const databaseCase: CaseResult = {
      id: "seed-and-score",
      status: "passed",
      reasons: [],
    };
    const sentinel = await db.query.tenants.findFirst({
      where: eq(schema.tenants.id, run.tenantId),
    });
    if (!sentinel) {
      databaseCase.status = "failed";
      databaseCase.reasons.push("evaluation tenant was missing before cleanup");
    }
    const report: EvalReport = {
      ...base,
      runId: run.runId,
      contextPackage: { ...summarize(cases), cases },
      database: {
        status: databaseCase.status === "passed" ? "passed" : "failed",
        source: resolution.source,
        reason: databaseCase.reasons[0] ?? null,
        ...summarize([databaseCase]),
        cases: [databaseCase],
      },
    };
    return { report, exitCode: exitCodeFor(report), packages };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "database integration failed";
    const skipped = skipQuestions(dataset.questions.map((question) => question.id), reason);
    const databaseCase: CaseResult = {
      id: "seed-and-score",
      status: "failed",
      reasons: [reason],
    };
    const report: EvalReport = {
      ...base,
      runId: run?.runId ?? null,
      contextPackage: { ...summarize(skipped), cases: skipped },
      database: {
        status: "failed",
        source: resolution.source,
        reason,
        ...summarize([databaseCase]),
        cases: [databaseCase],
      },
    };
    return { report, exitCode: exitCodeFor(report), packages };
  } finally {
    try {
      if (run) {
        await cleanupIsolatedRun(db, { tenantId: run.tenantId, userId: run.userId });
      }
    } finally {
      await sql.end();
    }
  }
}

export function exitCodeFor(report: EvalReport): number {
  if (report.datasetIntegrity.failed > 0) {
    return 1;
  }
  if (report.database.status === "skipped") {
    return 2;
  }
  if (report.database.status === "failed" || report.contextPackage.failed > 0) {
    return 1;
  }
  if (
    report.contextPackage.total > 0 &&
    report.contextPackage.passed === report.contextPackage.total
  ) {
    return 0;
  }
  return 1;
}

export async function writeEvalReport(report: EvalReport): Promise<string> {
  const directory = path.join(repoRoot(), "eval/context-quality/reports");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, "latest.json");
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  return file;
}

function skipQuestions(ids: readonly string[], reason: string): CaseResult[] {
  return ids.map((id) => ({
    id,
    status: "skipped",
    reasons: [reason],
  }));
}
