import { randomUUID } from "node:crypto";
import { schema, createSqlClient } from "@opencompanyos/db";
import { searchEvidence } from "@opencompanyos/retrieval";
import { upsertEvent } from "@opencompanyos/sync";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildContext } from "./build.js";
import { resolveEvalDatabaseUrl } from "./quality/database.js";
import { FASTAPI_V2_SLUG } from "./quality/import-fastapi-v2.js";

const embedCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("@opencompanyos/retrieval", async () => {
  const actual = await vi.importActual<typeof import("@opencompanyos/retrieval")>(
    "@opencompanyos/retrieval",
  );
  return {
    ...actual,
    embedTexts: async () => {
      embedCalls.count += 1;
      throw new Error("embedding_called");
    },
  };
});

const resolution = resolveEvalDatabaseUrl(process.env);
const sql = resolution.status === "ready" ? createSqlClient(resolution.url) : null;
const db = sql ? drizzle(sql, { schema }) : null;

afterAll(async () => {
  await sql?.end();
});

const insideId = "github:issue:910015";
const beforeId = "github:issue:910001";
const afterId = "github:issue:910020";
const commentInsideId = "github:issue_comment:910016";
const commentAfterId = "github:issue_comment:910021";
const recentId = "github:issue:910109";
const oldId = "github:issue:910090";
const futureId = "github:issue:910112";

describe.skipIf(!db || resolution.status !== "ready")("evidence window contract", () => {
  const database = db!;
  const runId = randomUUID();
  const installationNumber = 8_520_000_000 + Number.parseInt(runId.replace(/-/g, "").slice(0, 6), 16);
  let tenantId = "";
  let userId = "";
  let repositoryId = "";

  beforeAll(async () => {
    const names = await sql!< { name: string }[]>`select current_database() as name`;
    expect(names[0]?.name).toBe("opencompanyos_eval");
    const [user] = await database
      .insert(schema.users)
      .values({ email: `window-${runId}@context-quality.invalid`, name: "Window contract" })
      .returning({ id: schema.users.id });
    const [tenant] = await database
      .insert(schema.tenants)
      .values({ name: "Window contract", slug: `window-${runId}` })
      .returning({ id: schema.tenants.id });
    if (!user || !tenant) {
      throw new Error("fixture_insert_failed");
    }
    userId = user.id;
    tenantId = tenant.id;
    await database.insert(schema.tenantMembers).values({
      tenantId,
      userId,
      role: "owner",
    });
    const [installation] = await database
      .insert(schema.githubInstallations)
      .values({
        tenantId,
        githubInstallationId: installationNumber,
        githubAccountId: installationNumber + 1,
        githubAccountLogin: "window-contract",
        githubAccountType: "Organization",
        status: "active",
      })
      .returning({ id: schema.githubInstallations.id });
    const [repository] = await database
      .insert(schema.repositories)
      .values({
        tenantId,
        githubInstallationId: installation!.id,
        githubRepositoryId: installationNumber + 10,
        ownerLogin: "window-contract",
        name: "window",
        fullName: "window-contract/window",
        selected: true,
      })
      .returning({ id: schema.repositories.id });
    if (!repository) {
      throw new Error("repository_insert_failed");
    }
    repositoryId = repository.id;

    const snapshot = async (
      sourceEventId: string,
      eventTime: string,
      closedAt: string,
      title: string,
    ) => {
      await upsertEvent(database, {
        tenantId,
        sourceEventId,
        eventType: "issues.closed",
        eventTime: new Date(eventTime),
        payload: {
          id: Number(sourceEventId.slice("github:issue:".length)),
          number: Number(sourceEventId.slice("github:issue:".length)),
          title,
          state: "closed",
          closedAt,
          updatedAt: eventTime,
          userLogin: "ada",
          repositoryId,
          fullName: "window-contract/window",
        },
        indexConfig: null,
      });
    };
    await snapshot(beforeId, "2026-01-01T00:00:00.000Z", "2025-12-01T00:00:00.000Z", "xylophonequartz before");
    await snapshot(insideId, "2026-01-15T00:00:00.000Z", "2026-01-14T00:00:00.000Z", "xylophonequartz inside");
    await snapshot(afterId, "2026-02-01T00:00:00.000Z", "2026-01-31T00:00:00.000Z", "xylophonequartz after");
    await snapshot(oldId, "2026-09-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z", "quokkaweek old");
    await snapshot(recentId, "2026-10-09T00:00:00.000Z", "2026-10-08T00:00:00.000Z", "quokkaweek recent");
    await snapshot(futureId, "2026-10-12T00:00:00.000Z", "2026-10-11T00:00:00.000Z", "quokkaweek future");

    const comment = async (sourceEventId: string, eventTime: string, body: string) => {
      await upsertEvent(database, {
        tenantId,
        sourceEventId,
        eventType: "issue_comment.backfill",
        eventTime: new Date(eventTime),
        payload: {
          id: Number(sourceEventId.slice("github:issue_comment:".length)),
          body,
          userLogin: "bea",
          issueNumber: 910015,
          repositoryId,
          fullName: "window-contract/window",
        },
        indexConfig: null,
      });
    };
    await comment(commentInsideId, "2026-01-16T00:00:00.000Z", "commentquartz inside the later day");
    await comment(commentAfterId, "2026-01-20T00:00:00.000Z", "commentquartz after the comment day");
  });

  afterAll(async () => {
    if (tenantId) {
      await database.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    }
    if (userId) {
      await database.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });

  it("retrieves a snapshot inside an explicit window and excludes both sides", async () => {
    embedCalls.count = 0;
    const from = new Date("2026-01-10T00:00:00.000Z");
    const to = new Date("2026-01-20T00:00:00.000Z");
    const searched = await searchEvidence(database, {
      tenantId,
      repositoryIds: [repositoryId],
      text: "xylophonequartz",
      since: from,
      until: to,
      config: null,
    });
    const snapshotDay = new Date("2026-01-15T00:00:00.000Z");
    const built = await buildContext(database, {
      tenantId,
      query: "xylophonequartz",
      from: snapshotDay,
      to: snapshotDay,
      now: new Date("2026-10-11T00:00:00.000Z"),
      config: null,
    });
    const wide = await buildContext(database, {
      tenantId,
      query: "xylophonequartz",
      from,
      to,
      now: new Date("2026-10-11T00:00:00.000Z"),
      config: null,
    });
    expect(searched.map((hit) => hit.sourceId)).toEqual([insideId]);
    expect(built.evidence.map((item) => item.sourceId)).toEqual([insideId]);
    expect(wide.evidence.map((item) => item.sourceId)).toContain(insideId);
    expect(wide.evidence.map((item) => item.sourceId)).not.toContain(beforeId);
    expect(wide.evidence.map((item) => item.sourceId)).not.toContain(afterId);
    expect(built.events.map((item) => item.sourceEventId)).not.toContain(insideId);
    expect(built.currentState.map((item) => item.sourceId)).toContain(insideId);
    const stored = await database.query.events.findFirst({
      where: and(eq(schema.events.tenantId, tenantId), eq(schema.events.sourceEventId, insideId)),
    });
    expect(stored?.recordKind).toBe("snapshot");
    expect(stored?.eventTime?.toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(stored?.payload.closedAt).toBe("2026-01-14T00:00:00.000Z");
    expect(embedCalls.count).toBe(0);
  });

  it("keeps the default seven-day start and does not add an end", async () => {
    const built = await buildContext(database, {
      tenantId,
      query: "quokkaweek",
      now: new Date("2026-10-11T00:00:00.000Z"),
      config: null,
    });
    const ids = built.evidence.map((item) => item.sourceId);
    expect(ids).toContain(recentId);
    expect(ids).toContain(futureId);
    expect(ids).not.toContain(oldId);
  });

  it("filters occurrences by their own timestamps and leaves snapshots out of package events", async () => {
    const day = new Date("2026-01-16T00:00:00.000Z");
    const built = await buildContext(database, {
      tenantId,
      query: "commentquartz",
      from: day,
      to: day,
      now: new Date("2026-10-11T00:00:00.000Z"),
      config: null,
    });
    expect(built.events.map((item) => item.sourceEventId)).toEqual([commentInsideId]);
    expect(built.evidence.map((item) => item.sourceId)).toEqual([commentInsideId]);
    expect(built.events.map((item) => item.sourceEventId)).not.toContain(insideId);
    const comment = await database.query.events.findFirst({
      where: and(
        eq(schema.events.tenantId, tenantId),
        eq(schema.events.sourceEventId, commentInsideId),
      ),
    });
    expect(comment?.recordKind).toBe("occurrence");
    expect(comment?.eventTime?.toISOString()).toBe("2026-01-16T00:00:00.000Z");
  });
});

describe.skipIf(!db || resolution.status !== "ready")("fastapi v2 retrieval audit", () => {
  const database = db!;

  it("traces the missing pull request and the extra roadmap issue without writing", async () => {
    const names = await sql!< { name: string }[]>`select current_database() as name`;
    expect(names[0]?.name).toBe("opencompanyos_eval");
    const tenant = await database.query.tenants.findFirst({
      where: eq(schema.tenants.slug, FASTAPI_V2_SLUG),
    });
    expect(tenant).toBeTruthy();
    const repository = await database.query.repositories.findFirst({
      where: eq(schema.repositories.tenantId, tenant!.id),
    });
    const sourceId = "github:pull_request:4810018525";
    const event = await database.query.events.findFirst({
      where: and(eq(schema.events.tenantId, tenant!.id), eq(schema.events.sourceEventId, sourceId)),
    });
    const document = await database.query.documents.findFirst({
      where: and(eq(schema.documents.tenantId, tenant!.id), eq(schema.documents.sourceId, sourceId)),
    });
    expect(event?.payload.title).toBe(
      "Docs: migrate sql_databases/tutorial001_an_py310.py from on_event to lifespan",
    );
    expect(event?.eventTime?.toISOString()).toBe("2026-10-10T08:57:04.000Z");
    expect(document?.title).toBe(event?.payload.title);
    const lexemes = await sql!< { lexemes: string }[]>`
      select to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))::text as lexemes
      from documents
      where tenant_id = ${tenant!.id} and source_id = ${sourceId}
    `;
    expect(lexemes[0]?.lexemes).toContain("'databases/tutorial001_an_py310.py'");
    expect(lexemes[0]?.lexemes).toContain("'lifespan'");
    const chunks = await database.query.documentChunks.findMany({
      where: eq(schema.documentChunks.documentId, document!.id),
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((chunk) => chunk.embedding === null)).toBe(true);

    const from = new Date("2026-10-10T08:57:04.000Z");
    const bySegment = await searchEvidence(database, {
      tenantId: tenant!.id,
      repositoryIds: [repository!.id],
      text: "tutorial001",
      since: from,
      until: from,
      config: null,
    });
    const found = await searchEvidence(database, {
      tenantId: tenant!.id,
      repositoryIds: [repository!.id],
      text: "lifespan",
      since: from,
      until: from,
      config: null,
    });
    expect(bySegment.map((hit) => hit.sourceId)).toContain(sourceId);
    expect(found.map((hit) => hit.sourceId)).toContain(sourceId);

    const roadmapWindow = new Date("2026-06-14T12:38:54.000Z");
    const bounded = await buildContext(database, {
      tenantId: tenant!.id,
      query: "roadmap #10370",
      from: roadmapWindow,
      to: roadmapWindow,
      now: new Date("2026-10-11T00:00:00.000Z"),
      config: null,
    });
    const unbounded = await searchEvidence(database, {
      tenantId: tenant!.id,
      repositoryIds: [repository!.id],
      text: "roadmap",
      since: roadmapWindow,
      config: null,
    });
    expect(bounded.evidence.map((item) => item.sourceId)).toContain("github:issue:1922795955");
    expect(bounded.evidence.map((item) => item.sourceId)).not.toContain("github:issue:4852026509");
    expect(unbounded.map((hit) => hit.sourceId)).toEqual(
      expect.arrayContaining(["github:issue:1922795955", "github:issue:4852026509"]),
    );
    expect(bounded.subject.status === "resolved" ? bounded.subject.entity.sourceId : null).toBe(
      "github:issue:1922795955",
    );
  });
});
