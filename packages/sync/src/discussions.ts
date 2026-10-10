import { entities, events, type Database } from "@opencompanyos/db";
import type { DiscussionRecord } from "@opencompanyos/github";
import { and, eq, inArray, sql } from "drizzle-orm";
import { upsertEvent } from "./events.js";
import type { LlmConfig } from "@opencompanyos/config";

export async function resolveCommentPayload(
  db: Database,
  tenantId: string,
  repositoryId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const issueNumber = typeof payload.issueNumber === "number" ? payload.issueNumber : null;
  if (issueNumber === null) {
    return {
      ...payload,
      association: "unresolved",
    };
  }

  const rows = await db
    .select({
      type: entities.type,
      sourceId: entities.sourceId,
    })
    .from(entities)
    .innerJoin(
      events,
      and(
        eq(events.tenantId, entities.tenantId),
        eq(events.sourceEventId, entities.sourceId),
      ),
    )
    .where(
      and(
        eq(entities.tenantId, tenantId),
        inArray(entities.type, ["Issue", "PullRequest"]),
        sql`${entities.metadata}->>'number' = ${String(issueNumber)}`,
        sql`${events.payload}->>'repositoryId' = ${repositoryId}`,
      ),
    );

  const matches = rows.flatMap((row) => {
    const parsed = /^(github:(?:issue|pull_request)):(\d+)$/.exec(row.sourceId ?? "");
    if (!parsed?.[2]) {
      return [];
    }
    return [{ type: row.type, id: Number(parsed[2]) }];
  });

  const next = { ...payload };
  delete next.issueId;
  delete next.pullRequestId;
  if (matches.length !== 1) {
    next.association = "unresolved";
    return next;
  }

  const match = matches[0];
  if (!match) {
    next.association = "unresolved";
    return next;
  }
  delete next.association;
  if (match.type === "PullRequest") {
    next.pullRequestId = match.id;
    return next;
  }
  next.issueId = match.id;
  return next;
}

export async function storeDiscussionRecords(
  db: Database,
  input: {
    tenantId: string;
    repositoryId: string;
    fullName: string;
    records: DiscussionRecord[];
    indexConfig?: LlmConfig | null;
    resolveComments?: boolean;
  },
): Promise<number> {
  let stored = 0;
  for (const record of input.records) {
    const scoped = {
      ...record.payload,
      repositoryId: input.repositoryId,
      fullName: input.fullName,
    };
    const payload =
      input.resolveComments === false || !record.sourceEventId.startsWith("github:issue_comment:")
        ? scoped
        : await resolveCommentPayload(db, input.tenantId, input.repositoryId, scoped);
    await upsertEvent(db, {
      tenantId: input.tenantId,
      sourceEventId: record.sourceEventId,
      eventType: record.eventType,
      eventTime: record.eventTime,
      payload,
      ...(input.indexConfig !== undefined ? { indexConfig: input.indexConfig } : {}),
    });
    stored += 1;
  }
  return stored;
}
