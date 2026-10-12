import {
  documentChunks,
  documents,
  events,
  type Database,
} from "@opencompanyos/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { LlmConfig } from "@opencompanyos/config";
import { embedTexts } from "./llm.js";
import {
  chunkText,
  documentBody,
  fuseHits,
  keywordOrQuery,
  LEXICAL_SEPARATORS,
  SYNTHETIC_EVENT_TYPE_PATTERN,
  DISCUSSION_IDENTIFIER,
} from "./text.js";

type EventRow = {
  id: string;
  tenantId: string;
  sourceEventId: string;
  eventType: string;
  eventTime: Date | null;
  objectEntityId: string | null;
  payload: Record<string, unknown>;
};

export async function indexEvent(
  db: Database,
  eventId: string,
  config: LlmConfig | null,
): Promise<void> {
  const event = await db.query.events.findFirst({
    where: eq(events.id, eventId),
  });
  if (!event) {
    return;
  }

  await upsertDocument(db, event, config);
}

export async function reindexTenant(
  db: Database,
  tenantId: string,
  config: LlmConfig | null,
): Promise<number> {
  const rows = await db.query.events.findMany({
    where: eq(events.tenantId, tenantId),
  });
  for (const row of rows) {
    await upsertDocument(db, row, config);
  }
  return rows.length;
}

async function upsertDocument(
  db: Database,
  event: EventRow,
  config: LlmConfig | null,
): Promise<void> {
  const rendered = documentBody({
    eventType: event.eventType,
    payload: event.payload,
  });
  const now = new Date();
  const [document] = await db
    .insert(documents)
    .values({
      tenantId: event.tenantId,
      entityId: event.objectEntityId,
      sourceSystem: "github",
      sourceId: event.sourceEventId,
      title: rendered.title,
      body: rendered.body,
      url: rendered.url,
      metadata: {
        eventType: event.eventType,
        eventTime: event.eventTime?.toISOString() ?? null,
      },
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [documents.tenantId, documents.sourceSystem, documents.sourceId],
      set: {
        entityId: event.objectEntityId,
        title: rendered.title,
        body: rendered.body,
        url: rendered.url,
        metadata: {
          eventType: event.eventType,
          eventTime: event.eventTime?.toISOString() ?? null,
        },
        updatedAt: now,
      },
    })
    .returning({ id: documents.id });

  if (!document) {
    throw new Error("failed_to_upsert_document");
  }

  await db
    .delete(documentChunks)
    .where(eq(documentChunks.documentId, document.id));

  const chunks = chunkText(rendered.body);
  if (chunks.length === 0) {
    return;
  }

  let vectors: Array<number[] | null> = chunks.map(() => null);
  if (config) {
    try {
      vectors = await embedTexts(config, chunks);
    } catch (error) {
      console.error("[retrieval] embedding skipped", error);
      vectors = chunks.map(() => null);
    }
  }

  await db.insert(documentChunks).values(
    chunks.map((content, chunkIndex) => ({
      documentId: document.id,
      chunkIndex,
      content,
      embedding: vectors[chunkIndex] ?? null,
      metadata: {},
    })),
  );
}

type RetrievedDoc = {
  documentId: string;
  title: string | null;
  snippet: string | null;
  url: string | null;
  entityId: string | null;
  sourceId: string;
  score: number;
};

const SEARCH_CANDIDATE_LIMIT = 12;
const EVIDENCE_RESULT_LIMIT = 8;

/**
 * Kind filtering happens before the result cap.
 * A lower-ranked comment still fits when higher-ranked snapshots are a different kind.
 */
export function selectCappedEvidence<T extends { sourceId: string }>(
  ranked: readonly T[],
  sourceIdPrefix: string | undefined,
  limit = EVIDENCE_RESULT_LIMIT,
): T[] {
  const eligible =
    sourceIdPrefix === undefined
      ? [...ranked]
      : ranked.filter((row) => row.sourceId.startsWith(sourceIdPrefix));
  return eligible.slice(0, limit);
}

function sourceLikePattern(prefix: string | undefined): string | null {
  if (!prefix) {
    return null;
  }
  return `${prefix.replace(/[!%_]/g, (character) => `!${character}`)}%`;
}

function subjectNumberSql(numbers: readonly number[] | undefined) {
  if (!numbers || numbers.length === 0) {
    return sql`FALSE`;
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

export type EvidenceSearchHit = {
  id: string;
  sourceId: string;
  title: string | null;
  url: string | null;
  snippet: string | null;
  score: number;
  repositoryId: string | null;
  entityId: string | null;
};

export async function searchEvidence(
  db: Database,
  input: {
    tenantId: string;
    repositoryIds: string[];
    text: string;
    since: Date | null;
    until?: Date | null;
    config: LlmConfig | null;
    sourceIdPrefix?: string;
    subjectNumbers?: readonly number[];
    discussionContentTokens?: readonly string[];
  },
): Promise<EvidenceSearchHit[]> {
  if (input.repositoryIds.length === 0) {
    return [];
  }
  const constraints = {
    since: input.since,
    until: input.until ?? null,
    text: input.text,
    sourceIdPrefix: input.sourceIdPrefix,
    subjectNumbers: input.subjectNumbers,
    discussionContentTokens: input.discussionContentTokens,
  };
  const textHits = await searchText(
    db,
    input.tenantId,
    input.repositoryIds,
    constraints,
  );
  const vectorHits =
    input.config && input.discussionContentTokens === undefined
      ? await searchVectors(
          db,
          input.tenantId,
          input.config,
          input.repositoryIds,
          constraints,
        )
      : [];
  const fused = fuseHits(textHits, vectorHits);
  const docs = selectCappedEvidence(
    await loadDocuments(db, input.tenantId, fused),
    input.sourceIdPrefix,
    EVIDENCE_RESULT_LIMIT,
  );
  const repositoryBySource = await repositoryIdsForSources(
    db,
    input.tenantId,
    docs.map((doc) => doc.sourceId),
  );
  return docs.map((doc) => ({
    id: doc.documentId,
    sourceId: doc.sourceId,
    title: doc.title,
    url: doc.url,
    snippet: doc.snippet,
    score: doc.score,
    repositoryId: repositoryBySource.get(doc.sourceId) ?? null,
    entityId: doc.entityId,
  }));
}

function repositoryFilter(repositoryIds: string[]) {
  return sql`e.payload->>'repositoryId' IN (${sql.join(
    repositoryIds.map((id) => sql`${id}`),
    sql`, `,
  )})`;
}

async function searchText(
  db: Database,
  tenantId: string,
  repositoryIds: string[],
  constraints: {
    since: Date | null;
    until: Date | null;
    text: string;
    sourceIdPrefix: string | undefined;
    subjectNumbers: readonly number[] | undefined;
    discussionContentTokens: readonly string[] | undefined;
  },
): Promise<Array<{ documentId: string; score: number }>> {
  const since = constraints.since?.toISOString() ?? null;
  const until = constraints.until?.toISOString() ?? null;
  const sourcePattern = sourceLikePattern(constraints.sourceIdPrefix);
  const lexicalDocument = sql`regexp_replace(regexp_replace(coalesce(d.title, '') || ' ' || coalesce(d.body, ''), ${SYNTHETIC_EVENT_TYPE_PATTERN}, ' ', 'gi'), ${LEXICAL_SEPARATORS}, ' ', 'g')`;
  if (constraints.discussionContentTokens !== undefined) {
    const contentQuery =
      constraints.discussionContentTokens.length === 0
        ? null
        : constraints.discussionContentTokens.map((token) => `${token}:*`).join(" | ");
    const topicDocument = sql`regexp_replace(lower(${lexicalDocument}), ${DISCUSSION_IDENTIFIER}, ' ', 'g')`;
    const contentRank = contentQuery
      ? sql`ts_rank(to_tsvector('english', ${topicDocument}), to_tsquery('english', ${contentQuery}))`
      : sql`0`;
    const contentMatch = contentQuery
      ? sql`to_tsvector('english', ${topicDocument}) @@ to_tsquery('english', ${contentQuery})`
      : sql`TRUE`;
    const rows = await db.execute<{ id: string; score: number }>(sql`
      SELECT d.id, ${contentRank} AS score
      FROM documents d
      LEFT JOIN events e
        ON e.tenant_id = d.tenant_id
       AND e.source_system = d.source_system
       AND e.source_event_id = d.source_id
      WHERE d.tenant_id = ${tenantId}
        AND ${repositoryFilter(repositoryIds)}
        AND (${sourcePattern}::text IS NULL OR d.source_id LIKE ${sourcePattern} ESCAPE '!')
        AND ${subjectNumberSql(constraints.subjectNumbers)}
        AND ${contentMatch}
        AND (${since}::timestamptz IS NULL OR e.event_time >= ${since})
        AND (${until}::timestamptz IS NULL OR e.event_time <= ${until})
      ORDER BY score DESC
      LIMIT ${SEARCH_CANDIDATE_LIMIT}
    `);
    return rows.map((row) => ({
      documentId: row.id,
      score: Number(row.score),
    }));
  }
  const orQuery = keywordOrQuery(constraints.text);
  if (!orQuery && (!constraints.subjectNumbers || constraints.subjectNumbers.length === 0)) {
    return [];
  }
  const lexicalRank = orQuery
    ? sql`ts_rank(to_tsvector('english', ${lexicalDocument}), to_tsquery('english', ${orQuery}))`
    : sql`0`;
  const lexicalMatch = orQuery
    ? sql`to_tsvector('english', ${lexicalDocument}) @@ to_tsquery('english', ${orQuery})`
    : sql`FALSE`;
  const rows = await db.execute<{ id: string; score: number }>(sql`
    SELECT d.id, ${lexicalRank} AS score
    FROM documents d
    LEFT JOIN events e
      ON e.tenant_id = d.tenant_id
     AND e.source_system = d.source_system
     AND e.source_event_id = d.source_id
    WHERE d.tenant_id = ${tenantId}
      AND ${repositoryFilter(repositoryIds)}
      AND (${sourcePattern}::text IS NULL OR d.source_id LIKE ${sourcePattern} ESCAPE '!')
      AND (
        ${lexicalMatch}
        OR (${sourcePattern}::text IS NOT NULL AND ${subjectNumberSql(constraints.subjectNumbers)})
      )
      AND (${since}::timestamptz IS NULL OR e.event_time >= ${since})
      AND (${until}::timestamptz IS NULL OR e.event_time <= ${until})
    ORDER BY score DESC
    LIMIT ${SEARCH_CANDIDATE_LIMIT}
  `);

  return rows.map((row) => ({
    documentId: row.id,
    score: Number(row.score),
  }));
}

async function searchVectors(
  db: Database,
  tenantId: string,
  config: LlmConfig,
  repositoryIds: string[],
  constraints: {
    since: Date | null;
    until: Date | null;
    text: string;
    sourceIdPrefix: string | undefined;
    subjectNumbers: readonly number[] | undefined;
  },
): Promise<Array<{ documentId: string; score: number }>> {
  let vector: number[];
  try {
    const [embedded] = await embedTexts(config, [constraints.text]);
    if (!embedded) {
      return [];
    }
    vector = embedded;
  } catch (error) {
    console.error("[retrieval] query embedding failed", error);
    return [];
  }

  const literal = `[${vector.join(",")}]`;
  const since = constraints.since?.toISOString() ?? null;
  const until = constraints.until?.toISOString() ?? null;
  const sourcePattern = sourceLikePattern(constraints.sourceIdPrefix);
  const rows = await db.execute<{ document_id: string; score: number }>(sql`
    SELECT c.document_id, (1 - (c.embedding <=> ${literal}::vector)) AS score
    FROM document_chunks c
    JOIN documents d ON d.id = c.document_id
    LEFT JOIN events e
      ON e.tenant_id = d.tenant_id
     AND e.source_system = d.source_system
     AND e.source_event_id = d.source_id
    WHERE d.tenant_id = ${tenantId}
      AND ${repositoryFilter(repositoryIds)}
      AND (${sourcePattern}::text IS NULL OR d.source_id LIKE ${sourcePattern} ESCAPE '!')
      AND c.embedding IS NOT NULL
      AND (${since}::timestamptz IS NULL OR e.event_time >= ${since})
      AND (${until}::timestamptz IS NULL OR e.event_time <= ${until})
    ORDER BY c.embedding <=> ${literal}::vector
    LIMIT ${SEARCH_CANDIDATE_LIMIT}
  `);

  return rows.map((row) => ({
    documentId: row.document_id,
    score: Number(row.score),
  }));
}

async function loadDocuments(
  db: Database,
  tenantId: string,
  hits: Array<{ documentId: string; score: number }>,
): Promise<RetrievedDoc[]> {
  if (hits.length === 0) {
    return [];
  }
  const rows = await db.query.documents.findMany({
    where: and(
      eq(documents.tenantId, tenantId),
      inArray(
        documents.id,
        hits.map((hit) => hit.documentId),
      ),
    ),
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return hits.flatMap((hit) => {
    const row = byId.get(hit.documentId);
    if (!row) {
      return [];
    }
    return [
      {
        documentId: row.id,
        title: row.title,
        snippet: row.body?.slice(0, 400) ?? null,
        url: row.url,
        entityId: row.entityId,
        sourceId: row.sourceId,
        score: hit.score,
      },
    ];
  });
}

async function repositoryIdsForSources(
  db: Database,
  tenantId: string,
  sourceIds: string[],
): Promise<Map<string, string>> {
  if (sourceIds.length === 0) {
    return new Map();
  }
  const rows = await db.query.events.findMany({
    where: and(
      eq(events.tenantId, tenantId),
      inArray(events.sourceEventId, sourceIds),
    ),
  });
  const mapped = new Map<string, string>();
  for (const row of rows) {
    const repositoryId = row.payload.repositoryId;
    if (typeof repositoryId === "string") {
      mapped.set(row.sourceEventId, repositoryId);
    }
  }
  return mapped;
}
