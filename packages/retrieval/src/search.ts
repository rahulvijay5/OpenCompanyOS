import {
  documentChunks,
  documents,
  entities,
  events,
  evidence,
  queries,
  queryEvidence,
  relationships,
  type Database,
} from "@opencompanyos/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { LlmConfig } from "@opencompanyos/config";
import { asksAboutChanges, listChanges, type ChangeRecord } from "./changes.js";
import { completeGroundedAnswer, embedTexts } from "./llm.js";
import {
  chunkText,
  documentBody,
  extractQueryConstraints,
  fuseHits,
  keywordOrQuery,
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

function changeToDoc(change: ChangeRecord): RetrievedDoc {
  const who = change.actor?.name ?? "someone";
  const where = change.repository?.name ? ` in ${change.repository.name}` : "";
  return {
    documentId: change.id,
    title: change.title ?? change.eventType,
    snippet: `${change.kind} by ${who}${where} at ${change.eventTime ?? "unknown time"}`,
    url: change.url,
    entityId: change.object?.id ?? null,
    sourceId: change.sourceEventId,
    score: 1,
  };
}

function mergeEvidence(
  changes: RetrievedDoc[],
  searched: RetrievedDoc[],
): RetrievedDoc[] {
  const seen = new Set<string>();
  const merged: RetrievedDoc[] = [];
  for (const doc of [...changes, ...searched]) {
    if (seen.has(doc.sourceId)) {
      continue;
    }
    seen.add(doc.sourceId);
    merged.push(doc);
    if (merged.length === 8) {
      break;
    }
  }
  return merged;
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

export type QueryAnswer = {
  answer: string;
  confidence: number;
  evidence: Array<{ title: string | null; url: string | null; snippet: string | null }>;
  entities: Array<{ id: string; type: string; canonicalName: string }>;
  traceId: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

export async function answerQuery(
  db: Database,
  input: {
    tenantId: string;
    userId: string;
    query: string;
    config: LlmConfig | null;
  },
): Promise<QueryAnswer> {
  const started = Date.now();
  const constraints = extractQueryConstraints(input.query);
  const changeIntent = asksAboutChanges(input.query);
  const changeSince =
    constraints.since ??
    (changeIntent ? new Date(started - 7 * 24 * 60 * 60 * 1000) : null);
  const searchConstraints = changeIntent
    ? { ...constraints, since: changeSince }
    : constraints;

  const recordedChanges = changeIntent
    ? await listChanges(db, input.tenantId, { since: changeSince, limit: 8 })
    : [];

  const textHits = await searchText(db, input.tenantId, searchConstraints);
  const vectorHits = input.config
    ? await searchVectors(db, input.tenantId, input.config, searchConstraints)
    : [];
  const fused = fuseHits(textHits, vectorHits).slice(0, 8);
  const searched = await loadDocuments(db, input.tenantId, fused);
  const docs = mergeEvidence(recordedChanges.map(changeToDoc), searched);

  const [savedQuery] = await db
    .insert(queries)
    .values({
      tenantId: input.tenantId,
      userId: input.userId,
      queryText: input.query,
    })
    .returning({ id: queries.id });

  if (!savedQuery) {
    throw new Error("failed_to_store_query");
  }

  if (docs.length === 0) {
    const answer = changeIntent
      ? "The indexed activity has no recorded changes in that window."
      : "I don't have evidence in the indexed GitHub activity to answer that.";
    await db
      .update(queries)
      .set({
        answerText: answer,
        model: null,
        latencyMs: Date.now() - started,
      })
      .where(eq(queries.id, savedQuery.id));
    return {
      answer,
      confidence: 0,
      evidence: [],
      entities: [],
      traceId: savedQuery.id,
      latencyMs: Date.now() - started,
      inputTokens: null,
      outputTokens: null,
    };
  }

  const storedEvidence = await persistEvidence(db, input.tenantId, docs);
  await db.insert(queryEvidence).values(
    storedEvidence.map((item, rank) => ({
      queryId: savedQuery.id,
      evidenceId: item.id,
      rank,
      score: docs[rank]?.score ?? null,
    })),
  );

  const entityRows = await loadEntities(
    db,
    input.tenantId,
    docs.map((doc) => doc.entityId).filter((id): id is string => Boolean(id)),
  );

  let answer: string;
  let confidence: number;
  let model: string | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  if (!input.config) {
    answer =
      "Retrieved matching GitHub activity, but LITELLM_BASE_URL is not set, so no generated answer was produced.";
    confidence = docs[0]?.score ?? 0;
  } else {
    try {
      const completion = await completeGroundedAnswer(input.config, {
        question: input.query,
        evidence: docs
          .map(
            (doc, index) =>
              `[${index + 1}] ${doc.title ?? "untitled"}\n${doc.snippet ?? ""}\n${doc.url ?? ""}`,
          )
          .join("\n\n"),
      });
      answer = completion.answer || "The model returned an empty answer.";
      confidence = completion.confidence;
      model = input.config.chatModel;
      inputTokens = completion.inputTokens;
      outputTokens = completion.outputTokens;
    } catch (error) {
      console.error("[retrieval] answer generation failed", error);
      const titles = docs
        .map((doc) => doc.title)
        .filter((title): title is string => Boolean(title))
        .slice(0, 5);
      answer =
        titles.length > 0
          ? `The model is unavailable, so this is the matching activity:\n\n${titles.map((title) => `• ${title}`).join("\n")}`
          : "Matching activity was retrieved, but the model could not produce a grounded answer.";
      confidence = docs[0]?.score ?? 0;
    }
  }

  await db
    .update(queries)
    .set({
      answerText: answer,
      model,
      latencyMs: Date.now() - started,
      inputTokens,
      outputTokens,
    })
    .where(eq(queries.id, savedQuery.id));

  return {
    answer,
    confidence,
    evidence: storedEvidence.map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.snippet,
    })),
    entities: entityRows,
    traceId: savedQuery.id,
    latencyMs: Date.now() - started,
    inputTokens,
    outputTokens,
  };
}

async function searchText(
  db: Database,
  tenantId: string,
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

async function persistEvidence(
  db: Database,
  tenantId: string,
  docs: RetrievedDoc[],
) {
  const created = [];
  for (const doc of docs) {
    const event = await db.query.events.findFirst({
      where: and(
        eq(events.tenantId, tenantId),
        eq(events.sourceEventId, doc.sourceId),
      ),
    });
    const [row] = await db
      .insert(evidence)
      .values({
        tenantId,
        sourceSystem: "github",
        sourceType: "document",
        sourceId: doc.sourceId,
        entityId: doc.entityId,
        title: doc.title,
        snippet: doc.snippet,
        url: doc.url,
        eventId: event?.id ?? null,
      })
      .returning();
    if (row) {
      created.push(row);
    }
  }
  return created;
}

async function loadEntities(db: Database, tenantId: string, ids: string[]) {
  if (ids.length === 0) {
    return [];
  }
  const unique = [...new Set(ids)];
  const direct = await db.query.entities.findMany({
    where: and(eq(entities.tenantId, tenantId), inArray(entities.id, unique)),
  });

  const edges = await db.query.relationships.findMany({
    where: and(
      eq(relationships.tenantId, tenantId),
      inArray(relationships.sourceEntityId, unique),
    ),
    limit: 20,
  });
  const neighborIds = edges.map((edge) => edge.targetEntityId);
  const neighbors =
    neighborIds.length === 0
      ? []
      : await db.query.entities.findMany({
          where: and(
            eq(entities.tenantId, tenantId),
            inArray(entities.id, neighborIds),
          ),
        });

  const combined = [...direct, ...neighbors];
  const seen = new Set<string>();
  return combined
    .filter((entity) => {
      if (seen.has(entity.id)) {
        return false;
      }
      seen.add(entity.id);
      return true;
    })
    .slice(0, 12)
    .map((entity) => ({
      id: entity.id,
      type: entity.type,
      canonicalName: entity.canonicalName,
    }));
}
