import type { LlmConfig } from "@opencompanyos/config";
import { entities, events, documents, relationships, type Database } from "@opencompanyos/db";
import {
  asksAboutChanges,
  discussionContentTokens,
  extractQueryConstraints,
  searchEvidence,
} from "@opencompanyos/retrieval";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  issueNumbers,
  matchExactLogin,
  partitionOccurrences,
  resolveCandidates,
} from "./resolve.js";
import { selectAnswerEvidence, sourcePrefixForEvidence, type EvidenceKind } from "./evidence.js";
import { resolveEvidenceKind } from "./intent.js";
import {
  abstentionForQuery,
  acceptTransitionEvidence,
  asksRollingSevenDays,
  eventInRollingInterval,
  rollingSevenDayInterval,
  type RollingSevenDayInterval,
} from "./interval.js";
import { subjectSnapshotEvidence } from "./subject-evidence.js";
import { resolveScope } from "./scope.js";
import {
  AUTHORIZATION_LOCAL_OWNER,
  CONTEXT_PACKAGE_VERSION,
  RELATIONSHIP_TYPES,
  type ContextEvidence,
  type EvidenceInclusionReason,
  type ContextEntityRef,
  type ContextEvent,
  type ContextPackage,
  type ContextRelationship,
  type ContextState,
  type ContextUncertainty,
  type RelationshipType,
} from "./types.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type BuildContextInput = {
  tenantId: string;
  query: string;
  config: LlmConfig | null;
  repositoryIds?: readonly string[];
  entityId?: string;
  sourceId?: string;
  from?: Date;
  to?: Date;
  now?: Date;
  /**
   * Restricts answer evidence. An explicit value overrides query-intent rules.
   * Omitted values use those rules, and an unmatched question stays a metadata query.
   */
  evidenceKind?: EvidenceKind;
};

type EntityHit = {
  id: string;
  type: string;
  canonical_name: string;
  source_id: string | null;
};

function ref(row: EntityHit): ContextEntityRef {
  return {
    id: row.id,
    type: row.type,
    canonicalName: row.canonical_name,
    sourceId: row.source_id,
  };
}

function repositoryPredicate(repositoryIds: string[]) {
  return sql`ev.payload->>'repositoryId' IN (${sql.join(
    repositoryIds.map((id) => sql`${id}`),
    sql`, `,
  )})`;
}

export function resolveContextWindow(
  query: string,
  from: Date | undefined,
  to: Date | undefined,
  now: Date,
): { from: Date | null; to: Date | null; interval: RollingSevenDayInterval | null } {
  if (from || to) {
    return { from: from ?? null, to: to ?? null, interval: null };
  }
  if (asksRollingSevenDays(query)) {
    const interval = rollingSevenDayInterval(now);
    return { from: new Date(interval.start), to: new Date(interval.end), interval };
  }
  const extracted = extractQueryConstraints(query, now);
  if (extracted.since) {
    return { from: extracted.since, to: null, interval: null };
  }
  if (asksAboutChanges(query, now)) {
    return { from: new Date(now.getTime() - WEEK_MS), to: null, interval: null };
  }
  return { from: new Date(now.getTime() - WEEK_MS), to: null, interval: null };
}

export async function buildContext(
  db: Database,
  input: BuildContextInput,
): Promise<ContextPackage> {
  const now = input.now ?? new Date();
  const scope = await resolveScope(
    db,
    input.tenantId,
    input.repositoryIds ?? null,
  );
  const uncertainties: ContextUncertainty[] = [
    {
      code: "no_reconstructed_history",
      message:
        "Activity before this installation is a current snapshot. Earlier transitions were not reconstructed.",
    },
    {
      code: "inline_review_comments_unavailable",
      message:
        "Review decisions can be stored from a repository sync or a webhook. Inline review comments are not imported. A missing inline comment does not mean GitHub has none.",
    },
  ];
  if (scope.rejected.length > 0) {
    uncertainties.push({
      code: "repository_not_in_scope",
      message: `Dropped repository ids that are not selected: ${scope.rejected.join(", ")}.`,
    });
  }

  const range = resolveContextWindow(input.query, input.from, input.to, now);
  const subject = await resolveSubject(db, input, scope.repositoryIds);
  if (subject.status === "ambiguous") {
    uncertainties.push({
      code: "ambiguous_subject",
      message: "More than one entity matched. No single subject was chosen.",
    });
  }
  if (subject.status === "unresolved" && requestedSubject(input)) {
    uncertainties.push({
      code: "unresolved_subject",
      message:
        "No entity matched the requested id, source id, issue number, or exact login inside the selected repositories.",
    });
  }

  const subjectIds =
    subject.status === "resolved" ? [subject.entity.id] : [];
  const currentState =
    scope.repositoryIds.length === 0
      ? []
      : await loadCurrentState(db, input.tenantId, scope.repositoryIds, subjectIds);
  const observed = await loadOccurrences(
    db,
    input.tenantId,
    scope.repositoryIds,
    subjectIds,
    range.from,
    range.to,
  );
  const partitioned = partitionOccurrences(observed, range.from, range.to);
  const retrievalInterval = range.interval;
  const includedEvents = retrievalInterval
    ? partitioned.included.filter((event) =>
        acceptTransitionEvidence(
          { eventTime: event.eventTime, recordKind: event.recordKind },
          retrievalInterval,
        ),
      )
    : partitioned.included;
  if (partitioned.missingTime || (await hasUntimedOccurrences(db, input.tenantId, scope.repositoryIds))) {
    uncertainties.push({
      code: "event_time_missing",
      message:
        "Some occurrences have no source event time. They are kept out of the time window.",
    });
  }

  const hops =
    subject.status === "resolved" && scope.repositoryIds.length > 0
      ? await loadRelationships(db, input.tenantId, subject.entity.id)
      : [];

  const evidenceKind = resolveEvidenceKind(input.query, input.evidenceKind);
  const sourceIdPrefix = sourcePrefixForEvidence(evidenceKind);
  const asksForNumber = issueNumbers(input.query).length > 0;
  const commentNumbers = evidenceKind === "issue_comment" ? issueNumbers(input.query) : [];
  const reviewNumbers = evidenceKind === "pull_request_review" ? issueNumbers(input.query) : [];
  const snapshotDecision = subjectSnapshotEvidence({
    ...(evidenceKind ? { evidenceKind } : {}),
    subject,
    states: currentState,
    from: range.from,
    to: range.to,
    asksForNumber,
  });
  const searched =
    snapshotDecision.mode === "snapshots" || scope.repositoryIds.length === 0
      ? []
      : await searchEvidence(db, {
          tenantId: input.tenantId,
          repositoryIds: scope.repositoryIds,
          text: input.query,
          since: range.from,
          until: range.to,
          config: input.config,
          ...(sourceIdPrefix ? { sourceIdPrefix } : {}),
          ...(commentNumbers.length > 0
            ? {
                subjectNumbers: commentNumbers,
                discussionContentTokens: discussionContentTokens(input.query),
              }
            : {}),
          ...(reviewNumbers.length > 0 ? { subjectNumbers: reviewNumbers } : {}),
        });

  const searchedEvidence = selectAnswerEvidence(
    searched.map((hit) => ({
      id: hit.id,
      sourceId: hit.sourceId,
      title: hit.title,
      url: hit.url,
      snippet: hit.snippet,
      score: hit.score,
      repositoryId: hit.repositoryId,
    })),
    evidenceKind,
  );
  const loadedEvidence =
    snapshotDecision.mode === "snapshots"
      ? await loadSnapshotEvidence(
          db,
          input.tenantId,
          scope.repositoryIds,
          snapshotDecision.sourceIds,
        )
      : await annotateSearchEvidence(db, input.tenantId, searchedEvidence, {
          changeQuestion: asksAboutChanges(input.query, now),
          interval: range.interval,
        });
  const interval = range.interval;
  const evidence =
    interval === null
      ? loadedEvidence
      : loadedEvidence.filter((item) =>
          item.inclusionReason === "current_snapshot"
            ? item.eventTime !== null && eventInRollingInterval(new Date(item.eventTime), interval)
            : true,
        );
  if (evidence.length === 0) {
    uncertainties.push({
      code: "insufficient_evidence",
      message: "No indexed evidence was found inside the selected repositories.",
    });
  }

  return {
    version: CONTEXT_PACKAGE_VERSION,
    scope: {
      tenantId: input.tenantId,
      repositoryIds: scope.repositoryIds,
      authorization: AUTHORIZATION_LOCAL_OWNER,
    },
    subject,
    currentState,
    events: includedEvents,
    relationships: hops,
    evidence,
    uncertainties,
    interval: range.interval,
    coverage: abstentionForQuery(input.query),
  };
}

async function loadSnapshotEvidence(
  db: Database,
  tenantId: string,
  repositoryIds: string[],
  sourceIds: string[],
): Promise<ContextEvidence[]> {
  if (sourceIds.length === 0 || repositoryIds.length === 0) {
    return [];
  }
  const [docs, rows] = await Promise.all([
    db.query.documents.findMany({
      where: and(eq(documents.tenantId, tenantId), inArray(documents.sourceId, sourceIds)),
    }),
    db.query.events.findMany({
      where: and(eq(events.tenantId, tenantId), inArray(events.sourceEventId, sourceIds)),
    }),
  ]);
  const repositoryBySource = new Map<string, string>();
  for (const row of rows) {
    const repositoryId = row.payload.repositoryId;
    if (typeof repositoryId === "string" && repositoryIds.includes(repositoryId)) {
      repositoryBySource.set(row.sourceEventId, repositoryId);
    }
  }
  const bySource = new Map(docs.map((doc) => [doc.sourceId, doc]));
  const eventTimeBySource = new Map<string, string | null>();
  for (const row of rows) {
    if (row.recordKind !== "snapshot" || eventTimeBySource.has(row.sourceEventId)) {
      continue;
    }
    eventTimeBySource.set(
      row.sourceEventId,
      row.eventTime ? new Date(row.eventTime).toISOString() : null,
    );
  }
  return sourceIds.flatMap((sourceId) => {
    const doc = bySource.get(sourceId);
    const repositoryId = repositoryBySource.get(sourceId);
    if (!doc || !repositoryId) {
      return [];
    }
    return [
      {
        id: doc.id,
        sourceId: doc.sourceId,
        title: doc.title,
        url: doc.url,
        snippet: doc.body?.slice(0, 400) ?? null,
        score: 1,
        repositoryId,
        eventTime: eventTimeBySource.get(sourceId) ?? null,
        recordKind: "snapshot" as const,
        inclusionReason: "current_snapshot" as const,
      },
    ];
  });
}

async function annotateSearchEvidence(
  db: Database,
  tenantId: string,
  hits: Array<Omit<ContextEvidence, "eventTime" | "recordKind" | "inclusionReason">>,
  options: { changeQuestion: boolean; interval: RollingSevenDayInterval | null },
): Promise<ContextEvidence[]> {
  const facts = await loadEventFacts(
    db,
    tenantId,
    hits.map((hit) => hit.sourceId),
  );
  const annotated = hits.map((hit) => {
    const fact = facts.get(hit.sourceId);
    const inclusionReason: EvidenceInclusionReason =
      options.changeQuestion && options.interval ? "event_in_interval" : "stored_search_hit";
    return {
      ...hit,
      url: hit.url,
      eventTime: fact?.eventTime ?? null,
      recordKind: fact?.recordKind ?? null,
      inclusionReason,
    };
  });
  if (!options.changeQuestion) {
    return annotated;
  }
  return annotated.filter((item) =>
    acceptTransitionEvidence(
      { eventTime: item.eventTime, recordKind: item.recordKind },
      options.interval,
    ),
  );
}

async function loadEventFacts(db: Database, tenantId: string, sourceIds: string[]) {
  const facts = new Map<string, { eventTime: string | null; recordKind: "snapshot" | "occurrence" | null }>();
  if (sourceIds.length === 0) {
    return facts;
  }
  const rows = await db.execute<{
    source_event_id: string;
    record_kind: string;
    event_time: Date | null;
  }>(sql`
    select source_event_id, record_kind, event_time
    from events
    where tenant_id = ${tenantId}
      and source_event_id in (${sql.join(
        sourceIds.map((id) => sql`${id}`),
        sql`, `,
      )})
  `);
  for (const row of rows) {
    const recordKind =
      row.record_kind === "snapshot" || row.record_kind === "occurrence" ? row.record_kind : null;
    const eventTime = row.event_time ? new Date(row.event_time).toISOString() : null;
    const current = facts.get(row.source_event_id);
    if (!current || (current.eventTime === null && eventTime !== null)) {
      facts.set(row.source_event_id, { eventTime, recordKind });
    }
  }
  return facts;
}

function requestedSubject(input: BuildContextInput): boolean {
  return Boolean(
    input.entityId || input.sourceId || issueNumbers(input.query).length > 0,
  );
}

async function resolveSubject(
  db: Database,
  input: BuildContextInput,
  repositoryIds: string[],
): Promise<ContextPackage["subject"]> {
  if (repositoryIds.length === 0) {
    return { status: "unresolved" };
  }
  if (input.entityId) {
    const rows = await entitiesInScope(db, input.tenantId, repositoryIds, {
      entityId: input.entityId,
    });
    return resolveCandidates(rows.map(ref));
  }
  if (input.sourceId) {
    const rows = await entitiesInScope(db, input.tenantId, repositoryIds, {
      sourceId: input.sourceId,
    });
    return resolveCandidates(rows.map(ref));
  }

  const numbers = issueNumbers(input.query);
  if (numbers.length > 0) {
    const matches: ContextEntityRef[] = [];
    for (const number of numbers) {
      const rows = await entitiesInScope(db, input.tenantId, repositoryIds, {
        number,
      });
      matches.push(...rows.map(ref));
    }
    return resolveCandidates(matches);
  }

  const people = await entitiesInScope(db, input.tenantId, repositoryIds, {
    type: "Person",
  });
  return resolveCandidates(matchExactLogin(input.query, people.map(ref)));
}

async function entitiesInScope(
  db: Database,
  tenantId: string,
  repositoryIds: string[],
  filter: {
    entityId?: string;
    sourceId?: string;
    number?: number;
    type?: string;
  },
): Promise<EntityHit[]> {
  const number =
    filter.number === undefined ? null : String(filter.number);
  const rows = await db.execute<EntityHit>(sql`
    SELECT DISTINCT ent.id, ent.type, ent.canonical_name, ent.source_id
    FROM entities ent
    WHERE ent.tenant_id = ${tenantId}
      AND (${filter.entityId ?? null}::uuid IS NULL OR ent.id = ${filter.entityId ?? null}::uuid)
      AND (${filter.sourceId ?? null}::text IS NULL OR ent.source_id = ${filter.sourceId ?? null})
      AND (${filter.type ?? null}::text IS NULL OR ent.type = ${filter.type ?? null})
      AND (
        ${number}::text IS NULL
        OR (
          ent.type IN ('Issue', 'PullRequest')
          AND ent.metadata->>'number' = ${number}
        )
      )
      AND (
        EXISTS (
          SELECT 1 FROM events ev
          WHERE ev.tenant_id = ent.tenant_id
            AND (ev.object_entity_id = ent.id OR ev.actor_entity_id = ent.id)
            AND ${repositoryPredicate(repositoryIds)}
        )
        OR EXISTS (
          SELECT 1 FROM repositories repo
          WHERE repo.tenant_id = ent.tenant_id
            AND repo.id IN (${sql.join(
              repositoryIds.map((id) => sql`${id}`),
              sql`, `,
            )})
            AND ent.source_id = 'github:repo:' || repo.full_name
        )
      )
  `);
  return rows;
}

async function loadCurrentState(
  db: Database,
  tenantId: string,
  repositoryIds: string[],
  subjectIds: string[],
): Promise<ContextState[]> {
  const subjectFilter =
    subjectIds.length === 0
      ? sql`TRUE`
      : sql`ev.object_entity_id::text IN (${sql.join(
          subjectIds.map((id) => sql`${id}`),
          sql`, `,
        )})`;
  const rows = await db.execute<{
    entity_id: string;
    source_event_id: string;
    event_time: Date | null;
    observed_at: Date;
    payload: Record<string, unknown>;
  }>(sql`
    SELECT ev.object_entity_id AS entity_id, ev.source_event_id, ev.event_time, ev.observed_at, ev.payload
    FROM events ev
    WHERE ev.tenant_id = ${tenantId}
      AND ev.record_kind = 'snapshot'
      AND ev.object_entity_id IS NOT NULL
      AND ${repositoryPredicate(repositoryIds)}
      AND ${subjectFilter}
    ORDER BY ev.observed_at DESC
    LIMIT 8
  `);

  return rows.flatMap((row) => {
    if (!row.entity_id) {
      return [];
    }
    const state =
      typeof row.payload.state === "string"
        ? row.payload.state
        : row.payload.merged === true
          ? "merged"
          : null;
    const title = typeof row.payload.title === "string" ? row.payload.title : null;
    return [
      {
        recordKind: "snapshot" as const,
        entityId: row.entity_id,
        sourceId: row.source_event_id,
        state,
        title,
        eventTime: row.event_time ? new Date(row.event_time).toISOString() : null,
        observedAt: new Date(row.observed_at).toISOString(),
      },
    ];
  });
}

async function loadOccurrences(
  db: Database,
  tenantId: string,
  repositoryIds: string[],
  subjectIds: string[],
  from: Date | null,
  to: Date | null,
): Promise<ContextEvent[]> {
  if (repositoryIds.length === 0) {
    return [];
  }
  const since = from?.toISOString() ?? null;
  const until = to?.toISOString() ?? null;
  const subjectFilter =
    subjectIds.length === 0
      ? sql`TRUE`
      : sql`(ev.object_entity_id::text IN (${sql.join(
          subjectIds.map((id) => sql`${id}`),
          sql`, `,
        )}) OR ev.actor_entity_id::text IN (${sql.join(
          subjectIds.map((id) => sql`${id}`),
          sql`, `,
        )}))`;
  const rows = await db.execute<{
    id: string;
    event_type: string;
    source_event_id: string;
    event_time: Date | null;
    observed_at: Date;
    payload: Record<string, unknown>;
  }>(sql`
    SELECT ev.id, ev.event_type, ev.source_event_id, ev.event_time, ev.observed_at, ev.payload
    FROM events ev
    WHERE ev.tenant_id = ${tenantId}
      AND ev.record_kind = 'occurrence'
      AND ${repositoryPredicate(repositoryIds)}
      AND (${since}::timestamptz IS NULL OR ev.event_time >= ${since})
      AND (${until}::timestamptz IS NULL OR ev.event_time <= ${until})
      AND ${subjectFilter}
    ORDER BY ev.event_time DESC NULLS LAST
    LIMIT 20
  `);

  return rows.map((row) => ({
    recordKind: "occurrence" as const,
    id: row.id,
    eventType: row.event_type,
    sourceEventId: row.source_event_id,
    eventTime: row.event_time ? new Date(row.event_time).toISOString() : null,
    observedAt: new Date(row.observed_at).toISOString(),
    title:
      typeof row.payload.title === "string"
        ? row.payload.title
        : typeof row.payload.message === "string"
          ? row.payload.message
          : null,
    url: typeof row.payload.htmlUrl === "string" ? row.payload.htmlUrl : null,
  }));
}

async function hasUntimedOccurrences(
  db: Database,
  tenantId: string,
  repositoryIds: string[],
): Promise<boolean> {
  if (repositoryIds.length === 0) {
    return false;
  }
  const rows = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count
    FROM events ev
    WHERE ev.tenant_id = ${tenantId}
      AND ev.record_kind = 'occurrence'
      AND ev.event_time IS NULL
      AND ${repositoryPredicate(repositoryIds)}
  `);
  return Number(rows[0]?.count ?? 0) > 0;
}

async function loadRelationships(
  db: Database,
  tenantId: string,
  entityId: string,
): Promise<ContextRelationship[]> {
  const nearby = await db.query.relationships.findMany({
    where: and(
      eq(relationships.tenantId, tenantId),
      inArray(relationships.relationshipType, [...RELATIONSHIP_TYPES]),
      or(
        eq(relationships.sourceEntityId, entityId),
        eq(relationships.targetEntityId, entityId),
      ),
    ),
    limit: 20,
  });
  if (nearby.length === 0) {
    return [];
  }
  const ids = [
    ...new Set(nearby.flatMap((edge) => [edge.sourceEntityId, edge.targetEntityId])),
  ];
  const rows = await db.query.entities.findMany({
    where: and(eq(entities.tenantId, tenantId), inArray(entities.id, ids)),
  });
  const names = new Map(rows.map((row) => [row.id, row.canonicalName]));
  return nearby.flatMap((edge) => {
    if (!isRelationshipType(edge.relationshipType)) {
      return [];
    }
    return [
      {
        type: edge.relationshipType,
        sourceId: edge.sourceEntityId,
        sourceName: names.get(edge.sourceEntityId) ?? edge.sourceEntityId,
        targetId: edge.targetEntityId,
        targetName: names.get(edge.targetEntityId) ?? edge.targetEntityId,
        validFrom: edge.validFrom ? edge.validFrom.toISOString() : null,
      },
    ];
  });
}

function isRelationshipType(value: string): value is RelationshipType {
  return (RELATIONSHIP_TYPES as readonly string[]).includes(value);
}
