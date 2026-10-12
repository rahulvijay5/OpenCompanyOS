export const EVIDENCE_KINDS = ["issue_comment", "pull_request_review", "issue_body"] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

const SOURCE_PREFIX: Record<Exclude<EvidenceKind, "issue_body">, string> = {
  issue_comment: "github:issue_comment:",
  pull_request_review: "github:pull_request_review:",
};

/** Stored issue bodies do not use this prefix. A body request therefore matches no document. */
const ISSUE_BODY_PREFIX = "github:issue_body:";

export function sourcePrefixForEvidence(kind?: EvidenceKind): string | undefined {
  if (!kind) {
    return undefined;
  }
  if (kind === "issue_body") {
    return ISSUE_BODY_PREFIX;
  }
  return SOURCE_PREFIX[kind];
}

/**
 * Answer citations come from search hits only.
 * An omitted kind keeps general metadata search unchanged.
 * issue_body matches nothing in this corpus, so the answer list is empty.
 */
export function selectAnswerEvidence<T extends { sourceId: string }>(
  searched: readonly T[],
  evidenceKind?: EvidenceKind,
): T[] {
  if (!evidenceKind) {
    return [...searched];
  }
  if (evidenceKind === "issue_body") {
    return [];
  }
  const prefix = SOURCE_PREFIX[evidenceKind];
  return searched.filter((item) => item.sourceId.startsWith(prefix));
}
