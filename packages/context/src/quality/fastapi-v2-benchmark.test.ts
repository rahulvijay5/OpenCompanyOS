import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadFastapiV2Benchmark, manifestMismatches, metricsFor } from "./fastapi-v2-benchmark.js";

const v2Directory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../eval/context-quality/corpora/fastapi-v2",
);

describe("fastapi v2 benchmark questions", () => {
  it("matches the frozen manifest and leaves generated questions unverified", async () => {
    const loaded = await loadFastapiV2Benchmark();
    expect(loaded.questions.length).toBeGreaterThanOrEqual(20);
    expect(loaded.questions.length).toBeLessThanOrEqual(30);
    expect(loaded.digest).toBe(
      "eeb18b7376c4257900435e65bd31a7c18135126d219f477eee8bfab56ac66d9d",
    );
    for (const question of loaded.questions) {
      expect(manifestMismatches(question, loaded.manifestRecords.get(question.expectedSourceIds[0] ?? ""))).toEqual(
        [],
      );
      expect(question.fact.eventTime).toBe(question.fact.updatedAt);
    }
    const facts = JSON.parse(await readFile(path.join(v2Directory, "facts.json"), "utf8"));
    const generated = JSON.parse(
      await readFile(path.join(v2Directory, "generated-questions.json"), "utf8"),
    );
    expect(facts.facts).toEqual([]);
    expect(generated.questions.every((question: { verified: boolean }) => question.verified === false)).toBe(
      true,
    );
  });

  it("counts question hits separately from distinct source ids", () => {
    const shared = "github:pull_request:4810018525";
    const other = "github:pull_request:4762942697";
    const score = metricsFor(
      [
        {
          id: "pr-16480",
          expectedSourceIds: [shared],
          eligible: true,
          expectedInEvidence: false,
          storedInEventsTable: true,
        },
        {
          id: "state-16480",
          expectedSourceIds: [shared],
          eligible: true,
          expectedInEvidence: false,
          storedInEventsTable: true,
        },
        {
          id: "pr-16465",
          expectedSourceIds: [other],
          eligible: true,
          expectedInEvidence: true,
          storedInEventsTable: true,
        },
      ],
      "github:pull_request:",
    );
    expect(score.questionLevel).toEqual({ eligible: 3, evidenceHits: 1, recall: 1 / 3 });
    expect(score.distinctSource).toEqual({ eligible: 2, evidenceHits: 1, recall: 0.5 });
    expect(score.eligible).toBe(3);
    expect(score.evidenceHits).toBe(1);
    expect(score.distinctEligible).toBe(2);
    expect(score.distinctEvidenceHits).toBe(1);
    expect(score.eventsNotInEvidence.map((row) => row.id)).toEqual(["pr-16480", "state-16480"]);
  });
});
