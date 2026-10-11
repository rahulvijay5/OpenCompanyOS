export const EMBEDDING_DIMENSIONS = 768;
const CHUNK_SIZE = 1200;

export function chunkText(text: string, size = CHUNK_SIZE): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  const chunks: string[] = [];
  for (let index = 0; index < trimmed.length; index += size) {
    chunks.push(trimmed.slice(index, index + size));
  }
  return chunks;
}

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "from",
  "by",
  "what",
  "which",
  "who",
  "when",
  "where",
  "why",
  "how",
  "did",
  "does",
  "do",
  "is",
  "are",
  "was",
  "were",
  "any",
  "some",
  "this",
  "that",
  "into",
  "about",
]);

/**
 * Characters split before the English parser. A slash otherwise keeps the
 * rest of a path as one lexeme, so a later segment cannot match. Underscores
 * and dots inside that lexeme are split too. Hyphens stay with the English
 * parser, which already indexes both the compound word and its parts.
 */
export const LEXICAL_SEPARATORS = "[/_.]+";

/**
 * Event-type strings stored ahead of the real title and body.
 * They are removed before separator splitting so "issue_comment.backfill"
 * cannot satisfy a query for "comment" or "issue" by itself.
 * Longer names come first because the database regex uses first match.
 */
export const SYNTHETIC_EVENT_TYPE_PATTERN =
  "(pull_request_review|issue_comment|pull_request|issues)\\.[a-z0-9_]+";

/** Query-time searchable text. Stored title and body bytes are left unchanged. */
export function lexicalDocumentText(title: string, body: string): string {
  return `${title} ${body}`
    .replace(new RegExp(SYNTHETIC_EVENT_TYPE_PATTERN, "gi"), " ")
    .replace(new RegExp(LEXICAL_SEPARATORS, "g"), " ");
}

/** OR prefix query so one useful term is enough to retrieve a document. */
export function keywordOrQuery(text: string): string | null {
  const tokens = queryTokens(text);
  if (tokens.length === 0) {
    return null;
  }
  return tokens.map((token) => `${token}:*`).join(" | ");
}

const DISCUSSION_BOILERPLATE = new Set([
  "stored",
  "comment",
  "comments",
  "conversation",
  "issue",
  "issues",
  "pull",
  "request",
  "requests",
  "say",
  "says",
  "said",
  "open",
]);

function queryTokens(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
    ),
  ];
}

/**
 * Topic words left after question boilerplate and issue/PR numbers are removed.
 * An empty list means the question asks for the whole conversation.
 */
export const DISCUSSION_IDENTIFIER = "[a-z0-9]+(?:[-_:/]+[a-z0-9]+)+";

export function discussionContentTokens(query: string): string[] {
  const numbers = new Set([...query.matchAll(/#(\d+)\b/g)].map((match) => match[1] ?? ""));
  return queryTokens(query).filter(
    (token) => !DISCUSSION_BOILERPLATE.has(token) && !numbers.has(token),
  );
}

/** Focused questions keep only comments that contain a topic word. A broad question keeps every comment. */
export function retainTopicComments<T extends { text: string }>(
  comments: readonly T[],
  contentTokens: readonly string[],
): T[] {
  if (contentTokens.length === 0) {
    return [...comments];
  }
  return comments.filter((comment) => textHasTopic(comment.text, contentTokens));
}

function textHasTopic(text: string, tokens: readonly string[]): boolean {
  const words = discussionTopicText(text)
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0);
  return tokens.some((token) => words.some((word) => word.startsWith(token)));
}

/**
 * Discussion topics are prose words. After the usual separator normalization,
 * a remaining branch-style identifier joined by hyphens or colons is removed,
 * so an inner piece cannot satisfy the topic by itself. Stored documents are
 * not rewritten. Search then applies the English stemmer to the remaining prose.
 */
export function discussionTopicText(text: string): string {
  return lexicalDocumentText("", text)
    .toLowerCase()
    .replace(new RegExp(DISCUSSION_IDENTIFIER, "g"), " ");
}

export type QueryConstraints = {
  since: Date | null;
  text: string;
};

export function extractQueryConstraints(
  query: string,
  now: Date = new Date(),
): QueryConstraints {
  let since: Date | null = null;
  if (/\b(this week|past week|last 7 days)\b/i.test(query)) {
    since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (/\btoday\b/i.test(query)) {
    since = new Date(now);
    since.setHours(0, 0, 0, 0);
  } else if (/\byesterday\b/i.test(query)) {
    since = new Date(now);
    since.setDate(since.getDate() - 1);
    since.setHours(0, 0, 0, 0);
  }

  return { since, text: query.trim() };
}

export type ScoredHit = {
  documentId: string;
  score: number;
};

export function fuseHits(
  textHits: ScoredHit[],
  vectorHits: ScoredHit[],
): ScoredHit[] {
  const normalize = (hits: ScoredHit[]) => {
    const max = Math.max(...hits.map((hit) => hit.score), 0);
    if (max <= 0) {
      return hits.map((hit) => ({ ...hit, score: 0 }));
    }
    return hits.map((hit) => ({ ...hit, score: hit.score / max }));
  };

  const scores = new Map<string, { text: number; vector: number }>();
  for (const hit of normalize(textHits)) {
    scores.set(hit.documentId, { text: hit.score, vector: 0 });
  }
  for (const hit of normalize(vectorHits)) {
    const current = scores.get(hit.documentId) ?? { text: 0, vector: 0 };
    current.vector = hit.score;
    scores.set(hit.documentId, current);
  }

  return [...scores.entries()]
    .map(([documentId, parts]) => ({
      documentId,
      score: parts.text + parts.vector,
    }))
    .sort((left, right) => right.score - left.score);
}

export function documentBody(input: {
  eventType: string;
  payload: Record<string, unknown>;
}): { title: string; body: string; url: string | null } {
  const title =
    typeof input.payload.title === "string"
      ? input.payload.title
      : typeof input.payload.message === "string"
        ? input.payload.message.split("\n")[0] ?? input.eventType
        : input.eventType;
  const details = [
    input.eventType,
    typeof input.payload.fullName === "string" ? input.payload.fullName : null,
    typeof input.payload.state === "string" ? input.payload.state : null,
    typeof input.payload.userLogin === "string" ? input.payload.userLogin : null,
    typeof input.payload.authorLogin === "string"
      ? input.payload.authorLogin
      : null,
    typeof input.payload.body === "string" ? input.payload.body : null,
    typeof input.payload.message === "string" ? input.payload.message : null,
  ].filter((part): part is string => Boolean(part));

  return {
    title: title.slice(0, 300),
    body: details.join("\n"),
    url: typeof input.payload.htmlUrl === "string" ? input.payload.htmlUrl : null,
  };
}
