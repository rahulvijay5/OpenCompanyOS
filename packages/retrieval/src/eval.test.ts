import { describe, expect, it } from "vitest";
import { scoreQueryCase } from "./eval.js";

describe("scoreQueryCase", () => {
  it("passes when evidence and answer contain the required text", () => {
    const score = scoreQueryCase({
      answer: "company-brain changed this week.",
      evidence: [
        {
          title: "Merge pull request #4",
          url: "https://github.com/opencompanyos-org/company-brain/pull/4",
          snippet: "pushed by rahulvijay5",
        },
      ],
      expect: {
        evidenceIncludes: ["company-brain", "pull/4"],
        answerIncludes: ["company-brain"],
        answerExcludes: ["$4,000,000"],
      },
    });
    expect(score.passed).toBe(true);
  });

  it("fails a missing citation and an invented phrase", () => {
    const score = scoreQueryCase({
      answer: "The forecast is $4,000,000.",
      evidence: [],
      expect: {
        evidenceIncludes: ["company-brain"],
        answerIncludesAny: ["don't have evidence", "no recorded changes"],
        answerExcludes: ["$4,000,000"],
      },
    });
    expect(score.passed).toBe(false);
    expect(score.checks.filter((check) => !check.passed)).toHaveLength(3);
  });
});
