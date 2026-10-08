import {
  entities,
  entityAliases,
  events,
  relationships,
  type Database,
} from "@opencompanyos/db";
import { and, eq, or, sql } from "drizzle-orm";
import { projectCanonicalGraph, type EntityDraft } from "./graph.js";

async function upsertEntity(
  db: Database,
  tenantId: string,
  draft: EntityDraft,
): Promise<string> {
  const now = new Date();
  const [row] = await db
    .insert(entities)
    .values({
      tenantId,
      type: draft.type,
      canonicalName: draft.canonicalName,
      description: draft.description,
      sourceSystem: "github",
      sourceId: draft.sourceId,
      metadata: draft.metadata,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        entities.tenantId,
        entities.type,
        entities.sourceSystem,
        entities.sourceId,
      ],
      set: {
        canonicalName: draft.canonicalName,
        description: draft.description,
        metadata: draft.metadata,
        updatedAt: now,
      },
    })
    .returning({ id: entities.id });

  if (!row) {
    throw new Error("failed_to_upsert_entity");
  }

  if (draft.alias) {
    const existing = await db.query.entityAliases.findFirst({
      where: and(
        eq(entityAliases.entityId, row.id),
        eq(entityAliases.alias, draft.alias),
      ),
    });
    if (!existing) {
      await db.insert(entityAliases).values({
        entityId: row.id,
        alias: draft.alias,
        sourceSystem: "github",
        sourceId: draft.sourceId,
        confidence: 1,
      });
    }
  }

  return row.id;
}

export async function materializeEventGraph(
  db: Database,
  input: {
    tenantId: string;
    eventId: string;
    sourceEventId: string;
    eventTime: Date | null;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const projection = projectCanonicalGraph({
    sourceEventId: input.sourceEventId,
    payload: input.payload,
  });

  const ids = new Map<string, string>();
  for (const draft of projection.entities) {
    const id = await upsertEntity(db, input.tenantId, draft);
    ids.set(`${draft.type}:${draft.sourceId}`, id);
  }

  const resolve = (ref: { type: string; sourceId: string } | null) =>
    ref ? (ids.get(`${ref.type}:${ref.sourceId}`) ?? null) : null;

  const observedAt = input.eventTime ?? new Date();
  for (const edge of projection.relationships) {
    const sourceEntityId = resolve(edge.source);
    const targetEntityId = resolve(edge.target);
    if (!sourceEntityId || !targetEntityId) {
      continue;
    }

    await db
      .insert(relationships)
      .values({
        tenantId: input.tenantId,
        sourceEntityId,
        relationshipType: edge.relationshipType,
        targetEntityId,
        confidence: 1,
        validFrom: observedAt,
        observedAt,
        sourceEventId: input.eventId,
        metadata: {},
      })
      .onConflictDoUpdate({
        target: [
          relationships.tenantId,
          relationships.sourceEntityId,
          relationships.relationshipType,
          relationships.targetEntityId,
        ],
        set: {
          observedAt,
          sourceEventId: input.eventId,
          confidence: 1,
        },
      });
  }

  await db
    .update(events)
    .set({
      actorEntityId: resolve(projection.actor),
      objectEntityId: resolve(projection.object),
    })
    .where(eq(events.id, input.eventId));
}

export async function projectStoredEvents(
  db: Database,
  tenantId: string,
): Promise<number> {
  const rows = await db.query.events.findMany({
    where: eq(events.tenantId, tenantId),
  });

  for (const row of rows) {
    await materializeEventGraph(db, {
      tenantId,
      eventId: row.id,
      sourceEventId: row.sourceEventId,
      eventTime: row.eventTime,
      payload: row.payload,
    });
  }

  return rows.length;
}

export type EntitySummary = {
  id: string;
  type: string;
  canonicalName: string;
  sourceId: string | null;
  description: string | null;
};

export async function listEntities(
  db: Database,
  tenantId: string,
  options: { type?: string; limit: number },
): Promise<EntitySummary[]> {
  const rows = await db.query.entities.findMany({
    where: options.type
      ? and(eq(entities.tenantId, tenantId), eq(entities.type, options.type))
      : eq(entities.tenantId, tenantId),
    orderBy: (table, { asc }) => [asc(table.type), asc(table.canonicalName)],
    limit: options.limit,
  });

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    canonicalName: row.canonicalName,
    sourceId: row.sourceId,
    description: row.description,
  }));
}

export async function countEntitiesByType(
  db: Database,
  tenantId: string,
): Promise<Array<{ type: string; count: number }>> {
  const rows = await db
    .select({
      type: entities.type,
      count: sql<number>`count(*)::int`,
    })
    .from(entities)
    .where(eq(entities.tenantId, tenantId))
    .groupBy(entities.type);

  return rows.map((row) => ({ type: row.type, count: Number(row.count) }));
}

export async function getEntity(
  db: Database,
  tenantId: string,
  entityId: string,
) {
  return db.query.entities.findFirst({
    where: and(eq(entities.id, entityId), eq(entities.tenantId, tenantId)),
  });
}

export async function listEntityRelationships(
  db: Database,
  tenantId: string,
  entityId: string,
) {
  const rows = await db.query.relationships.findMany({
    where: and(
      eq(relationships.tenantId, tenantId),
      or(
        eq(relationships.sourceEntityId, entityId),
        eq(relationships.targetEntityId, entityId),
      ),
    ),
    limit: 100,
  });

  return rows;
}

export async function listEntityTimeline(
  db: Database,
  tenantId: string,
  entityId: string,
) {
  return db.query.events.findMany({
    where: and(
      eq(events.tenantId, tenantId),
      or(eq(events.actorEntityId, entityId), eq(events.objectEntityId, entityId)),
    ),
    orderBy: (table, { desc }) => [desc(table.eventTime)],
    limit: 50,
  });
}
