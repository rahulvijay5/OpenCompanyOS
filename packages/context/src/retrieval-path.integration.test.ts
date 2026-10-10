import { randomUUID } from "node:crypto";
import { schema, createSqlClient } from "@opencompanyos/db";
import { searchEvidence } from "@opencompanyos/retrieval";
import { upsertEvent } from "@opencompanyos/sync";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, describe, expect, it, vi } from "vitest";
import { answerFromPackage } from "./answer.js";
import { buildContext } from "./build.js";
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

const issueCommentId = "github:issue_comment:501";
const pullCommentId = "github:issue_comment:502";
const reviewId = "github:pull_request_review:503";
const hiddenCommentId = "github:issue_comment:504";
const march = new Date("2026-03-04T12:00:00.000Z");
const submittedAt = new Date("2026-03-05T08:00:00.000Z");

describe.skipIf(!db || resolution.status !== "ready")(
  "backfill retrieval path on the evaluation database",
  () => {
    const database = db!;
    const databaseUrl = resolution.status === "ready" ? resolution.url : "";
    const runId = randomUUID();
    const installationNumber =
      8_300_000_000 + Number.parseInt(runId.replace(/-/g, "").slice(0, 6), 16);
    let tenantId = "";
    let userId = "";
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

    it("retrieves indexed discussions inside a covering window and isolates scope", async () => {
      const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
      expect(databaseName).toBe("opencompanyos_eval");
      expect(resolution.status === "ready" ? resolution.source : null).toBe("EVAL_DATABASE_URL");
      embedCalls.count = 0;

      const [user] = await database
        .insert(schema.users)
        .values({ email: `retrieval-${runId}@opencompanyos.dev`, name: "Retrieval" })
        .returning({ id: schema.users.id });
      const [tenant] = await database
        .insert(schema.tenants)
        .values({ name: "Retrieval path", slug: `retrieval-${runId}` })
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
          githubAccountLogin: "retrieval",
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
      selectedId = selected.id;
      hiddenId = hidden.id;

      await upsertEvent(database, {
        tenantId,
        sourceEventId: "github:issue:120",
        eventType: "issues.open",
        eventTime: march,
        payload: {
          id: 120,
          number: 12,
          title: "Billing export",
          state: "open",
          userLogin: "ada",
          repositoryId: selectedId,
          fullName: "acme/selected",
        },
        indexConfig: null,
      });
      await upsertEvent(database, {
        tenantId,
        sourceEventId: "github:pull_request:77",
        eventType: "pull_request.open",
        eventTime: march,
        payload: {
          id: 77,
          number: 4,
          title: "Export pull request",
          state: "open",
          userLogin: "ada",
          repositoryId: selectedId,
          fullName: "acme/selected",
        },
        indexConfig: null,
      });
      await upsertEvent(database, {
        tenantId,
        sourceEventId: issueCommentId,
        eventType: "issue_comment.backfill",
        eventTime: march,
        payload: {
          id: 501,
          body: "brindleissuecomment explains the export",
          userLogin: "bea",
          issueId: 120,
          issueNumber: 12,
          repositoryId: selectedId,
          fullName: "acme/selected",
        },
        indexConfig: null,
      });
      await upsertEvent(database, {
        tenantId,
        sourceEventId: pullCommentId,
        eventType: "issue_comment.backfill",
        eventTime: march,
        payload: {
          id: 502,
          body: "brindlepullcomment on the conversation",
          userLogin: "bea",
          pullRequestId: 77,
          issueNumber: 4,
          repositoryId: selectedId,
          fullName: "acme/selected",
        },
        indexConfig: null,
      });
      await upsertEvent(database, {
        tenantId,
        sourceEventId: reviewId,
        eventType: "pull_request_review.backfill",
        eventTime: submittedAt,
        payload: {
          id: 503,
          body: "brindlereviewnote ship the export",
          state: "APPROVED",
          userLogin: "quorra",
          pullRequestId: 77,
          pullRequestNumber: 4,
          submittedAt: submittedAt.toISOString(),
          repositoryId: selectedId,
          fullName: "acme/selected",
        },
        indexConfig: null,
      });
      await upsertEvent(database, {
        tenantId,
        sourceEventId: hiddenCommentId,
        eventType: "issue_comment.backfill",
        eventTime: march,
        payload: {
          id: 504,
          body: "brindlehiddentoken must stay out",
          userLogin: "bea",
          issueNumber: 9,
          association: "unresolved",
          repositoryId: hiddenId,
          fullName: "acme/hidden",
        },
        indexConfig: null,
      });

      const searched = await searchEvidence(database, {
        tenantId,
        repositoryIds: [selectedId],
        text: "brindleissuecomment brindlepullcomment brindlereviewnote",
        since: new Date("2026-03-01T00:00:00.000Z"),
        config: null,
      });
      expect(searched.map((hit) => hit.sourceId).sort()).toEqual(
        [issueCommentId, pullCommentId, reviewId].sort(),
      );
      expect(searched.every((hit) => hit.repositoryId === selectedId)).toBe(true);
      expect(searched.some((hit) => hit.sourceId === hiddenCommentId)).toBe(false);

      const covered = await buildContext(database, {
        tenantId,
        query: "brindleissuecomment brindlepullcomment brindlereviewnote",
        config: null,
        from: new Date("2026-03-01T00:00:00.000Z"),
        to: new Date("2026-03-31T00:00:00.000Z"),
        now: new Date("2026-10-10T00:00:00.000Z"),
      });
      expect(covered.scope.repositoryIds).toEqual([selectedId]);
      const evidenceIds = covered.evidence.map((item) => item.sourceId);
      expect(evidenceIds).toEqual(expect.arrayContaining([issueCommentId, pullCommentId, reviewId]));
      expect(evidenceIds).not.toContain(hiddenCommentId);
      expect(covered.evidence.every((item) => item.repositoryId === selectedId)).toBe(true);
      expect(covered.events.map((event) => event.sourceEventId)).not.toContain(hiddenCommentId);

      const issueHit = covered.evidence.find((item) => item.sourceId === issueCommentId);
      const pullHit = covered.evidence.find((item) => item.sourceId === pullCommentId);
      const reviewHit = covered.evidence.find((item) => item.sourceId === reviewId);
      expect(issueHit?.snippet).toContain("brindleissuecomment");
      expect(pullHit?.snippet).toContain("brindlepullcomment");
      expect(reviewHit?.snippet).toContain("APPROVED");
      expect(reviewHit?.snippet).toContain("quorra");
      expect(reviewHit?.snippet).toContain("brindlereviewnote");
      const reviewEvent = covered.events.find((event) => event.sourceEventId === reviewId);
      expect(reviewEvent?.eventTime).toBe(submittedAt.toISOString());
      const reviewEntity = await database.query.entities.findFirst({
        where: and(eq(schema.entities.tenantId, tenantId), eq(schema.entities.type, "Review")),
      });
      expect(reviewEntity).toBeUndefined();
      expect(covered.uncertainties.some((item) => item.code === "no_reconstructed_history")).toBe(
        true,
      );
      expect(
        covered.uncertainties.some((item) => item.code === "inline_review_comments_unavailable"),
      ).toBe(true);
      expect(covered.uncertainties.some((item) => item.code === "reviews_only_from_webhooks")).toBe(
        false,
      );

      const knownId = reviewHit?.id;
      if (!knownId) {
        throw new Error("review evidence missing");
      }
      const answered = await answerFromPackage(database, {
        tenantId,
        userId,
        query: "brindlereviewnote",
        package: covered,
        config: {
          baseUrl: "http://127.0.0.1:9",
          apiKey: "unused",
          chatModel: "unused",
          embeddingModel: "unused",
          embeddingDimensions: 768,
        },
        complete: async () => ({
          answer: "The stored review is cited.",
          confidence: 0.4,
          evidenceIds: [knownId, "not-a-real-evidence-id"],
          inputTokens: null,
          outputTokens: null,
        }),
      });
      expect(answered.evidence.map((item) => item.id)).toEqual([knownId]);
      expect(embedCalls.count).toBe(0);
    });

    it("keeps one row when the same discussion is ingested again", async () => {
      await upsertEvent(database, {
        tenantId,
        sourceEventId: issueCommentId,
        eventType: "issue_comment.backfill",
        eventTime: march,
        payload: {
          id: 501,
          body: "brindleissuecomment explains the export",
          userLogin: "bea",
          issueId: 120,
          issueNumber: 12,
          repositoryId: selectedId,
          fullName: "acme/selected",
        },
        indexConfig: null,
      });
      const events = await database.query.events.findMany({
        where: and(
          eq(schema.events.tenantId, tenantId),
          eq(schema.events.sourceEventId, issueCommentId),
        ),
      });
      const documents = await database.query.documents.findMany({
        where: and(
          eq(schema.documents.tenantId, tenantId),
          eq(schema.documents.sourceId, issueCommentId),
        ),
      });
      expect(events).toHaveLength(1);
      expect(documents).toHaveLength(1);
      expect(events[0]?.payload.issueId).toBe(120);
      expect(events[0]?.payload.body).toBe("brindleissuecomment explains the export");
    });

    it("returns an occurrence whose source timestamp is inside the requested window", async () => {
      const built = await buildContext(database, {
        tenantId,
        query: "brindleissuecomment",
        config: null,
        from: new Date("2026-03-01T00:00:00.000Z"),
        to: new Date("2026-03-31T00:00:00.000Z"),
        now: new Date("2026-10-10T00:00:00.000Z"),
      });
      expect(built.evidence.some((item) => item.sourceId === issueCommentId)).toBe(true);
      expect(built.events.some((event) => event.sourceEventId === issueCommentId)).toBe(true);
    });

    it("excludes an occurrence that falls outside the requested window", async () => {
      const built = await buildContext(database, {
        tenantId,
        query: "brindleissuecomment",
        config: null,
        from: new Date("2026-04-01T00:00:00.000Z"),
        to: new Date("2026-04-30T00:00:00.000Z"),
        now: new Date("2026-10-10T00:00:00.000Z"),
      });
      expect(built.evidence.some((item) => item.sourceId === issueCommentId)).toBe(false);
      expect(built.events.some((event) => event.sourceEventId === issueCommentId)).toBe(false);
    });

    it("omits older backfilled discussions from the default seven-day window", async () => {
      const built = await buildContext(database, {
        tenantId,
        query: "brindleissuecomment brindlepullcomment brindlereviewnote",
        config: null,
        now: new Date("2026-10-10T00:00:00.000Z"),
      });
      const sourceIds = [
        ...built.evidence.map((item) => item.sourceId),
        ...built.events.map((event) => event.sourceEventId),
      ];
      expect(sourceIds).not.toContain(issueCommentId);
      expect(sourceIds).not.toContain(pullCommentId);
      expect(sourceIds).not.toContain(reviewId);
    });
  },
);
