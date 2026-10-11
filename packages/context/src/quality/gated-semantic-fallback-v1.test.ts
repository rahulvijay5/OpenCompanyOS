import { describe, expect, it } from "vitest";
import {
  ABSTAIN_QUESTION_IDS,
  GATED_THRESHOLDS,
  PRESERVE_QUESTION_IDS,
  RECOVERY_QUESTION_IDS,
  SNAPSHOT_QUESTION_IDS,
  applyGatedFallback,
  thresholdMeetsCriteria,
  type ThresholdQuestionResult,
} from "./gated-semantic-fallback.js";

const gzipIds = ["github:issue_comment:1369875193", "github:issue_comment:1370138075"];

describe("gated semantic fallback", () => {
  it("keeps metadata and nonempty lexical evidence without using semantic candidates", () => {
    expect(
      applyGatedFallback({
        discussion: false,
        lexicalSourceIds: ["github:issue:5671616833"],
        candidates: [{ sourceId: "github:issue_comment:1", score: 0.99 }],
        threshold: 0.4,
      }),
    ).toMatchObject({
      selectedSourceIds: ["github:issue:5671616833"],
      rejected: [],
      abstention: "not_discussion",
    });
    expect(
      applyGatedFallback({
        discussion: true,
        lexicalSourceIds: ["github:issue_comment:1745618744"],
        candidates: [{ sourceId: "github:issue_comment:1752824630", score: 0.95 }],
        threshold: 0.4,
      }).abstention,
    ).toBe("lexical_evidence_kept");
  });

  it("selects every candidate at or above the threshold and records the unused margin", () => {
    const decision = applyGatedFallback({
      discussion: true,
      lexicalSourceIds: [],
      candidates: [
        { sourceId: gzipIds[0] ?? "", score: 0.91 },
        { sourceId: gzipIds[1] ?? "", score: 0.9 },
        { sourceId: "github:issue_comment:9", score: 0.2 },
      ],
      threshold: 0.8,
    });
    expect(decision.selectedSourceIds).toEqual(gzipIds);
    expect(decision.rejected.map((candidate) => candidate.sourceId)).toEqual([
      "github:issue_comment:9",
    ]);
    expect(decision.abstention).toBeNull();
    expect(decision.margin).toBeCloseTo(0.01);
  });

  it("abstains when every candidate is below the threshold", () => {
    const decision = applyGatedFallback({
      discussion: true,
      lexicalSourceIds: [],
      candidates: [
        { sourceId: "github:issue_comment:5998918108", score: 0.61 },
        { sourceId: "github:issue_comment:5999284810", score: 0.6 },
        { sourceId: "github:issue_comment:5999149892", score: 0.59 },
      ],
      threshold: 0.8,
    });
    expect(decision.selectedSourceIds).toEqual([]);
    expect(decision.abstention).toBe("below_threshold");
    expect(decision.rejected).toHaveLength(3);
  });

  it("abstains when a discussion query has no semantic candidates", () => {
    expect(
      applyGatedFallback({
        discussion: true,
        lexicalSourceIds: [],
        candidates: [],
        threshold: 0.4,
      }).abstention,
    ).toBe("no_candidates");
  });

  it("caps selected evidence at eight and uses the pre-registered thresholds", () => {
    const decision = applyGatedFallback({
      discussion: true,
      lexicalSourceIds: [],
      candidates: Array.from({ length: 9 }, (_, index) => ({
        sourceId: `github:issue_comment:${index}`,
        score: 0.9,
      })),
      threshold: 0.8,
    });
    expect(decision.selectedSourceIds).toHaveLength(8);
    expect(decision.rejected).toHaveLength(1);
    expect(GATED_THRESHOLDS).toEqual([0.4, 0.5, 0.6, 0.7, 0.8]);
  });
});

describe("threshold success criteria", () => {
  it("accepts a grid row that recovers #5833 and abstains on #16458", () => {
    expect(thresholdMeetsCriteria(successFixture()).success).toBe(true);
  });

  it("rejects a row that returns the #16458 comments", () => {
    const questions = successFixture().map((question) =>
      question.id === "v2-comment-16458"
        ? {
            ...question,
            passed: false,
            selectedSourceIds: ["github:issue_comment:5998918108"],
            abstention: null,
          }
        : question,
    );
    const result = thresholdMeetsCriteria(questions);
    expect(result.success).toBe(false);
    expect(result.failures).toContain("abstain:v2-comment-16458");
  });
});

function successFixture(): ThresholdQuestionResult[] {
  const partialIds = SNAPSHOT_QUESTION_IDS.filter((id) => id !== "v2-paraphrase-16465");
  const rows: ThresholdQuestionResult[] = partialIds.map((id) =>
    result(id, "partial_recall", true),
  );
  rows.push(result("v2-paraphrase-16465", "unscored", null));
  rows.push(
    result("v2-comment-5833", "precision_recall", true, {
      selectedSourceIds: gzipIds,
      expectedSourceIds: gzipIds,
      abstention: null,
      rawCandidateCount: 2,
    }),
    result("v2-comment-window-5833", "precision_recall", true, {
      selectedSourceIds: gzipIds,
      expectedSourceIds: gzipIds,
      abstention: null,
      rawCandidateCount: 2,
    }),
    result("v2-comment-10370", "precision_recall", true, {
      precision: 1,
      selectedSourceIds: ["github:issue_comment:1745618744"],
      expectedSourceIds: ["github:issue_comment:1745618744"],
      abstention: "lexical_evidence_kept",
    }),
    result("v2-comment-16465", "precision_recall", true, {
      precision: 1,
      selectedSourceIds: ["github:issue_comment:6036051915"],
      expectedSourceIds: ["github:issue_comment:6036051915"],
      abstention: "lexical_evidence_kept",
    }),
    result("v2-conversation-16480", "precision_recall", true, {
      selectedSourceIds: ["github:issue_comment:6095888500"],
      expectedSourceIds: ["github:issue_comment:6095888500"],
      abstention: "lexical_evidence_kept",
    }),
    result("v2-comments-on-16480", "precision_recall", true, {
      selectedSourceIds: ["github:issue_comment:6095888500"],
      expectedSourceIds: ["github:issue_comment:6095888500"],
      abstention: "lexical_evidence_kept",
    }),
    result("v2-window-excludes-16451", "window_contract", true),
    result("v2-default-window-16451", "window_contract", true),
    result("v2-unknown-999999", "unknown_identifier", true),
  );
  for (const id of ABSTAIN_QUESTION_IDS) {
    rows.push(
      result(id, "verified_empty_abstention", true, {
        abstention: id === "v2-comment-16458" ? "below_threshold" : "no_candidates",
        rawCandidateCount: id === "v2-comment-16458" ? 3 : 0,
      }),
    );
  }
  for (const id of ["v2-body-16451", "v2-review-16470", "v2-review-16480", "v2-review-16476", "v2-inline-16468"]) {
    rows.push(result(id, "verified_empty_abstention", true, { abstention: "not_discussion" }));
  }
  expect(RECOVERY_QUESTION_IDS).toHaveLength(2);
  expect(PRESERVE_QUESTION_IDS).toHaveLength(2);
  return rows;
}

function result(
  id: string,
  metric: string,
  passed: boolean | null,
  extra: Partial<ThresholdQuestionResult> = {},
): ThresholdQuestionResult {
  return {
    id,
    metric,
    passed,
    precision: metric === "precision_recall" ? 1 : null,
    baselinePassed: passed,
    selectedSourceIds: [],
    expectedSourceIds: [],
    abstention: "not_discussion",
    rawCandidateCount: 0,
    constraintViolations: [],
    ...extra,
  };
}
