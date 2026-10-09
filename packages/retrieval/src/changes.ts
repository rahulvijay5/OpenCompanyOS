import type { Database } from "@opencompanyos/db";
import { sql } from "drizzle-orm";
import { extractQueryConstraints } from "./text.js";

export const CHANGE_KINDS = [
  "opened",
  "closed",
  "merged",
  "pushed",
  "commented",
  "reviewed",
  "updated",
] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

export function classifyChangeKind(eventType: string): ChangeKind {
  if (eventType === "pull_request.merged" || eventType.endsWith(".merged")) {
    return "merged";
  }
  if (
    eventType === "issues.opened" ||
    eventType === "pull_request.opened" ||
    eventType === "issues.reopened" ||
    eventType === "pull_request.reopened"
  ) {
    return "opened";
  }
  if (eventType === "issues.closed" || eventType === "pull_request.closed") {
    return "closed";
  }
  if (eventType === "push.commit" || eventType.startsWith("push.")) {
    return "pushed";
  }
  if (eventType.startsWith("issue_comment.")) {
    return "commented";
  }
  if (
    eventType.startsWith("pull_request_review.") ||
    eventType.startsWith("pull_request_review_comment.")
  ) {
    return "reviewed";
  }
  return "updated";
}

export function asksAboutChanges(query: string, now: Date = new Date()): boolean {
  if (extractQueryConstraints(query, now).since) {
    return true;
  }
  return /\b(changed|changes|change|happened)\b/i.test(query);
}

const kindExpression = sql`(
  CASE
    WHEN e.event_type = 'pull_request.merged' OR e.event_type LIKE '%.merged' THEN 'merged'
    WHEN e.event_type IN (
      'issues.opened', 'pull_request.opened', 'issues.reopened', 'pull_request.reopened'
    ) THEN 'opened'
    WHEN e.event_type IN ('issues.closed', 'pull_request.closed') THEN 'closed'
    WHEN e.event_type = 'push.commit' OR e.event_type LIKE 'push.%' THEN 'pushed'
    WHEN e.event_type LIKE 'issue_comment.%' THEN 'commented'
    WHEN e.event_type LIKE 'pull_request_review.%'
      OR e.event_type LIKE 'pull_request_review_comment.%' THEN 'reviewed'
    ELSE 'updated'
  END
)`;

export type ChangeRecord = {
  id: string;
  kind: ChangeKind;
  eventType: string;
  eventTime: string | null;
  title: string | null;
  url: string | null;
  sourceEventId: string;
  actor: { id: string; name: string } | null;
  object: { id: string; type: string; name: string } | null;
  repository: { id: string | null; name: string | null } | null;
};

type ChangeRow = {
  id: string;
  event_type: string;
  source_event_id: string;
  event_time: Date | string | null;
  payload: Record<string, unknown> | null;
  actor_id: string | null;
  actor_name: string | null;
  object_id: string | null;
  object_type: string | null;
  object_name: string | null;
  object_metadata: Record<string, unknown> | null;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function titleFromPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) {
    return null;
  }
  return (
    asString(payload.title) ??
    asString(payload.message)?.split("\n")[0] ??
    asString(payload.body)?.replace(/\s+/g, " ").slice(0, 120) ??
    null
  );
}

function mapChange(row: ChangeRow): ChangeRecord {
  const payload = row.payload ?? {};
  const repositoryId = asString(payload.repositoryId);
  const repositoryName = asString(payload.fullName);
  return {
    id: row.id,
    kind: classifyChangeKind(row.event_type),
    eventType: row.event_type,
    eventTime:
      row.event_time instanceof Date
        ? row.event_time.toISOString()
        : row.event_time,
    title: titleFromPayload(payload),
    url: asString(payload.htmlUrl),
    sourceEventId: row.source_event_id,
    actor:
      row.actor_id && row.actor_name
        ? { id: row.actor_id, name: row.actor_name }
        : null,
    object:
      row.object_id && row.object_type && row.object_name
        ? { id: row.object_id, type: row.object_type, name: row.object_name }
        : null,
    repository:
      repositoryId || repositoryName
        ? { id: repositoryId, name: repositoryName }
        : null,
  };
}

export async function listChanges(
  db: Database,
  tenantId: string,
  options: {
    since?: Date | null;
    until?: Date | null;
    repositoryId?: string | null;
    kind?: ChangeKind | null;
    limit?: number;
  } = {},
): Promise<ChangeRecord[]> {
  const since = options.since?.toISOString() ?? null;
  const until = options.until?.toISOString() ?? null;
  const repositoryId = options.repositoryId ?? null;
  const kind = options.kind ?? null;
  const limit = options.limit ?? 50;
  const rows = await db.execute<ChangeRow>(sql`
    SELECT
      e.id,
      e.event_type,
      e.source_event_id,
      e.event_time,
      e.payload,
      actor.id AS actor_id,
      actor.canonical_name AS actor_name,
      object.id AS object_id,
      object.type AS object_type,
      object.canonical_name AS object_name,
      object.metadata AS object_metadata
    FROM events e
    LEFT JOIN entities actor ON actor.id = e.actor_entity_id
    LEFT JOIN entities object ON object.id = e.object_entity_id
    WHERE e.tenant_id = ${tenantId}
      AND e.record_kind = 'occurrence'
      AND (${since}::timestamptz IS NULL OR e.event_time >= ${since})
      AND (${until}::timestamptz IS NULL OR e.event_time <= ${until})
      AND (
        ${repositoryId}::text IS NULL
        OR e.payload->>'repositoryId' = ${repositoryId}
      )
      AND (${kind}::text IS NULL OR ${kindExpression} = ${kind})
    ORDER BY e.event_time DESC NULLS LAST
    LIMIT ${limit}
  `);

  return rows.map((row) => mapChange(row));
}

export async function getChange(
  db: Database,
  tenantId: string,
  changeId: string,
): Promise<{
  change: ChangeRecord;
  snapshot: {
    id: string;
    type: string;
    canonicalName: string;
    metadata: Record<string, unknown>;
  } | null;
} | null> {
  const rows = await db.execute<ChangeRow>(sql`
    SELECT
      e.id,
      e.event_type,
      e.source_event_id,
      e.event_time,
      e.payload,
      actor.id AS actor_id,
      actor.canonical_name AS actor_name,
      object.id AS object_id,
      object.type AS object_type,
      object.canonical_name AS object_name,
      object.metadata AS object_metadata
    FROM events e
    LEFT JOIN entities actor ON actor.id = e.actor_entity_id
    LEFT JOIN entities object ON object.id = e.object_entity_id
    WHERE e.tenant_id = ${tenantId}
      AND e.id = ${changeId}
      AND e.record_kind = 'occurrence'
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    change: mapChange(row),
    snapshot:
      row.object_id && row.object_type && row.object_name
        ? {
            id: row.object_id,
            type: row.object_type,
            canonicalName: row.object_name,
            metadata: row.object_metadata ?? {},
          }
        : null,
  };
}
