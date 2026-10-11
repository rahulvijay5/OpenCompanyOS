import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { resolveEvalDatabaseUrl } from "./database.js";
import { runFastapiV2Benchmark } from "./fastapi-v2-benchmark.js";

const embedCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("@opencompanyos/retrieval", async () => {
  const actual = await vi.importActual<typeof import("@opencompanyos/retrieval")>(
    "@opencompanyos/retrieval",
  );
  return {
    ...actual,
    embedTexts: async () => {
      embedCalls.count += 1;
      throw new Error("embedding_called");
    },
  };
});

type ReportShape = Awaited<ReturnType<typeof runFastapiV2Benchmark>>;

function semanticBenchmark(report: ReportShape) {
  return {
    realCorpus: report.realCorpus,
    precision: report.precision,
    comments: report.comments,
    reviews: report.reviews,
    import: report.import,
    metrics: report.metrics,
    questions: report.questions.map((question) => ({
      id: question.id,
      category: question.category,
      query: question.query,
      expectedSourceIds: question.expectedSourceIds,
      fact: question.fact,
      window: question.window,
      verification: question.verification,
      eligible: question.eligible,
      searchEvidenceSourceIds: question.searchEvidenceSourceIds,
      evidenceSourceIds: question.evidenceSourceIds,
      expectedInEvidence: question.expectedInEvidence,
      expectedInEventsOnly: question.expectedInEventsOnly,
      storedInEventsTable: question.storedInEventsTable,
      inPackageEvents: question.inPackageEvents,
      inCurrentState: question.inCurrentState,
      subject: question.subject,
    })),
  };
}

const resolution = resolveEvalDatabaseUrl(process.env);
const corpusDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../eval/context-quality/corpora/fastapi-v2",
);
const frozenPath = path.join(corpusDir, "benchmark-v1-results-lexical-v1.json");
const reproPath = path.join(corpusDir, "benchmark-v1-results-repro.json");

describe.skipIf(resolution.status !== "ready")("fastapi v2 verified benchmark", () => {
  it("checks the imported rows and runs search and buildContext", async () => {
    embedCalls.count = 0;
    const frozenBefore = await readFile(frozenPath);
    const report = await runFastapiV2Benchmark(process.env);
    await writeFile(reproPath, `${JSON.stringify(report, null, 2)}\n`);
    expect(await readFile(frozenPath)).toEqual(frozenBefore);
    const frozen = JSON.parse(frozenBefore.toString()) as ReportShape;
    expect(semanticBenchmark(report)).toEqual(semanticBenchmark(frozen));
    expect(report.metrics.issues.questionLevel).toEqual({
      eligible: 11,
      evidenceHits: 11,
      recall: 1,
    });
    expect(report.metrics.issues.distinctSource).toEqual({
      eligible: 6,
      evidenceHits: 6,
      recall: 1,
    });
    expect(report.metrics.pullRequests.questionLevel).toEqual({
      eligible: 13,
      evidenceHits: 13,
      recall: 1,
    });
    expect(report.metrics.pullRequests.distinctSource).toEqual({
      eligible: 8,
      evidenceHits: 8,
      recall: 1,
    });
    expect(report.database).toBe("opencompanyos_eval");
    expect(report.import.storedSourceIds).toBe(600);
    expect(report.import.missing).toEqual([]);
    expect(report.import.unexpected).toEqual([]);
    expect(report.realCorpus.status).toBe("not_run");
    expect(report.precision.status).toBe("unscored");
    expect(report.comments).toBe("not_fetched");
    expect(report.reviews).toBe("not_fetched");
    expect(report.questions.every((question) => question.verification.status === "verified")).toBe(
      true,
    );
    expect(report.questions.every((question) => question.scopeRepositoryIds.length === 1)).toBe(
      true,
    );
    const roadmap = report.questions.filter(
      (question) => question.id === "issue-10370" || question.id === "state-10370",
    );
    expect(roadmap).toHaveLength(2);
    for (const question of roadmap) {
      expect(question.evidenceSourceIds).toContain("github:issue:1922795955");
      expect(question.evidenceSourceIds).not.toContain("github:issue:4852026509");
      expect(question.searchEvidenceSourceIds).not.toContain("github:issue:4852026509");
    }
    const misses = report.questions.filter(
      (question) => question.id === "pr-16480" || question.id === "state-16480",
    );
    expect(misses.map((question) => question.expectedSourceIds[0])).toEqual([
      "github:pull_request:4810018525",
      "github:pull_request:4810018525",
    ]);
    for (const question of misses) {
      expect(question.verification.status).toBe("verified");
      expect(question.expectedSourceIds).toEqual(["github:pull_request:4810018525"]);
      expect(question.expectedInEvidence).toBe(true);
      expect(question.expectedInEventsOnly).toBe(false);
      expect(question.evidenceSourceIds).toEqual(["github:pull_request:4810018525"]);
    }
    expect(report.precision).toEqual({
      status: "unscored",
      reason: "verified relevant set is absent",
    });
    expect(embedCalls.count).toBe(0);
  }, 120_000);
});
