import { describe, expect, it } from "vitest";
import { resolveEvalDatabaseUrl } from "./database.js";
import {
  checkDatasetIntegrity,
  loadDataset,
} from "./dataset.js";
import { judgeCases } from "./judge.js";
import { runContextQualityEvaluation } from "./run.js";

describe("context quality dataset", () => {
  it("keeps generated questions out of the deterministic facts", async () => {
    const dataset = await loadDataset();
    const integrity = checkDatasetIntegrity(dataset);
    const failed = integrity.filter((item) => item.status !== "passed");
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(dataset.generatedQuestions.every((question) => question.verified === false)).toBe(
      true,
    );
    const scored = new Set(dataset.questions.map((question) => question.id));
    for (const question of dataset.generatedQuestions) {
      expect(scored.has(question.id)).toBe(false);
    }
    const updated = dataset.facts.find((fact) => fact.id === "time.issue-12.updated");
    const closed = dataset.facts.find((fact) => fact.id === "time.issue-12.closed");
    expect(updated?.kind).toBe("snapshot_event_time");
    expect(closed?.kind).toBe("occurrence_event_time");
    if (updated?.kind === "snapshot_event_time" && closed?.kind === "occurrence_event_time") {
      expect(updated.eventTime).not.toBe(closed.eventTime);
    }
  });
});

describe("evaluation database selection", () => {
  it("does not treat DATABASE_URL as the evaluation database", () => {
    const resolution = resolveEvalDatabaseUrl({
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/opencompanyos",
    });
    expect(resolution.status).toBe("skipped");
  });

  it("prefers EVAL_DATABASE_URL when both variables are present", () => {
    const resolution = resolveEvalDatabaseUrl({
      EVAL_DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/opencompanyos_eval",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/opencompanyos",
      EVAL_ALLOW_APP_DATABASE: "1",
    });
    expect(resolution).toEqual({
      status: "ready",
      url: "postgresql://postgres:postgres@localhost:5432/opencompanyos_eval",
      source: "EVAL_DATABASE_URL",
    });
  });

  it("uses the application database only with an explicit opt-in", () => {
    const resolution = resolveEvalDatabaseUrl({
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/opencompanyos",
      EVAL_ALLOW_APP_DATABASE: "1",
    });
    expect(resolution).toMatchObject({ status: "ready", source: "DATABASE_URL" });
  });
});

describe("context quality runner without a database", () => {
  it("skips package checks instead of opening DATABASE_URL", async () => {
    const evaluation = await runContextQualityEvaluation({
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:1/do-not-connect",
    });
    expect(evaluation.exitCode).toBe(2);
    expect(evaluation.report.database.status).toBe("skipped");
    expect(evaluation.report.database.source).toBeNull();
    expect(evaluation.report.llmCalls).toBe(0);
    expect(evaluation.report.optionalLlm.status).toBe("not_run");
    expect(evaluation.report.optionalLlm.llmCalls).toBe(0);
    expect(evaluation.report.contextPackage.passed).toBe(0);
    expect(evaluation.report.contextPackage.skipped).toBe(evaluation.report.contextPackage.total);
    expect(evaluation.report.contextPackage.total).toBeGreaterThan(0);
    expect(evaluation.report.unsupported.passed).toBe(0);
    expect(evaluation.report.unsupported.inconclusive).toBe(evaluation.report.unsupported.total);
    expect(evaluation.report.datasetIntegrity.failed).toBe(0);
    expect(evaluation.report.notes.join(" ")).toContain("not a measurement of real-world retrieval quality");
    expect(
      evaluation.report.contextPackage.cases.some((item) => item.id.startsWith("generated-")),
    ).toBe(false);
  });
});

describe("optional judge", () => {
  it("spends no requests when the budget is zero and does not rewrite facts", async () => {
    let calls = 0;
    const judged = await judgeCases({
      budget: 0,
      cache: new Map(),
      cases: [
        {
          id: "case-a",
          question: "Who reviewed the change?",
          factSummary: "reviews_only_from_webhooks",
          packageJson: "{}",
        },
      ],
      complete: async () => {
        calls += 1;
        return { verdict: "supported", detail: "should not run" };
      },
    });
    expect(calls).toBe(0);
    expect(judged.llmCalls).toBe(0);
    expect(judged.skipped).toBe(1);
    expect(judged.passed).toBe(0);
  });

  it("uses the cache for a repeated case without spending another request", async () => {
    let calls = 0;
    const item = {
      id: "case-a",
      question: "What is the issue state?",
      factSummary: "issue 12 is open in the snapshot",
      packageJson: "{\"version\":1}",
    };
    const cache = new Map();
    const first = await judgeCases({
      budget: 2,
      cache,
      cases: [item],
      complete: async () => {
        calls += 1;
        return { verdict: "inconclusive", detail: "not a fixture score" };
      },
    });
    const second = await judgeCases({
      budget: 2,
      cache,
      cases: [item],
      complete: async () => {
        calls += 1;
        return { verdict: "supported", detail: "should be cached" };
      },
    });
    expect(first.llmCalls).toBe(1);
    expect(first.inconclusive).toBe(1);
    expect(second.llmCalls).toBe(0);
    expect(second.cacheHits).toBe(1);
    expect(second.inconclusive).toBe(1);
    expect(calls).toBe(1);
  });

  it("stops calling the completer after the budget is spent", async () => {
    let calls = 0;
    const judged = await judgeCases({
      budget: 1,
      cache: new Map(),
      cases: [
        {
          id: "one",
          question: "one",
          factSummary: "one",
          packageJson: "1",
        },
        {
          id: "two",
          question: "two",
          factSummary: "two",
          packageJson: "2",
        },
      ],
      complete: async () => {
        calls += 1;
        return { verdict: "supported", detail: "ok" };
      },
    });
    expect(calls).toBe(1);
    expect(judged.passed).toBe(1);
    expect(judged.skipped).toBe(1);
  });
});
