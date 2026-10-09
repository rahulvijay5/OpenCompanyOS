import {
  documentChunks,
  documents,
  events,
  type Database,
} from "@opencompanyos/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { LlmConfig } from "@opencompanyos/config";
import { embedTexts } from "./llm.js";
import { chunkText, documentBody, fuseHits, keywordOrQuery } from "./text.js";

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
    config: LlmConfig | null;
  },
): Promise<EvidenceSearchHit[]> {
  if (input.repositoryIds.length === 0) {
    return [];
  }
  const constraints = { since: input.since, text: input.text };
  const textHits = await searchText(
    db,
    input.tenantId,
    input.repositoryIds,
    constraints,
  );
  const vectorHits = input.config
    ? await searchVectors(
        db,
        input.tenantId,
        input.config,
        input.repositoryIds,
        constraints,
      )
    : [];
  const fused = fuseHits(textHits, vectorHits).slice(0, 8);
  const docs = await loadDocuments(db, input.tenantId, fused);
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
  constraints: { since: Date | null; text: string },
): Promise<Array<{ documentId: string; score: number }>> {
  const since = constraints.since?.toISOString() ?? null;
  const orQuery = keywordOrQuery(constraints.text);
  if (!orQuery) {
    return [];
  }
  const rows = await db.execute<{ id: string; score: number }>(sql`
    SELECT d.id, ts_rank(
      to_tsvector('english', coalesce(d.title, '') || ' ' || coalesce(d.body, '')),
      to_tsquery('english', ${orQuery})
    ) AS score
    FROM documents d
    LEFT JOIN events e
      ON e.tenant_id = d.tenant_id
     AND e.source_system = d.source_system
     AND e.source_event_id = d.source_id
    WHERE d.tenant_id = ${tenantId}
      AND ${repositoryFilter(repositoryIds)}
      AND to_tsvector('english', coalesce(d.title, '') || ' ' || coalesce(d.body, ''))
          @@ to_tsquery('english', ${orQuery})
      AND (${since}::timestamptz IS NULL OR e.event_time >= ${since})
    ORDER BY score DESC
    LIMIT 12
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
  constraints: { since: Date | null; text: string },
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
      AND c.embedding IS NOT NULL
      AND (${since}::timestamptz IS NULL OR e.event_time >= ${since})
    ORDER BY c.embedding <=> ${literal}::vector
    LIMIT 12
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
