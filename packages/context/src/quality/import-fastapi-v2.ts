import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { schema, createSqlClient, type Database } from "@opencompanyos/db";
import { upsertEvent } from "@opencompanyos/sync";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { assertManifestHash } from "./manifest.js";
import { resolveEvalDatabaseUrl } from "./database.js";

export const FASTAPI_V2_SLUG = "fastapi-v2-eeb18b73";
export const FASTAPI_V2_EMAIL = "fastapi-v2-eeb18b73@context-quality.invalid";
export const FASTAPI_REPOSITORY_ID = 160919119;
export const FASTAPI_FULL_NAME = "fastapi/fastapi";
export const FASTAPI_INSTALLATION_ID = 9_160_919_119;
export const EVAL_DATABASE_NAME = "opencompanyos_eval";

const corpora = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../eval/context-quality/corpora",
);

export type FrozenRecord = {
  sourceEventId: string;
  eventType: string;
  eventTime: string;
  payload: Record<string, unknown>;
};

type ManifestRecord = {
  sourceEventId: string;
  githubId: number;
  number: number;
  state: string;
  title: string;
  htmlUrl: string;
  userLogin: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt?: string | null;
  merged?: boolean;
};

export function validateFastapiV2Manifest(input: {
  v2Text: string;
  v2HashText: string;
  v1Text: string;
}): FrozenRecord[] {
  assertManifestHash(input.v2Text, input.v2HashText);
  const v2 = JSON.parse(input.v2Text) as {
    repository?: { fullName?: string; githubRepositoryId?: number };
    counts?: { issues?: number; pullRequests?: number; combined?: number };
    issues?: ManifestRecord[];
    pullRequests?: ManifestRecord[];
    comments?: { status?: string };
    reviews?: { status?: string };
  };
  const v1 = JSON.parse(input.v1Text) as { pullRequests?: ManifestRecord[] };
  const issues = v2.issues ?? [];
  const pullRequests = v2.pullRequests ?? [];
  const v1Pulls = v1.pullRequests ?? [];
  if (issues.length !== 300 || pullRequests.length !== 300) {
    throw new Error(`manifest_count_mismatch:${issues.length}:${pullRequests.length}`);
  }
  if (v2.counts?.issues !== 300 || v2.counts.pullRequests !== 300 || v2.counts.combined !== 600) {
    throw new Error("manifest_count_field_mismatch");
  }
  if (
    v2.repository?.fullName !== FASTAPI_FULL_NAME ||
    v2.repository.githubRepositoryId !== FASTAPI_REPOSITORY_ID
  ) {
    throw new Error("manifest_repository_mismatch");
  }
  const v2PullIds = pullRequests.map((record) => record.sourceEventId);
  const v1PullIds = v1Pulls.map((record) => record.sourceEventId);
  if (v2PullIds.length !== v1PullIds.length || v2PullIds.some((id, index) => id !== v1PullIds[index])) {
    throw new Error("manifest_pull_request_order_mismatch");
  }
  if (v2.comments?.status !== "not_fetched" || v2.reviews?.status !== "not_fetched") {
    throw new Error("manifest_discussion_status_unexpected");
  }
  const seen = new Set<string>();
  const records = [...issues.map((record) => toIssue(record)), ...pullRequests.map((record) => toPull(record))];
  for (const record of records) {
    if (seen.has(record.sourceEventId)) {
      throw new Error(`duplicate_source_id:${record.sourceEventId}`);
    }
    seen.add(record.sourceEventId);
  }
  return records;
}

export async function loadFastapiV2Records(): Promise<FrozenRecord[]> {
  const [v2Text, v2HashText, v1Text] = await Promise.all([
    readFile(path.join(corpora, "fastapi-v2/manifest.json"), "utf8"),
    readFile(path.join(corpora, "fastapi-v2/manifest.sha256"), "utf8"),
    readFile(path.join(corpora, "fastapi-v1/manifest.json"), "utf8"),
  ]);
  return validateFastapiV2Manifest({ v2Text, v2HashText, v1Text });
}

export async function importFastapiV2Snapshots(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ tenantId: string; repositoryId: string; eventCount: number }> {
  const records = await loadFastapiV2Records();
  const resolution = resolveEvalDatabaseUrl(env);
  if (resolution.status !== "ready") {
    throw new Error(resolution.reason);
  }
  const sql = createSqlClient(resolution.url);
  const db = drizzle(sql, { schema });
  try {
    const names = await sql<{ name: string }[]>`select current_database() as name`;
    const databaseName = names[0]?.name;
    if (databaseName !== EVAL_DATABASE_NAME) {
      throw new Error(`eval_database_rejected:${databaseName ?? "unknown"}`);
    }
    const tenantId = await reuseTenant(db);
    const repositoryId = await reuseRepository(db, tenantId);
    let imported = 0;
    for (const record of records) {
      try {
        await upsertEvent(db, {
          tenantId,
          sourceEventId: record.sourceEventId,
          eventType: record.eventType,
          eventTime: new Date(record.eventTime),
          payload: {
            ...record.payload,
            repositoryId,
            fullName: FASTAPI_FULL_NAME,
          },
          indexConfig: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "upsert_failed";
        throw new Error(
          `import_failed_after_${imported}:${record.sourceEventId}:${message}`,
        );
      }
      imported += 1;
    }
    await verifyImport(db, tenantId, repositoryId, records);
    return { tenantId, repositoryId, eventCount: records.length };
  } finally {
    await sql.end();
  }
}

async function verifyImport(
  db: Database,
  tenantId: string,
  repositoryId: string,
  records: FrozenRecord[],
): Promise<void> {
  const rows = await db.query.events.findMany({
    where: eq(schema.events.tenantId, tenantId),
  });
  const expected = new Map(records.map((record) => [record.sourceEventId, record]));
  if (rows.length !== expected.size) {
    throw new Error(`event_count_mismatch:${rows.length}`);
  }
  for (const row of rows) {
    const record = expected.get(row.sourceEventId);
    if (!record) {
      throw new Error(`unexpected_source_id:${row.sourceEventId}`);
    }
    if (row.eventType !== record.eventType) {
      throw new Error(`event_type_mismatch:${row.sourceEventId}`);
    }
    if (row.eventTime?.toISOString() !== new Date(record.eventTime).toISOString()) {
      throw new Error(`event_time_mismatch:${row.sourceEventId}`);
    }
    if (row.payload.repositoryId !== repositoryId || row.payload.fullName !== FASTAPI_FULL_NAME) {
      throw new Error(`repository_scope_mismatch:${row.sourceEventId}`);
    }
    if (row.payload.title !== record.payload.title) {
      throw new Error(`title_mismatch:${row.sourceEventId}`);
    }
    if (row.payload.closedAt !== record.payload.closedAt) {
      throw new Error(`closed_at_mismatch:${row.sourceEventId}`);
    }
    if (row.payload.mergedAt !== record.payload.mergedAt || row.payload.merged !== record.payload.merged) {
      throw new Error(`merged_metadata_mismatch:${row.sourceEventId}`);
    }
  }
  const documents = await db.query.documents.findMany({
    where: eq(schema.documents.tenantId, tenantId),
  });
  const documentIds = new Set(documents.map((document) => document.sourceId));
  for (const sourceId of expected.keys()) {
    if (!documentIds.has(sourceId)) {
      throw new Error(`missing_document:${sourceId}`);
    }
  }
}

async function reuseTenant(db: Database): Promise<string> {
  const existing = await db.query.tenants.findFirst({
    where: eq(schema.tenants.slug, FASTAPI_V2_SLUG),
  });
  const tenantId = existing
    ? existing.id
    : (
        await db
          .insert(schema.tenants)
          .values({ name: "FastAPI v2 eval", slug: FASTAPI_V2_SLUG })
          .returning({ id: schema.tenants.id })
      )[0]?.id;
  if (!tenantId) {
    throw new Error("tenant_create_failed");
  }
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, FASTAPI_V2_EMAIL),
  });
  const userId = user
    ? user.id
    : (
        await db
          .insert(schema.users)
          .values({ email: FASTAPI_V2_EMAIL, name: "FastAPI v2 eval" })
          .returning({ id: schema.users.id })
      )[0]?.id;
  if (!userId) {
    throw new Error("user_create_failed");
  }
  const member = await db.query.tenantMembers.findFirst({
    where: and(
      eq(schema.tenantMembers.tenantId, tenantId),
      eq(schema.tenantMembers.userId, userId),
    ),
  });
  if (!member) {
    await db.insert(schema.tenantMembers).values({
      tenantId,
      userId,
      role: "owner",
    });
  }
  return tenantId;
}

async function reuseRepository(db: Database, tenantId: string): Promise<string> {
  const installation = await db.query.githubInstallations.findFirst({
    where: eq(schema.githubInstallations.githubInstallationId, FASTAPI_INSTALLATION_ID),
  });
  if (installation && installation.tenantId !== tenantId) {
    throw new Error("installation_belongs_to_another_tenant");
  }
  const installationId = installation
    ? installation.id
    : (
        await db
          .insert(schema.githubInstallations)
          .values({
            tenantId,
            githubInstallationId: FASTAPI_INSTALLATION_ID,
            githubAccountId: FASTAPI_REPOSITORY_ID,
            githubAccountLogin: "fastapi",
            githubAccountType: "Organization",
            status: "active",
          })
          .returning({ id: schema.githubInstallations.id })
      )[0]?.id;
  if (!installationId) {
    throw new Error("installation_create_failed");
  }
  const repository = await db.query.repositories.findFirst({
    where: and(
      eq(schema.repositories.githubInstallationId, installationId),
      eq(schema.repositories.githubRepositoryId, FASTAPI_REPOSITORY_ID),
    ),
  });
  if (repository) {
    if (repository.tenantId !== tenantId) {
      throw new Error("repository_belongs_to_another_tenant");
    }
    return repository.id;
  }
  const created = (
    await db
      .insert(schema.repositories)
      .values({
        tenantId,
        githubInstallationId: installationId,
        githubRepositoryId: FASTAPI_REPOSITORY_ID,
        ownerLogin: "fastapi",
        name: "fastapi",
        fullName: FASTAPI_FULL_NAME,
        htmlUrl: "https://github.com/fastapi/fastapi",
        selected: true,
      })
      .returning({ id: schema.repositories.id })
  )[0]?.id;
  if (!created) {
    throw new Error("repository_create_failed");
  }
  return created;
}

function toIssue(record: ManifestRecord): FrozenRecord {
  if (!record.sourceEventId.startsWith("github:issue:")) {
    throw new Error(`unexpected_issue_source_id:${record.sourceEventId}`);
  }
  return {
    sourceEventId: record.sourceEventId,
    eventType: `issues.${record.state}`,
    eventTime: record.updatedAt,
    payload: {
      id: record.githubId,
      number: record.number,
      title: record.title,
      state: record.state,
      htmlUrl: record.htmlUrl,
      userLogin: record.userLogin,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      closedAt: record.closedAt,
    },
  };
}

function toPull(record: ManifestRecord): FrozenRecord {
  if (!record.sourceEventId.startsWith("github:pull_request:")) {
    throw new Error(`unexpected_pull_source_id:${record.sourceEventId}`);
  }
  const merged = record.merged === true;
  return {
    sourceEventId: record.sourceEventId,
    eventType: merged ? "pull_request.merged" : `pull_request.${record.state}`,
    eventTime: record.updatedAt,
    payload: {
      id: record.githubId,
      number: record.number,
      title: record.title,
      state: record.state,
      merged,
      htmlUrl: record.htmlUrl,
      userLogin: record.userLogin,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      closedAt: record.closedAt,
      mergedAt: record.mergedAt ?? null,
    },
  };
}
