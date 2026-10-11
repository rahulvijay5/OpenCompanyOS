import { sql, type SQL } from "drizzle-orm";
import {
  DOCUMENT_PREPROCESSING,
  EXPECTED_DIMENSIONS,
  LOCAL_EXPERIMENT,
  LOCAL_MODEL,
  NORMALIZATION_METHOD,
  QUERY_PREPROCESSING,
} from "./local-embedding.js";

export const SEMANTIC_CANDIDATE_LIMIT = 12;

export type LocalSemanticInput = {
  tenantId: string;
  repositoryIds: readonly string[];
  questionId: string;
  sourceIdPrefix: string;
  subjectNumbers: readonly number[];
  since: Date | null;
  until: Date | null;
};

function repositoryFilter(repositoryIds: readonly string[]) {
  return sql`e.payload->>'repositoryId' IN (${sql.join(
    repositoryIds.map((id) => sql`${id}`),
    sql`, `,
  )})`;
}

function sourceLikePattern(prefix: string): string {
  return `${prefix.replace(/[!%_]/g, (character) => `!${character}`)}%`;
}

function subjectNumberSql(numbers: readonly number[]) {
  if (numbers.length === 0) {
    return sql`TRUE`;
  }
  const list = sql.join(
    numbers.map((number) => sql`${String(number)}`),
    sql`, `,
  );
  return sql`(
    e.payload->>'issueNumber' IN (${list})
    OR e.payload->>'pullRequestNumber' IN (${list})
  )`;
}

/** Read-only cosine search over EmbeddingGemma rows. Identity filters apply before the limit. */
export function localSemanticStatement(input: LocalSemanticInput): SQL {
  const since = input.since?.toISOString() ?? null;
  const until = input.until?.toISOString() ?? null;
  const sourcePattern = sourceLikePattern(input.sourceIdPrefix);
  return sql`
    SELECT d.id AS document_id, d.source_id, max(1 - (c.embedding <=> q.embedding)) AS score
    FROM eval_local_query_embeddings q
    JOIN eval_local_chunk_embeddings c
      ON c.experiment = q.experiment
     AND c.model_name = q.model_name
     AND c.normalization_method = q.normalization_method
    JOIN document_chunks chunks ON chunks.id = c.document_chunk_id
    JOIN documents d ON d.id = chunks.document_id
    LEFT JOIN events e
      ON e.tenant_id = d.tenant_id
     AND e.source_system = d.source_system
     AND e.source_event_id = d.source_id
    WHERE q.question_id = ${input.questionId}
      AND q.experiment = ${LOCAL_EXPERIMENT}
      AND q.model_name = ${LOCAL_MODEL}
      AND q.preprocessing = ${QUERY_PREPROCESSING}
      AND c.preprocessing = ${DOCUMENT_PREPROCESSING}
      AND c.dimensions = ${EXPECTED_DIMENSIONS}
      AND c.normalization_method = ${NORMALIZATION_METHOD}
      AND d.tenant_id = ${input.tenantId}
      AND ${repositoryFilter(input.repositoryIds)}
      AND d.source_id LIKE ${sourcePattern} ESCAPE '!'
      AND ${subjectNumberSql(input.subjectNumbers)}
      AND (${since}::timestamptz IS NULL OR e.event_time >= ${since})
      AND (${until}::timestamptz IS NULL OR e.event_time <= ${until})
    GROUP BY d.id, d.source_id
    ORDER BY score DESC
    LIMIT ${SEMANTIC_CANDIDATE_LIMIT}
  `;
}
