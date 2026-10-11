/** Pre-registered cosine-similarity thresholds. They are not fit to issue #5833. */
export const GATED_THRESHOLDS = [0.4, 0.5, 0.6, 0.7, 0.8] as const;

export const GATE_RESULT_CAP = 8;

export const RECOVERY_QUESTION_IDS = ["v2-comment-5833", "v2-comment-window-5833"] as const;

export const ABSTAIN_QUESTION_IDS = [
  "v2-comment-16458",
  "v2-empty-comments-16254",
  "v2-empty-comments-16390",
  "v2-outside-fetch-16345",
  "v2-title-not-comment-16451",
] as const;

export const PRESERVE_QUESTION_IDS = ["v2-comment-10370", "v2-comment-16465"] as const;

export const SNAPSHOT_QUESTION_IDS = [
  "v2-title-16451",
  "v2-state-16451",
  "v2-title-10370",
  "v2-state-10370",
  "v2-title-pr-16480",
  "v2-state-pr-16480",
  "v2-merged-16470",
  "v2-merged-16465",
  "v2-title-5833",
  "v2-author-16451",
  "v2-paraphrase-16465",
  "v2-window-includes-16451",
] as const;

export type AbstentionReason =
  | "lexical_evidence_kept"
  | "not_discussion"
  | "no_candidates"
  | "below_threshold";

export type GateCandidate = {
  sourceId: string;
  score: number;
};

export type GateDecision = {
  threshold: number;
  selectedSourceIds: string[];
  rejected: GateCandidate[];
  rawCandidates: GateCandidate[];
  abstention: AbstentionReason | null;
  bestScore: number | null;
  secondBestScore: number | null;
  /** Diagnostic only. Selection does not use this gap. */
  margin: number | null;
};

function byScore(left: GateCandidate, right: GateCandidate): number {
  return right.score - left.score;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const expected = new Set(right);
  return left.every((id) => expected.has(id));
}

export function applyGatedFallback(input: {
  discussion: boolean;
  lexicalSourceIds: readonly string[];
  candidates: readonly GateCandidate[];
  threshold: number;
}): GateDecision {
  const rawCandidates = [...input.candidates].sort(byScore);
  const bestScore = rawCandidates[0]?.score ?? null;
  const secondBestScore = rawCandidates[1]?.score ?? null;
  const margin =
    bestScore === null || secondBestScore === null ? null : bestScore - secondBestScore;
  const base = {
    threshold: input.threshold,
    rawCandidates,
    bestScore,
    secondBestScore,
    margin,
  };
  if (!input.discussion) {
    return {
      ...base,
      selectedSourceIds: [...input.lexicalSourceIds],
      rejected: [],
      abstention: "not_discussion",
    };
  }
  if (input.lexicalSourceIds.length > 0) {
    return {
      ...base,
      selectedSourceIds: [...input.lexicalSourceIds],
      rejected: [],
      abstention: "lexical_evidence_kept",
    };
  }
  if (rawCandidates.length === 0) {
    return {
      ...base,
      selectedSourceIds: [],
      rejected: [],
      abstention: "no_candidates",
    };
  }
  const eligible = rawCandidates.filter((candidate) => candidate.score >= input.threshold);
  const selected = eligible.slice(0, GATE_RESULT_CAP);
  const selectedIds = new Set(selected.map((candidate) => candidate.sourceId));
  return {
    ...base,
    selectedSourceIds: selected.map((candidate) => candidate.sourceId),
    rejected: rawCandidates.filter((candidate) => !selectedIds.has(candidate.sourceId)),
    abstention: selected.length === 0 ? "below_threshold" : null,
  };
}

export type ThresholdQuestionResult = {
  id: string;
  metric: string;
  passed: boolean | null;
  precision: number | null;
  baselinePassed: boolean | null;
  selectedSourceIds: readonly string[];
  expectedSourceIds: readonly string[];
  abstention: AbstentionReason | null;
  rawCandidateCount: number;
  constraintViolations: readonly { reason: string }[];
};

function metricPassed(
  questions: readonly ThresholdQuestionResult[],
  metric: string,
  denominator: number,
): string | null {
  const rows = questions.filter((question) => question.metric === metric);
  if (rows.length !== denominator || rows.some((question) => question.passed !== true)) {
    return `${metric}:${rows.filter((question) => question.passed === true).length}/${rows.length}`;
  }
  return null;
}

export function thresholdMeetsCriteria(questions: readonly ThresholdQuestionResult[]): {
  success: boolean;
  failures: string[];
} {
  const failures: string[] = [];
  const byId = new Map(questions.map((question) => [question.id, question]));
  for (const id of RECOVERY_QUESTION_IDS) {
    const question = byId.get(id);
    if (
      !question ||
      question.passed !== true ||
      !sameIds(question.selectedSourceIds, question.expectedSourceIds)
    ) {
      failures.push(`recovery:${id}`);
    }
  }
  for (const id of ABSTAIN_QUESTION_IDS) {
    const question = byId.get(id);
    if (!question || question.passed !== true || question.selectedSourceIds.length > 0) {
      failures.push(`abstain:${id}`);
      continue;
    }
    if (id === "v2-comment-16458" && question.rawCandidateCount > 0) {
      if (question.abstention !== "below_threshold") {
        failures.push(`abstain:${id}`);
      }
      continue;
    }
    if (question.abstention !== "no_candidates" && question.abstention !== "below_threshold") {
      failures.push(`abstain:${id}`);
    }
  }
  for (const id of PRESERVE_QUESTION_IDS) {
    const question = byId.get(id);
    if (
      !question ||
      question.passed !== true ||
      question.precision !== 1 ||
      question.abstention !== "lexical_evidence_kept" ||
      !sameIds(question.selectedSourceIds, question.expectedSourceIds)
    ) {
      failures.push(`preserve:${id}`);
    }
  }
  for (const check of [
    metricPassed(questions, "partial_recall", 11),
    metricPassed(questions, "window_contract", 2),
    metricPassed(questions, "unknown_identifier", 1),
    metricPassed(questions, "verified_empty_abstention", 10),
  ]) {
    if (check) {
      failures.push(check);
    }
  }
  for (const question of questions) {
    if (question.baselinePassed === true && question.passed !== true) {
      failures.push(`regression:${question.id}`);
    }
    if (question.constraintViolations.some((violation) => violation.reason === "wrong_parent")) {
      failures.push(`wrong_parent:${question.id}`);
    }
  }
  for (const id of SNAPSHOT_QUESTION_IDS) {
    if (!byId.has(id)) {
      failures.push(`snapshot_missing:${id}`);
    }
  }
  return { success: failures.length === 0, failures };
}
