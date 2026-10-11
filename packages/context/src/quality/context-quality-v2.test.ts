import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LABEL_QUALITIES,
  scoreSuiteQuestion,
  type SuiteQuestion,
} from "./context-quality-v2-score.js";

const suitePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../eval/context-quality/context-quality-v2/questions.json",
);

const emptyOutcome = {
  evidenceSourceIds: [] as string[],
  subjectStatus: "unresolved",
  currentStateSourceIds: [] as string[],
  currentStateTitles: [] as string[],
  insufficientEvidence: true,
};

function question(partial: Partial<SuiteQuestion> & Pick<SuiteQuestion, "id" | "disposition" | "labelQuality">): SuiteQuestion {
  return {
    category: "focused_discussion",
    question: "question",
    expectedSourceIds: [],
    expectedSubjectSourceId: null,
    expectedFacts: null,
    window: null,
    useDefaultWindow: false,
    verified: false,
    verificationBasis: "test",
    limitations: null,
    ...partial,
  };
}

describe("context quality v2 suite", () => {
  const suite = JSON.parse(readFileSync(suitePath, "utf8")) as { questions: SuiteQuestion[] };

  it("holds 35 to 40 questions and only the four label qualities", () => {
    expect(suite.questions.length).toBeGreaterThanOrEqual(35);
    expect(suite.questions.length).toBeLessThanOrEqual(40);
    expect(new Set(suite.questions.map((item) => item.id)).size).toBe(suite.questions.length);
    for (const item of suite.questions) {
      expect(LABEL_QUALITIES).toContain(item.labelQuality);
    }
  });
});

describe("context quality v2 scoring", () => {
  it("does not treat empty evidence on a malformed question as an abstention pass", () => {
    const scored = scoreSuiteQuestion(
      question({ id: "malformed", disposition: "malformed", labelQuality: "unverified_candidate" }),
      emptyOutcome,
    );
    expect(scored.metric).toBe("unscored");
    expect(scored.passed).toBeNull();
  });

  it("scores a verified empty set separately from an unknown identifier", () => {
    const empty = scoreSuiteQuestion(
      question({ id: "body", disposition: "unanswerable", labelQuality: "verified_empty", category: "unsupported" }),
      emptyOutcome,
    );
    expect(empty.metric).toBe("verified_empty_abstention");
    expect(empty.passed).toBe(true);

    const unknown = scoreSuiteQuestion(
      question({
        id: "missing",
        disposition: "unknown_identifier",
        labelQuality: "unverified_candidate",
        category: "ambiguous_or_malformed",
      }),
      emptyOutcome,
    );
    expect(unknown.metric).toBe("unknown_identifier");
    expect(unknown.passed).toBe(true);
    expect(unknown.metric).not.toBe(empty.metric);
  });

  it("does not score precision for a partial metadata label", () => {
    const scored = scoreSuiteQuestion(
      question({
        id: "title",
        disposition: "answerable",
        labelQuality: "verified_partial",
        category: "exact_metadata",
        expectedSourceIds: ["github:issue:1"],
      }),
      { ...emptyOutcome, evidenceSourceIds: ["github:issue:1"], subjectStatus: "resolved" },
    );
    expect(scored.precision).toBeNull();
    expect(scored.recall).toBe(1);
    expect(scored.passed).toBe(true);
  });

  it("marks the compression discussion as a hybrid candidate when the comments are missed", () => {
    const scored = scoreSuiteQuestion(
      question({
        id: "v2-comment-5833",
        disposition: "answerable",
        labelQuality: "verified_complete",
        expectedSourceIds: ["github:issue_comment:1", "github:issue_comment:2"],
      }),
      emptyOutcome,
    );
    expect(scored.recall).toBe(0);
    expect(scored.hybridCandidate).toBe(true);
    expect(scored.failureClass).toBe("retrieval_miss");
  });
});
