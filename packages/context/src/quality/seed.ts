import { createHash, randomUUID } from "node:crypto";
import { schema, type Database } from "@opencompanyos/db";
import { upsertEvent } from "@opencompanyos/sync";
import { eq } from "drizzle-orm";
import type { Fixtures } from "./dataset.js";

export type CreatedRun = {
  runId: string;
  tenantId: string;
  userId: string;
  repositoryIds: Record<string, string>;
};

export class EvalRunConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalRunConflict";
  }
}

export function newRunId(): string {
  return randomUUID();
}

export function installationIdForRun(runId: string): number {
  const digest = createHash("sha256").update(runId).digest();
  return 7_000_000_000 + digest.readUInt32BE(0);
}

export async function createIsolatedRun(
  db: Database,
  fixtures: Fixtures,
  runId: string = newRunId(),
): Promise<CreatedRun> {
  const created: { tenantId: string | null; userId: string | null } = {
    tenantId: null,
    userId: null,
  };

  try {
    const email = `cq-${runId}@context-quality.invalid`;
    const slug = `cq-${runId}`;
    const user = await insertRow(() =>
      db
        .insert(schema.users)
        .values({ email, name: "Context quality eval" })
        .returning({ id: schema.users.id }),
    );
    created.userId = user.id;

    const tenant = await insertRow(() =>
      db
        .insert(schema.tenants)
        .values({ name: "Context quality eval", slug })
        .returning({ id: schema.tenants.id }),
    );
    created.tenantId = tenant.id;

    await db.insert(schema.tenantMembers).values({
      tenantId: tenant.id,
      userId: user.id,
      role: "owner",
    });

    const installation = await insertRow(() =>
      db
        .insert(schema.githubInstallations)
        .values({
          tenantId: tenant.id,
          githubInstallationId: installationIdForRun(runId),
          githubAccountId: installationIdForRun(`${runId}:account`),
          githubAccountLogin: "eval-fixture",
          githubAccountType: "Organization",
          status: "active",
        })
        .returning({ id: schema.githubInstallations.id }),
    );

    const repositoryIds: Record<string, string> = {};
    for (const repository of fixtures.repositories) {
      const row = await insertRow(() =>
        db
          .insert(schema.repositories)
          .values({
            tenantId: tenant.id,
            githubInstallationId: installation.id,
            githubRepositoryId: repository.githubRepositoryId,
            ownerLogin: repository.ownerLogin,
            name: repository.name,
            fullName: repository.fullName,
            defaultBranch: repository.defaultBranch,
            selected: repository.selected,
          })
          .returning({ id: schema.repositories.id }),
      );
      repositoryIds[repository.key] = row.id;
    }

    const repositoriesByKey = new Map(
      fixtures.repositories.map((repository) => [repository.key, repository]),
    );
    for (const event of fixtures.events) {
      const repository = repositoriesByKey.get(event.repositoryKey);
      const repositoryId = repositoryIds[event.repositoryKey];
      if (!repository || !repositoryId) {
        throw new Error(`unknown_fixture_repository:${event.repositoryKey}`);
      }
      await upsertEvent(db, {
        tenantId: tenant.id,
        sourceEventId: event.sourceEventId,
        eventType: event.eventType,
        eventTime: event.eventTime ? new Date(event.eventTime) : null,
        payload: {
          ...event.payload,
          repositoryId,
          fullName: repository.fullName,
        },
        indexConfig: null,
      });
    }

    return {
      runId,
      tenantId: tenant.id,
      userId: user.id,
      repositoryIds,
    };
  } catch (error) {
    await cleanupIsolatedRun(db, created);
    if (isUniqueViolation(error)) {
      throw new EvalRunConflict(
        "An evaluation identity already exists. This run did not overwrite or delete it.",
      );
    }
    throw error;
  }
}

export async function cleanupIsolatedRun(
  db: Database,
  created: { tenantId: string | null; userId: string | null },
): Promise<void> {
  if (created.tenantId) {
    await db.delete(schema.tenants).where(eq(schema.tenants.id, created.tenantId));
  }
  if (created.userId) {
    await db.delete(schema.users).where(eq(schema.users.id, created.userId));
  }
}

async function insertRow<T extends { id: string }>(
  insert: () => Promise<T[]>,
): Promise<T> {
  const rows = await insert();
  const row = rows[0];
  if (!row) {
    throw new Error("eval_insert_failed");
  }
  return row;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "23505") {
      return true;
    }
  }
  if (typeof error === "object" && error !== null && "cause" in error) {
    return isUniqueViolation(error.cause);
  }
  return false;
}
