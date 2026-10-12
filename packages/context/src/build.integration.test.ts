import { randomUUID } from "node:crypto";
import { schema } from "@opencompanyos/db";
import { processWebhookDelivery } from "@opencompanyos/sync";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { answerFromPackage } from "./answer.js";
import { buildContext } from "./build.js";
import { resolveEvalDatabaseUrl } from "./quality/database.js";

function databaseUrl(): string | undefined {
  const resolution = resolveEvalDatabaseUrl(process.env);
  return resolution.status === "ready" ? resolution.url : undefined;
}

const url = databaseUrl();
const sqlClient = url ? postgres(url, { max: 1 }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

describe.skipIf(!db)("context package against postgres", () => {
  const database = db!;
  let tenantId = "";
  let userId = "";
  let selectedId = "";
  let issueId = "";
  let deliveryId = "";
  const runId = randomUUID();

  afterAll(async () => {
    if (deliveryId) {
      await database
        .delete(schema.webhookDeliveries)
        .where(eq(schema.webhookDeliveries.id, deliveryId));
    }
    if (tenantId) {
      await database.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    }
    if (userId) {
      await database.delete(schema.users).where(eq(schema.users.id, userId));
    }
    await sqlClient?.end();
  });

  it("scopes search, keeps snapshots distinct, rejects unknown installations, and reports model failure", async () => {
    const [user] = await database
      .insert(schema.users)
      .values({ email: `context-engine-${runId}@opencompanyos.dev`, name: "Context test" })
      .returning({ id: schema.users.id });
    const [tenant] = await database
      .insert(schema.tenants)
      .values({ name: "Context engine test", slug: `context-engine-${runId}` })
      .returning({ id: schema.tenants.id });
    if (!user || !tenant) {
      throw new Error("fixture_insert_failed");
    }
    userId = user.id;
    tenantId = tenant.id;

    const installationNumber =
      8_100_000_000 + Number.parseInt(runId.replace(/-/g, "").slice(0, 6), 16);
    const [installation] = await database
      .insert(schema.githubInstallations)
      .values({
        tenantId,
        githubInstallationId: installationNumber,
        githubAccountId: installationNumber + 1,
        githubAccountLogin: "context-test",
        githubAccountType: "Organization",
        status: "active",
      })
      .returning({ id: schema.githubInstallations.id });
    if (!installation) {
      throw new Error("installation_insert_failed");
    }

    const [selected] = await database
      .insert(schema.repositories)
      .values({
        tenantId,
        githubInstallationId: installation.id,
        githubRepositoryId: 880000011,
        ownerLogin: "context-test",
        name: "selected",
        fullName: "context-test/selected",
        selected: true,
      })
      .returning({ id: schema.repositories.id });
    const [hidden] = await database
      .insert(schema.repositories)
      .values({
        tenantId,
        githubInstallationId: installation.id,
        githubRepositoryId: 880000012,
        ownerLogin: "context-test",
        name: "hidden",
        fullName: "context-test/hidden",
        selected: false,
      })
      .returning({ id: schema.repositories.id });
    if (!selected || !hidden) {
      throw new Error("repository_insert_failed");
    }
    selectedId = selected.id;

    const [issue] = await database
      .insert(schema.entities)
      .values({
        tenantId,
        type: "Issue",
        canonicalName: "Selected issue",
        sourceSystem: "github",
        sourceId: "github:issue:8808",
        metadata: { number: 8 },
      })
      .returning({ id: schema.entities.id });
    if (!issue) {
      throw new Error("entity_insert_failed");
    }
    issueId = issue.id;
    const now = new Date();

    await database.insert(schema.events).values([
      {
        tenantId,
        sourceSystem: "github",
        sourceEventId: "github:issue:8808",
        eventType: "issues.open",
        objectEntityId: issueId,
        eventTime: now,
        observedAt: now,
        recordKind: "snapshot",
        payload: {
          repositoryId: selectedId,
          title: "Selected issue",
          state: "open",
          htmlUrl: "https://github.com/context-test/selected/issues/8",
          createdAt: "2020-01-01T00:00:00Z",
          closedAt: "2020-02-01T00:00:00Z",
        },
      },
      {
        tenantId,
        sourceSystem: "github",
        sourceEventId: "github:issue:8808:closed:2026-10-09T00:00:00Z",
        eventType: "issues.closed",
        objectEntityId: issueId,
        eventTime: now,
        observedAt: now,
        recordKind: "occurrence",
        payload: {
          repositoryId: selectedId,
          title: "Selected issue closed",
          htmlUrl: "https://github.com/context-test/selected/issues/8",
        },
      },
      {
        tenantId,
        sourceSystem: "github",
        sourceEventId: "github:issue:hidden",
        eventType: "issues.open",
        eventTime: now,
        observedAt: now,
        recordKind: "snapshot",
        payload: {
          repositoryId: hidden.id,
          title: "Hidden issue",
          state: "open",
        },
      },
    ]);

    await database.insert(schema.documents).values([
      {
        tenantId,
        entityId: issueId,
        sourceSystem: "github",
        sourceId: "github:issue:8808:closed:2026-10-09T00:00:00Z",
        title: "Selected alpha document",
        body: "selected-alpha-token is in the selected repository",
        url: "https://github.com/context-test/selected/issues/8",
      },
      {
        tenantId,
        sourceSystem: "github",
        sourceId: "github:issue:hidden",
        title: "Hidden beta document",
        body: "unselected-beta-token is outside scope",
        url: "https://github.com/context-test/hidden/issues/1",
      },
    ]);

    const built = await buildContext(database, {
      tenantId,
      query: "selected-alpha-token",
      config: null,
      now,
    });

    expect(built.scope.repositoryIds).toEqual([selectedId]);
    expect(built.scope.authorization).toBe("local-owner");
    expect(built.evidence.some((item) => item.title === "Selected alpha document")).toBe(
      true,
    );
    expect(built.evidence.some((item) => item.title === "Hidden beta document")).toBe(
      false,
    );
    expect(built.currentState.some((item) => item.recordKind === "snapshot")).toBe(true);
    expect(built.events.every((item) => item.recordKind === "occurrence")).toBe(true);
    expect(built.events.map((item) => item.sourceEventId)).toContain(
      "github:issue:8808:closed:2026-10-09T00:00:00Z",
    );
    expect(
      built.events.some((item) => item.sourceEventId === "github:issue:8808"),
    ).toBe(false);
    expect(built.uncertainties.map((item) => item.code)).toContain(
      "no_reconstructed_history",
    );

    const outside = await buildContext(database, {
      tenantId,
      query: "selected-alpha-token",
      repositoryIds: ["00000000-0000-0000-0000-000000000099"],
      config: null,
      now,
    });
    expect(outside.scope.repositoryIds).toEqual([]);
    expect(outside.uncertainties.map((item) => item.code)).toContain(
      "repository_not_in_scope",
    );

    const [delivery] = await database
      .insert(schema.webhookDeliveries)
      .values({
        tenantId: null,
        githubDeliveryId: `context-engine-${runId}`,
        eventName: "issues",
        status: "received",
        receivedAt: now,
        payload: {
          action: "opened",
          installation: { id: 909090909 },
          issue: {
            id: 88081,
            number: 1,
            title: "Should not land",
            state: "open",
            updated_at: now.toISOString(),
          },
          repository: { id: 880000011, full_name: "context-test/selected" },
        },
      })
      .returning({ id: schema.webhookDeliveries.id });
    if (!delivery) {
      throw new Error("delivery_insert_failed");
    }
    deliveryId = delivery.id;

    await expect(processWebhookDelivery(database, delivery.id)).rejects.toThrow(
      "unknown_installation",
    );
    const landed = await database.query.events.findMany({
      where: eq(schema.events.sourceEventId, "github:issue:88081"),
    });
    expect(landed).toEqual([]);

    const answered = await answerFromPackage(database, {
      tenantId,
      userId,
      query: "selected-alpha-token",
      package: built,
      config: {
        baseUrl: "http://127.0.0.1:9",
        apiKey: "test",
        chatModel: "test",
        embeddingModel: "test",
        embeddingDimensions: 768,
      },
      complete: async () => {
        throw new Error("model_down");
      },
    });
    expect(answered.answer).toContain("Selected alpha document");
    expect(answered.uncertainties.map((item) => item.code)).toContain(
      "model_unavailable",
    );
    expect(answered.evidence[0]?.url).toBe(
      "https://github.com/context-test/selected/issues/8",
    );
  });
});
