export const EVALUATION_CLOCK = "2026-10-11T00:00:00.000Z";

export const LABEL_QUALITIES = [
  "verified_complete",
  "verified_partial",
  "verified_empty",
  "unverified_candidate",
] as const;

export type LabelQuality = (typeof LABEL_QUALITIES)[number];

export const DISPOSITIONS = [
  "answerable",
  "unanswerable",
  "ambiguous",
  "malformed",
  "unknown_identifier",
  "window_contract",
] as const;

export type Disposition = (typeof DISPOSITIONS)[number];

export type SuiteQuestion = {
  id: string;
  category: string;
  question: string;
  disposition: Disposition;
  labelQuality: LabelQuality;
  expectedSourceIds: string[];
  expectedSubjectSourceId: string | null;
  expectedFacts: Record<string, string | boolean | null> | null;
  window: { from: string; to: string } | null;
  useDefaultWindow: boolean;
  verified: boolean;
  verificationBasis: string;
  limitations: string | null;
};

export type QuestionOutcome = {
  evidenceSourceIds: string[];
  subjectStatus: string;
  currentStateSourceIds: string[];
  currentStateTitles: string[];
  insufficientEvidence: boolean;
};

export type MetricName =
  | "precision_recall"
  | "partial_recall"
  | "verified_empty_abstention"
  | "window_contract"
  | "unknown_identifier"
  | "unscored";

export type FailureClass =
  | "missing_source_data"
  | "subject_resolution"
  | "query_intent"
  | "retrieval_miss"
  | "irrelevant_evidence"
  | "context_assembly"
  | "answer_generation"
  | "citation"
  | "evaluation_uncertainty"
  | null;

export type ScoredQuestion = {
  metric: MetricName;
  recall: number | null;
  precision: number | null;
  passed: boolean | null;
  failureClass: FailureClass;
  hybridCandidate: boolean;
  notes: string[];
};

const COMMENT_PREFIX = "github:issue_comment:";
const REVIEW_PREFIX = "github:pull_request_review:";

export function scoreSuiteQuestion(
  question: SuiteQuestion,
  outcome: QuestionOutcome,
): ScoredQuestion {
  if (question.disposition === "unknown_identifier") {
    const clean = outcome.subjectStatus === "unresolved" && outcome.evidenceSourceIds.length === 0;
    return {
      metric: "unknown_identifier",
      recall: null,
      precision: null,
      passed: clean,
      failureClass: clean ? null : "subject_resolution",
      hybridCandidate: false,
      notes: [
        "Pass only when the subject stays unresolved and no evidence is cited. This is not a verified-empty abstention.",
      ],
    };
  }

  if (question.disposition === "window_contract") {
    const evidenceEmpty = outcome.evidenceSourceIds.length === 0;
    const keptState =
      question.expectedSubjectSourceId === null ||
      outcome.currentStateSourceIds.includes(question.expectedSubjectSourceId);
    const passed = evidenceEmpty && keptState;
    return {
      metric: "window_contract",
      recall: null,
      precision: null,
      passed,
      failureClass: passed ? null : "context_assembly",
      hybridCandidate: false,
      notes: [
        "The requested window excludes the snapshot from answer evidence. The subject can still appear in currentState. This is not an abstention pass.",
      ],
    };
  }

  if (
    question.disposition === "ambiguous" ||
    question.disposition === "malformed" ||
    question.labelQuality === "unverified_candidate"
  ) {
    return {
      metric: "unscored",
      recall: null,
      precision: null,
      passed: null,
      failureClass: null,
      hybridCandidate: false,
      notes: [
        "Not scored. An empty evidence list is not an abstention pass for an ambiguous, malformed, or unverified question.",
      ],
    };
  }

  if (question.labelQuality === "verified_empty" && question.disposition === "unanswerable") {
    const empty = outcome.evidenceSourceIds.length === 0;
    return {
      metric: "verified_empty_abstention",
      recall: null,
      precision: null,
      passed: empty,
      failureClass: empty ? null : wrongKind(question, outcome) ? "query_intent" : "irrelevant_evidence",
      hybridCandidate: false,
      notes: empty
        ? ["Verified empty set. Evidence is empty, so the abstention check passes."]
        : ["Verified empty set, but evidence was returned."],
    };
  }

  if (question.labelQuality === "verified_partial") {
    const hits = question.expectedSourceIds.filter((id) => outcome.evidenceSourceIds.includes(id));
    const recall = question.expectedSourceIds.length === 0 ? null : hits.length / question.expectedSourceIds.length;
    const subjectOk =
      question.expectedSubjectSourceId === null ||
      outcome.subjectStatus === "resolved";
    return {
      metric: "partial_recall",
      recall,
      precision: null,
      passed: recall === 1 && subjectOk,
      failureClass: recall === 1 && subjectOk ? null : subjectOk ? "retrieval_miss" : "subject_resolution",
      hybridCandidate: false,
      notes: ["Precision is not scored. The known snapshot was not audited as a complete relevant set."],
    };
  }

  if (question.labelQuality === "verified_complete") {
    const hits = question.expectedSourceIds.filter((id) => outcome.evidenceSourceIds.includes(id));
    const extras = outcome.evidenceSourceIds.filter((id) => !question.expectedSourceIds.includes(id));
    const recall = hits.length / question.expectedSourceIds.length;
    const precision =
      outcome.evidenceSourceIds.length === 0 ? null : hits.length / outcome.evidenceSourceIds.length;
    const passed = recall === 1 && precision === 1;
    let failureClass: FailureClass = null;
    if (!passed && outcome.evidenceSourceIds.length === 0) {
      failureClass = "retrieval_miss";
    } else if (!passed && extras.length > 0 && hits.length > 0) {
      failureClass = "irrelevant_evidence";
    } else if (!passed) {
      failureClass = "retrieval_miss";
    }
    if (wrongKind(question, outcome)) {
      failureClass = "query_intent";
    }
    return {
      metric: "precision_recall",
      recall,
      precision,
      passed,
      failureClass,
      hybridCandidate: question.id === "v2-comment-5833" && recall < 1,
      notes:
        question.id === "v2-comment-5833"
          ? [
              "Stored comments support the question but do not contain the words response or compression.",
            ]
          : [],
    };
  }

  return {
    metric: "unscored",
    recall: null,
    precision: null,
    passed: null,
    failureClass: "evaluation_uncertainty",
    hybridCandidate: false,
    notes: ["This label and disposition pair is not scored."],
  };
}

function wrongKind(question: SuiteQuestion, outcome: QuestionOutcome): boolean {
  if (outcome.evidenceSourceIds.length === 0) {
    return false;
  }
  if (question.category === "focused_discussion" || question.category === "broad_conversation") {
    return outcome.evidenceSourceIds.some((id) => !id.startsWith(COMMENT_PREFIX));
  }
  if (question.category === "unsupported" && question.id.includes("review")) {
    return outcome.evidenceSourceIds.some((id) => !id.startsWith(REVIEW_PREFIX));
  }
  return false;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
