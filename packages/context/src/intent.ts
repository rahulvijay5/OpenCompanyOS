import type { EvidenceKind } from "./evidence.js";

/**
 * A question must match one of these patterns before it leaves metadata search.
 * Review is tested first so "inline review comment" is a review, not a conversation comment.
 * Body is last so "comment on the issue description" stays a discussion.
 */
const REVIEW_RULES = [
  /\breview decisions?\b/i,
  /\bstored reviews?\b/i,
  /\bsubmitted reviews?\b/i,
  /\binline reviews?\b/i,
  /\bpull request reviews?\b/i,
  /\breview comments?\b/i,
];

const DISCUSSION_RULES = [
  /\bcomments?\b/i,
  /\bconversation\b/i,
  /\bdiscuss(?:ed|ing|ion)?\b/i,
  /\bwhat (?:people|someone|they) said\b/i,
  /\bwhat was suggested\b/i,
  /\b(?:people|someone|they) suggested\b/i,
  /\bsuggestions?\b/i,
];

const BODY_RULES = [
  /\bissue body\b/i,
  /\bbody of (?:the |an |open )?issue\b/i,
  /\bquote the (?:issue )?body\b/i,
  /\bissue description\b/i,
  /\bdescription of (?:the |an |open )?issue\b/i,
];

/** Undefined means the existing metadata query. The wording is not guessed past these rules. */
export function resolveQueryIntent(query: string): EvidenceKind | undefined {
  if (REVIEW_RULES.some((rule) => rule.test(query))) {
    return "pull_request_review";
  }
  if (DISCUSSION_RULES.some((rule) => rule.test(query))) {
    return "issue_comment";
  }
  if (BODY_RULES.some((rule) => rule.test(query))) {
    return "issue_body";
  }
  return undefined;
}

/** An explicit API evidence kind wins. Omission uses the deterministic rules above. */
export function resolveEvidenceKind(
  query: string,
  explicit?: EvidenceKind,
): EvidenceKind | undefined {
  return explicit ?? resolveQueryIntent(query);
}
