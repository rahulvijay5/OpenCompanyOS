import { llmConfigFromEnv, loadEnv } from "@opencompanyos/config";
import { events, type Database } from "@opencompanyos/db";
import { indexEvent } from "@opencompanyos/retrieval";
import { materializeEventGraph } from "./entities.js";

export async function upsertEvent(
  db: Database,
  input: {
    tenantId: string;
    sourceEventId: string;
    eventType: string;
    eventTime: Date | null;
    payload: Record<string, unknown>;
  },
): Promise<string> {
  const observedAt = new Date();
  const inserted = await db
    .insert(events)
    .values({
      tenantId: input.tenantId,
      sourceSystem: "github",
      sourceEventId: input.sourceEventId,
      eventType: input.eventType,
      eventTime: input.eventTime,
      observedAt,
      payload: input.payload,
      createdAt: observedAt,
    })
    .onConflictDoUpdate({
      target: [events.tenantId, events.sourceSystem, events.sourceEventId],
      set: {
        eventType: input.eventType,
        eventTime: input.eventTime,
        observedAt,
        payload: input.payload,
      },
    })
    .returning({ id: events.id });

  const eventId = inserted[0]?.id;
  if (!eventId) {
    throw new Error("failed_to_upsert_event");
  }

  await materializeEventGraph(db, {
    tenantId: input.tenantId,
    eventId,
    sourceEventId: input.sourceEventId,
    eventTime: input.eventTime,
    payload: input.payload,
  });

  await indexEvent(db, eventId, llmConfigFromProcess());

  return eventId;
}

function llmConfigFromProcess() {
  try {
    return llmConfigFromEnv(loadEnv());
  } catch {
    return null;
  }
}

export type EventSummary = {
  id: string;
  eventType: string;
  sourceEventId: string;
  eventTime: Date | null;
  observedAt: Date;
  payload: Record<string, unknown>;
};

export async function listRecentEvents(
  db: Database,
  tenantId: string,
  limit = 20,
): Promise<EventSummary[]> {
  const rows = await db.query.events.findMany({
    where: (table, { eq }) => eq(table.tenantId, tenantId),
    orderBy: (table, { desc }) => [desc(table.observedAt)],
    limit,
  });

  return rows.map((row) => ({
    id: row.id,
    eventType: row.eventType,
    sourceEventId: row.sourceEventId,
    eventTime: row.eventTime,
    observedAt: row.observedAt,
    payload: row.payload,
  }));
}
