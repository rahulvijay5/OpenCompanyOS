import { schema, createSqlClient } from "@opencompanyos/db";
import { searchEvidence } from "@opencompanyos/retrieval";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { describe, expect, it, vi } from "vitest";
import { buildContext } from "../build.js";
import { resolveEvalDatabaseUrl } from "./database.js";
import {
  EVAL_DATABASE_NAME,
  FASTAPI_FULL_NAME,
  FASTAPI_V2_SLUG,
  importFastapiV2Snapshots,
} from "./import-fastapi-v2.js";

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

describe.skipIf(resolution.status !== "ready")("fastapi v2 snapshot import", () => {
  it("imports the frozen records once and reuses the same tenant on retry", async () => {
    embedCalls.count = 0;
    const first = await importFastapiV2Snapshots(process.env);
    const second = await importFastapiV2Snapshots(process.env);
    expect(second.tenantId).toBe(first.tenantId);
    expect(second.repositoryId).toBe(first.repositoryId);
    expect(second.eventCount).toBe(600);

    const sql = createSqlClient(resolution.status === "ready" ? resolution.url : "");
    const db = drizzle(sql, { schema });
    try {
      const names = await sql<{ name: string }[]>`select current_database() as name`;
      expect(names[0]?.name).toBe(EVAL_DATABASE_NAME);
      const tenants = await db.query.tenants.findMany({
        where: eq(schema.tenants.slug, FASTAPI_V2_SLUG),
      });
      expect(tenants).toHaveLength(1);
      const repositories = await db.query.repositories.findMany({
        where: eq(schema.repositories.tenantId, first.tenantId),
      });
      expect(repositories).toHaveLength(1);
      expect(repositories[0]?.selected).toBe(true);
      expect(repositories[0]?.fullName).toBe(FASTAPI_FULL_NAME);
      const events = await db.query.events.findMany({
        where: eq(schema.events.tenantId, first.tenantId),
      });
      expect(new Set(events.map((event) => event.sourceEventId)).size).toBe(600);

      const from = new Date("2023-02-01T00:00:00.000Z");
      const to = new Date("2026-10-11T00:00:00.000Z");
      const searched = await searchEvidence(db, {
        tenantId: first.tenantId,
        repositoryIds: [first.repositoryId],
        text: "mangum",
        since: from,
        config: null,
      });
      expect(searched.some((hit) => hit.sourceId === "github:issue:5671616833")).toBe(true);
      expect(searched.every((hit) => hit.repositoryId === first.repositoryId)).toBe(true);

      const built = await buildContext(db, {
        tenantId: first.tenantId,
        query: "mangum",
        config: null,
        from,
        to,
        now: new Date("2026-10-11T00:00:00.000Z"),
      });
      expect(built.scope.repositoryIds).toEqual([first.repositoryId]);
      expect(built.evidence.some((item) => item.sourceId === "github:issue:5671616833")).toBe(true);
      expect(embedCalls.count).toBe(0);
    } finally {
      await sql.end();
    }
  }, 180_000);
});
