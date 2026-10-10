import { randomUUID } from "node:crypto";
import { schema, createSqlClient } from "@opencompanyos/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, describe, expect, it, vi } from "vitest";
import { resolveEvalDatabaseUrl } from "./database.js";
import { loadDataset } from "./dataset.js";
import { runContextQualityEvaluation } from "./run.js";
import { EvalRunConflict, cleanupIsolatedRun, createIsolatedRun } from "./seed.js";

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

describe.skipIf(!db)("context quality against the evaluation database", () => {
  const database = db!;

  afterAll(async () => {
    await sql?.end();
  });

  it("scores assembled context packages and leaves other tenants in place", async () => {
    embedCalls.count = 0;
    const [sentinel] = await database
      .insert(schema.tenants)
      .values({
        name: "Context quality sentinel",
        slug: `cq-sentinel-${randomUUID()}`,
      })
      .returning({ id: schema.tenants.id });
    if (!sentinel) {
      throw new Error("sentinel_insert_failed");
    }

    try {
      const evaluation = await runContextQualityEvaluation(process.env);
      const failed = evaluation.report.contextPackage.cases.filter(
        (item) => item.status !== "passed",
      );
      expect(evaluation.report.database.status, JSON.stringify(failed, null, 2)).toBe("passed");
      expect(evaluation.exitCode, JSON.stringify(failed, null, 2)).toBe(0);
      expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
      expect(evaluation.report.llmCalls).toBe(0);
      expect(evaluation.report.optionalLlm.status).toBe("not_run");
      expect(evaluation.report.unsupported.passed).toBe(0);
      expect(evaluation.report.unsupported.inconclusive).toBeGreaterThan(0);
      expect(embedCalls.count).toBe(0);
      expect(evaluation.report.contextPackageVersion).toBe(1);

      const stillThere = await database.query.tenants.findFirst({
        where: eq(schema.tenants.id, sentinel.id),
      });
      expect(stillThere?.id).toBe(sentinel.id);
      if (evaluation.report.runId) {
        const leftover = await database.query.tenants.findFirst({
          where: eq(schema.tenants.slug, `cq-${evaluation.report.runId}`),
        });
        expect(leftover).toBeUndefined();
      }
    } finally {
      await database.delete(schema.tenants).where(eq(schema.tenants.id, sentinel.id));
    }
  });

  it("does not overwrite an existing evaluation tenant when the run id collides", async () => {
    const dataset = await loadDataset();
    const runId = `conflict-${randomUUID()}`;
    const first = await createIsolatedRun(database, dataset.fixtures, runId);
    try {
      await expect(createIsolatedRun(database, dataset.fixtures, runId)).rejects.toBeInstanceOf(
        EvalRunConflict,
      );
      const stillThere = await database.query.tenants.findFirst({
        where: eq(schema.tenants.id, first.tenantId),
      });
      expect(stillThere?.id).toBe(first.tenantId);
    } finally {
      await cleanupIsolatedRun(database, {
        tenantId: first.tenantId,
        userId: first.userId,
      });
    }
  });
});
