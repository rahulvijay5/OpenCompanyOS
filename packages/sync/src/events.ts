import {
  llmConfigFromEnv,
  loadEnv,
  type LlmConfig,
} from "@opencompanyos/config";
import { events, type Database } from "@opencompanyos/db";
import { indexEvent } from "@opencompanyos/retrieval";
import { and, eq } from "drizzle-orm";
import { materializeEventGraph } from "./entities.js";
import { mergeOccurrence } from "./merge.js";

export type RecordKind = "snapshot" | "occurrence";

export function recordKindForSource(sourceEventId: string): RecordKind {
  if (
    sourceEventId.startsWith("github:commit:") ||
    sourceEventId.startsWith("github:issue_comment:") ||
    sourceEventId.startsWith("github:pull_request_review:") ||
    /^github:issue:\d+:/.test(sourceEventId) ||
    /^github:pull_request:\d+:/.test(sourceEventId)
  ) {
    return "occurrence";
  }
  return "snapshot";
}

/**
 * `undefined` keeps the worker behavior: index with whatever LiteLLM config the
 * process env provides. `null` indexes full text only and does not call an
 * embedding API.
 */
export function resolveIndexConfig(
  explicit: LlmConfig | null | undefined,
): LlmConfig | null {
  if (explicit === undefined) {
    return llmConfigFromProcess();
  }
  return explicit;
}

export async function upsertEvent(
  db: Database,
  input: {
    tenantId: string;
    sourceEventId: string;
    eventType: string;
    eventTime: Date | null;
    payload: Record<string, unknown>;
    recordKind?: RecordKind;
    indexConfig?: LlmConfig | null;
  },
): Promise<string> {
  const observedAt = new Date();
  const recordKind = input.recordKind ?? recordKindForSource(input.sourceEventId);
  let eventType = input.eventType;
  let eventTime = input.eventTime;
  let payload = input.payload;

  if (recordKind === "occurrence") {
    const existing = await db.query.events.findFirst({
      where: and(
        eq(events.tenantId, input.tenantId),
        eq(events.sourceSystem, "github"),
        eq(events.sourceEventId, input.sourceEventId),
      ),
    });
    if (existing) {
      const merged = mergeOccurrence(
        {
          eventType: existing.eventType,
          eventTime: existing.eventTime,
          payload: existing.payload,
        },
        {
          eventType: input.eventType,
          eventTime: input.eventTime,
          payload: input.payload,
        },
      );
      eventType = merged.eventType;
      eventTime = merged.eventTime;
      payload = merged.payload;
    }
  }

  const inserted = await db
    .insert(events)
    .values({
      tenantId: input.tenantId,
      sourceSystem: "github",
      sourceEventId: input.sourceEventId,
      eventType,
      eventTime,
      observedAt,
      payload,
      recordKind,
      createdAt: observedAt,
    })
    .onConflictDoUpdate({
      target: [events.tenantId, events.sourceSystem, events.sourceEventId],
      set:
        recordKind === "occurrence"
          ? {
              eventType,
              eventTime,
              observedAt,
              payload,
            }
          : {
              eventType,
              eventTime,
              observedAt,
              payload,
              recordKind,
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
    eventTime,
    payload,
  });

  await indexEvent(db, eventId, resolveIndexConfig(input.indexConfig));

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
