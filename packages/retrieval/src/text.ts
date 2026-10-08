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

/** OR prefix query so one useful term is enough to retrieve a document. */
export function keywordOrQuery(text: string): string | null {
  const tokens = [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
    ),
  ];
  if (tokens.length === 0) {
    return null;
  }
  return tokens.map((token) => `${token}:*`).join(" | ");
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
