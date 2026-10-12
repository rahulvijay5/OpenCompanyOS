import { describe, expect, it } from "vitest";
import { scoreRealCorpus, type CorpusObservation } from "./corpus.js";

const window = { from: "2026-03-01T00:00:00.000Z", to: "2026-03-31T00:00:00.000Z" };

function observation(overrides: Partial<CorpusObservation> = {}): CorpusObservation {
  return {
    verifiedManifest: true,
    window,
    stored: [
      {
        sourceId: "github:issue_comment:1",
        eventTime: "2026-03-02T00:00:00.000Z",
        role: "issue_comment",
      },
      {
        sourceId: "github:issue_comment:2",
        eventTime: "2025-01-01T00:00:00.000Z",
        role: "issue_comment",
      },
    ],
    evidenceSourceIds: ["github:issue_comment:1"],
    eventSourceIds: ["github:issue_comment:1"],
    relevantSourceIds: null,
    evidenceRepositoryIds: [{ sourceId: "github:issue_comment:1", repositoryId: "selected" }],
    scopeRepositoryIds: ["selected"],
    hiddenSourceIds: [],
    subjectSourceId: "github:issue:12",
    expectedSubjectSourceId: "github:issue:12",
    relationships: [],
    expectedRelationships: [],
    ...overrides,
  };
}

describe("real corpus metrics", () => {
  it("stays not_run until a verified manifest exists", () => {
    const score = scoreRealCorpus(observation({ verifiedManifest: false }));
    expect(score.status).toBe("not_run");
    expect(score.reason).toBe("corpus_not_imported");
    expect(score.recall).toBeNull();
    expect(score.precision.status).toBe("unscored");
  });

  it("measures recall only for evidence inside the requested window", () => {
    const score = scoreRealCorpus(observation());
    expect(score.recall).toEqual({ hits: 1, eligible: 1, ratio: 1 });
    expect(score.correctlyExcluded).toEqual(["github:issue_comment:2"]);
    expect(score.temporalFailures).toEqual([]);
    expect(score.precision).toEqual({
      status: "unscored",
      reason: "verified relevant set is absent",
    });
  });

  it("does not count an events-only row as retrieved evidence", () => {
    const score = scoreRealCorpus(
      observation({
        evidenceSourceIds: [],
        eventSourceIds: ["github:issue_comment:1"],
      }),
    );
    expect(score.recall?.hits).toBe(0);
    expect(score.eventsNotInEvidence).toEqual(["github:issue_comment:1"]);
    expect(score.commentReviewCoverage?.inEventsOnly).toEqual(["github:issue_comment:1"]);
    expect(score.temporalFailures).toEqual([]);
  });

  it("counts a temporal failure only when the window contract is contradicted", () => {
    const missing = scoreRealCorpus(
      observation({ evidenceSourceIds: [], eventSourceIds: [] }),
    );
    expect(missing.temporalFailures).toEqual([
      "github:issue_comment:1 is inside the window but missing from events",
    ]);

    const leaked = scoreRealCorpus(
      observation({
        evidenceSourceIds: ["github:issue_comment:1"],
        eventSourceIds: ["github:issue_comment:1", "github:issue_comment:2"],
      }),
    );
    expect(leaked.temporalFailures).toEqual([
      "github:issue_comment:2 is outside the window but present in events",
    ]);
    expect(leaked.correctlyExcluded).toEqual([]);
  });
});
