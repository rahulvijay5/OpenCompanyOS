import { randomUUID } from "node:crypto";
import { schema, createSqlClient } from "@opencompanyos/db";
import {
  enqueueRepositorySync,
  getSyncJob,
  resolveCommentPayload,
  runRepositorySyncJob,
  storeDiscussionRecords,
  upsertEvent,
} from "@opencompanyos/sync";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, describe, expect, it, vi } from "vitest";
import { resolveEvalDatabaseUrl } from "./quality/database.js";

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

describe.skipIf(!db)("discussion backfill on the evaluation database", () => {
  const database = db!;
  const runId = randomUUID();
  const installationNumber =
    8_200_000_000 + Number.parseInt(runId.replace(/-/g, "").slice(0, 6), 16);
  let tenantId = "";
  let userId = "";
  let installationId = "";
  let selectedId = "";
  let hiddenId = "";

  afterAll(async () => {
    if (tenantId) {
      await database.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    }
    if (userId) {
      await database.delete(schema.users).where(eq(schema.users.id, userId));
    }
    await sql?.end();
  });

  it("backfills comments and reviews for a selected repository and can rerun after a rate limit", async () => {
    embedCalls.count = 0;
    const [user] = await database
      .insert(schema.users)
      .values({ email: `discussions-${runId}@opencompanyos.dev`, name: "Discussions" })
      .returning({ id: schema.users.id });
    const [tenant] = await database
      .insert(schema.tenants)
      .values({ name: "Discussions", slug: `discussions-${runId}` })
      .returning({ id: schema.tenants.id });
    if (!user || !tenant) {
      throw new Error("fixture_insert_failed");
    }
    userId = user.id;
    tenantId = tenant.id;

    const [installation] = await database
      .insert(schema.githubInstallations)
      .values({
        tenantId,
        githubInstallationId: installationNumber,
        githubAccountId: installationNumber + 1,
        githubAccountLogin: "discussions",
        githubAccountType: "Organization",
        status: "active",
      })
      .returning({ id: schema.githubInstallations.id });
    const [selected] = await database
      .insert(schema.repositories)
      .values({
        tenantId,
        githubInstallationId: installation!.id,
        githubRepositoryId: installationNumber + 10,
        ownerLogin: "acme",
        name: "selected",
        fullName: "acme/selected",
        selected: true,
      })
      .returning({ id: schema.repositories.id });
    const [hidden] = await database
      .insert(schema.repositories)
      .values({
        tenantId,
        githubInstallationId: installation!.id,
        githubRepositoryId: installationNumber + 11,
        ownerLogin: "acme",
        name: "hidden",
        fullName: "acme/hidden",
        selected: false,
      })
      .returning({ id: schema.repositories.id });
    if (!installation || !selected || !hidden) {
      throw new Error("repository_insert_failed");
    }
    installationId = installation.id;
    selectedId = selected.id;
    hiddenId = hidden.id;

    await expect(
      enqueueRepositorySync(database, {
        tenantId,
        installationId,
        repositoryId: hiddenId,
      }),
    ).rejects.toThrow("repository_not_found_or_not_selected");

    const hiddenEvents = await database.query.events.findMany({
      where: eq(schema.events.tenantId, tenantId),
    });
    expect(hiddenEvents).toHaveLength(0);

    const job = await enqueueRepositorySync(database, {
      tenantId,
      installationId,
      repositoryId: selectedId,
    });
    const credentials = {
      appId: "1",
      privateKey: "unused",
      clientId: "unused",
      clientSecret: "unused",
    };
    const fetches = {
      fetchIssues: async () => [
        {
          sourceEventId: "github:issue:120",
          eventType: "issues.open",
          eventTime: new Date("2026-03-01T00:00:00.000Z"),
          payload: { id: 120, number: 12, title: "Billing", state: "open", userLogin: "ada" },
        },
      ],
      fetchPullRequests: async () => [
        {
          sourceEventId: "github:pull_request:77",
          eventType: "pull_request.open",
          eventTime: new Date("2026-03-01T00:00:00.000Z"),
          payload: { id: 77, number: 4, title: "Export", state: "open", userLogin: "ada" },
        },
      ],
      fetchCommits: async () => [],
    };
    const failing = {
      async listIssueCommentPage() {
        const error = new Error("slow") as Error & {
          status: number;
          response: { headers: Record<string, string> };
        };
        error.status = 429;
        error.response = { headers: { "retry-after": "120" } };
        throw error;
      },
      async listReviewPage() {
        return { data: [] };
      },
    };

    await expect(
      runRepositorySyncJob(database, credentials, job.id, {
        indexConfig: null,
        discussionClient: failing,
        ...fetches,
      }),
    ).rejects.toMatchObject({ name: "rate_limit_exceeded" });
    const failed = await getSyncJob(database, tenantId, job.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toContain("rate_limit_exceeded");

    const comments = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: index === 0 ? "on the issue" : `c${index}`,
      user: { login: "bea" },
      issue_url:
        index === 0
          ? "https://api.github.com/repos/acme/selected/issues/12"
          : "https://api.github.com/repos/acme/selected/issues/404",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-03-02T00:00:00.000Z",
    }));
    const succeeding = {
      async listIssueCommentPage(input: { page: number }) {
        if (input.page === 1) {
          return { data: comments };
        }
        return {
          data: [
            {
              id: 101,
              body: "on the pull request",
              user: { login: "bea" },
              issue_url: "https://api.github.com/repos/acme/selected/issues/4",
              updated_at: "2026-03-03T00:00:00.000Z",
            },
            { body: "malformed" },
          ],
        };
      },
      async listReviewPage(input: { pullNumber: number }) {
        expect(input.pullNumber).toBe(4);
        return {
          data: [
            {
              id: 50,
              state: "APPROVED",
              body: "ship it",
              user: { login: "cy" },
              submitted_at: "2026-03-04T00:00:00.000Z",
            },
          ],
        };
      },
    };

    const completed = await runRepositorySyncJob(database, credentials, job.id, {
      indexConfig: null,
      discussionClient: succeeding,
      ...fetches,
    });
    expect(completed.status).toBe("completed");

    const issueComment = await database.query.events.findFirst({
      where: and(
        eq(schema.events.tenantId, tenantId),
        eq(schema.events.sourceEventId, "github:issue_comment:1"),
      ),
    });
    expect(issueComment?.eventType).toBe("issue_comment.backfill");
    expect(issueComment?.eventTime?.toISOString()).toBe("2026-03-02T00:00:00.000Z");
    expect(issueComment?.observedAt.getTime()).toBeGreaterThan(
      new Date("2026-03-02T00:00:00.000Z").getTime(),
    );
    expect(issueComment?.payload.issueId).toBe(120);
    expect(issueComment?.payload.pullRequestId).toBeUndefined();
    expect(await discusses(tenantId, "github:issue_comment:1")).toEqual(["github:issue:120"]);

    const pullComment = await database.query.events.findFirst({
      where: and(
        eq(schema.events.tenantId, tenantId),
        eq(schema.events.sourceEventId, "github:issue_comment:101"),
      ),
    });
    expect(pullComment?.payload.pullRequestId).toBe(77);
    expect(pullComment?.payload.issueId).toBeUndefined();
    expect(await discusses(tenantId, "github:issue_comment:101")).toEqual([
      "github:pull_request:77",
    ]);

    const unknown = await database.query.events.findFirst({
      where: and(
        eq(schema.events.tenantId, tenantId),
        eq(schema.events.sourceEventId, "github:issue_comment:2"),
      ),
    });
    expect(unknown?.payload.association).toBe("unresolved");
    expect(unknown?.payload.issueNumber).toBe(404);
    expect(await discusses(tenantId, "github:issue_comment:2")).toEqual([]);

    const review = await database.query.events.findFirst({
      where: and(
        eq(schema.events.tenantId, tenantId),
        eq(schema.events.sourceEventId, "github:pull_request_review:50"),
      ),
    });
    expect(review?.payload.state).toBe("APPROVED");
    expect(review?.payload.body).toBe("ship it");
    expect(review?.eventTime?.toISOString()).toBe("2026-03-04T00:00:00.000Z");
    const reviewEntity = await database.query.entities.findFirst({
      where: and(eq(schema.entities.tenantId, tenantId), eq(schema.entities.type, "Review")),
    });
    expect(reviewEntity).toBeUndefined();

    const again = await runRepositorySyncJob(database, credentials, job.id, {
      indexConfig: null,
      discussionClient: succeeding,
      ...fetches,
    });
    expect(again.status).toBe("completed");
    const commentRows = await database.query.events.findMany({
      where: and(
        eq(schema.events.tenantId, tenantId),
        eq(schema.events.sourceEventId, "github:issue_comment:1"),
      ),
    });
    expect(commentRows).toHaveLength(1);

    await upsertEvent(database, {
      tenantId,
      sourceEventId: "github:issue_comment:1",
      eventType: "issue_comment.edited",
      eventTime: new Date("2026-03-05T00:00:00.000Z"),
      payload: {
        id: 1,
        body: "webhook edit",
        issueId: 120,
        issueNumber: 12,
        repositoryId: selectedId,
        fullName: "acme/selected",
      },
      indexConfig: null,
    });
    await storeDiscussionRecords(database, {
      tenantId,
      repositoryId: selectedId,
      fullName: "acme/selected",
      indexConfig: null,
      records: [
        {
          sourceEventId: "github:issue_comment:1",
          eventType: "issue_comment.backfill",
          eventTime: new Date("2026-03-02T00:00:00.000Z"),
          payload: { id: 1, body: "stale", issueNumber: 12, association: "unresolved" },
        },
      ],
    });
    const kept = await database.query.events.findFirst({
      where: and(
        eq(schema.events.tenantId, tenantId),
        eq(schema.events.sourceEventId, "github:issue_comment:1"),
      ),
    });
    expect(kept?.eventType).toBe("issue_comment.edited");
    expect(kept?.payload.body).toBe("webhook edit");
    expect(kept?.payload.issueId).toBe(120);

    await upsertEvent(database, {
      tenantId,
      sourceEventId: "github:pull_request_review:90",
      eventType: "pull_request_review.backfill",
      eventTime: new Date("2026-03-01T00:00:00.000Z"),
      payload: {
        id: 90,
        body: "early",
        state: "COMMENTED",
        pullRequestId: 77,
        pullRequestNumber: 4,
        repositoryId: selectedId,
        fullName: "acme/selected",
      },
      indexConfig: null,
    });
    await upsertEvent(database, {
      tenantId,
      sourceEventId: "github:pull_request_review:90",
      eventType: "pull_request_review.submitted",
      eventTime: new Date("2026-03-06T00:00:00.000Z"),
      payload: {
        id: 90,
        body: "decision",
        state: "CHANGES_REQUESTED",
        pullRequestId: 77,
        pullRequestNumber: 4,
        repositoryId: selectedId,
        fullName: "acme/selected",
      },
      indexConfig: null,
    });
    const decision = await database.query.events.findFirst({
      where: and(
        eq(schema.events.tenantId, tenantId),
        eq(schema.events.sourceEventId, "github:pull_request_review:90"),
      ),
    });
    expect(decision?.eventType).toBe("pull_request_review.submitted");
    expect(decision?.payload.body).toBe("decision");
    expect(decision?.payload.state).toBe("CHANGES_REQUESTED");

    const resolved = await resolveCommentPayload(database, tenantId, selectedId, {
      issueNumber: 12,
      issueUrl: "https://api.github.com/repos/acme/selected/issues/12",
    });
    expect(resolved.issueId).toBe(120);
    expect(embedCalls.count).toBe(0);
    const storedComments = (
      await database.query.events.findMany({
        where: eq(schema.events.tenantId, tenantId),
      })
    ).filter((event) => event.sourceEventId.startsWith("github:issue_comment:"));
    expect(storedComments).toHaveLength(101);
  });
});

async function discusses(tenantId: string, commentSourceId: string): Promise<string[]> {
  const database = db!;
  const comment = await database.query.entities.findFirst({
    where: and(
      eq(schema.entities.tenantId, tenantId),
      eq(schema.entities.sourceId, commentSourceId),
    ),
  });
  if (!comment) {
    return [];
  }
  const edges = await database.query.relationships.findMany({
    where: and(
      eq(schema.relationships.tenantId, tenantId),
      eq(schema.relationships.sourceEntityId, comment.id),
      eq(schema.relationships.relationshipType, "DISCUSSES"),
    ),
  });
  const targets: string[] = [];
  for (const edge of edges) {
    const target = await database.query.entities.findFirst({
      where: eq(schema.entities.id, edge.targetEntityId),
    });
    if (target?.sourceId) {
      targets.push(target.sourceId);
    }
  }
  return targets;
}
