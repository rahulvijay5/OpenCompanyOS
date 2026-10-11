import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { schema, createSqlClient } from "@opencompanyos/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  fetchBoundedCollection,
  mapIssueComment,
  mapPullRequestReview,
  type BoundedCollection,
  type CollectionPage,
} from "../../../github/src/index.ts";
import { storeDiscussionRecords } from "../../../sync/src/discussions.ts";
import { resolveEvalDatabaseUrl } from "./database.js";
import {
  EVAL_DATABASE_NAME,
  FASTAPI_FULL_NAME,
  FASTAPI_REPOSITORY_ID,
  FASTAPI_V2_SLUG,
} from "./import-fastapi-v2.js";
import { assertManifestHash } from "./manifest.js";

const directory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../eval/context-quality/corpora/fastapi-v2",
);
const reportPath = path.join(directory, "discussion-fetch-v1.json");
const api = "https://api.github.com";

type Target = {
  kind: "issue" | "pull_request";
  number: number;
  sourceId: string;
};

type EndpointName = "issue_comments" | "pull_request_comments" | "pull_request_reviews";

type CollectionReport = {
  targetSourceId: string;
  number: number;
  endpoint: EndpointName;
  status: BoundedCollection["status"];
  pagesFetched: number;
  recordCount: number | null;
  httpStatus: number | null;
  stored: boolean;
};

export async function runBoundedDiscussionFetch(env: NodeJS.ProcessEnv = process.env): Promise<{
  database: string;
  questionsVerified: false;
  realCorpus: "not_run";
  rateLimitRemainingBeforeFetch: number | null;
  collections: CollectionReport[];
}> {
  const registerText = await readFile(path.join(directory, "discussion-preregistration-v1.json"), "utf8");
  const register = JSON.parse(registerText) as {
    verified: boolean;
    targets: Target[];
    questions: Array<{ verified: boolean }>;
  };
  if (register.verified !== false || register.questions.some((question) => question.verified !== false)) {
    throw new Error("questions_must_stay_unverified");
  }
  const targets = register.targets;
  const issues = targets.filter((target) => target.kind === "issue");
  const pullRequests = targets.filter((target) => target.kind === "pull_request");
  if (issues.length !== 10 || pullRequests.length !== 10) {
    throw new Error("target_count");
  }
  const manifestText = await readFile(path.join(directory, "manifest.json"), "utf8");
  const manifestHash = await readFile(path.join(directory, "manifest.sha256"), "utf8");
  assertManifestHash(manifestText, manifestHash);
  const manifest = JSON.parse(manifestText) as {
    issues: Array<{ sourceEventId: string }>;
    pullRequests: Array<{ sourceEventId: string }>;
  };
  const known = new Set(
    [...manifest.issues, ...manifest.pullRequests].map((record) => record.sourceEventId),
  );
  for (const target of targets) {
    if (!known.has(target.sourceId)) {
      throw new Error(`target_not_in_manifest:${target.sourceId}`);
    }
  }

  const resolution = resolveEvalDatabaseUrl(env);
  if (resolution.status !== "ready") {
    throw new Error(resolution.reason);
  }
  await assertEvalDatabase(resolution.url);

  const token = env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim() || undefined;
  const rateLimitRemaining = await coreRemaining(token);
  const collections: Array<CollectionReport & { fetched: BoundedCollection }> = [];
  let blocked = rateLimitRemaining === 0;
  for (const target of issues) {
    collections.push(await oneCollection(target, "issue_comments", token, blocked));
    if (lastBlocked(collections)) blocked = true;
  }
  for (const target of pullRequests) {
    collections.push(await oneCollection(target, "pull_request_comments", token, blocked));
    if (lastBlocked(collections)) blocked = true;
    collections.push(await oneCollection(target, "pull_request_reviews", token, blocked));
    if (lastBlocked(collections)) blocked = true;
  }

  await assertEvalDatabase(resolution.url);
  const sql = createSqlClient(resolution.url);
  const db = drizzle(sql, { schema });
  try {
    const names = await sql<{ name: string }[]>`select current_database() as name`;
    if (names[0]?.name !== EVAL_DATABASE_NAME) {
      throw new Error(`eval_database_rejected:${names[0]?.name ?? "unknown"}`);
    }
    const tenant = await db.query.tenants.findFirst({
      where: eq(schema.tenants.slug, FASTAPI_V2_SLUG),
    });
    const repository = tenant
      ? await db.query.repositories.findFirst({
          where: and(
            eq(schema.repositories.tenantId, tenant.id),
            eq(schema.repositories.githubRepositoryId, FASTAPI_REPOSITORY_ID),
          ),
        })
      : undefined;
    if (!tenant || !repository || repository.githubRepositoryId !== FASTAPI_REPOSITORY_ID) {
      throw new Error("eval_repository_missing");
    }
    if (repository.fullName !== FASTAPI_FULL_NAME) {
      throw new Error("eval_repository_name");
    }
    for (const collection of collections) {
      if (collection.status === "not_fetched") {
        continue;
      }
      await storeDiscussionRecords(db, {
        tenantId: tenant.id,
        repositoryId: repository.id,
        fullName: FASTAPI_FULL_NAME,
        records: collection.fetched.records,
        indexConfig: null,
      });
      collection.stored = true;
    }
  } finally {
    await sql.end();
  }

  const again = await readFile(path.join(directory, "discussion-preregistration-v1.json"), "utf8");
  const reread = JSON.parse(again) as { questions: Array<{ verified: boolean }> };
  if (reread.questions.some((question) => question.verified !== false)) {
    throw new Error("questions_marked_verified");
  }
  return {
    database: EVAL_DATABASE_NAME,
    questionsVerified: false,
    realCorpus: "not_run",
    rateLimitRemainingBeforeFetch: rateLimitRemaining,
    collections: collections.map(({ fetched: _fetched, ...report }) => report),
  };
}

async function assertEvalDatabase(url: string): Promise<void> {
  const sql = createSqlClient(url);
  try {
    const names = await sql<{ name: string }[]>`select current_database() as name`;
    if (names[0]?.name !== EVAL_DATABASE_NAME) {
      throw new Error(`eval_database_rejected:${names[0]?.name ?? "unknown"}`);
    }
  } finally {
    await sql.end();
  }
}

async function oneCollection(
  target: Target,
  endpoint: EndpointName,
  token: string | undefined,
  blocked: boolean,
): Promise<CollectionReport & { fetched: BoundedCollection }> {
  if (blocked) {
    return {
      targetSourceId: target.sourceId,
      number: target.number,
      endpoint,
      status: "not_fetched",
      pagesFetched: 0,
      recordCount: null,
      httpStatus: null,
      stored: false,
      fetched: {
        status: "not_fetched",
        records: [],
        pagesFetched: 0,
        httpStatus: null,
        recordCount: null,
      },
    };
  }
  const githubId = Number(target.sourceId.split(":").at(-1));
  const fetched = await fetchBoundedCollection((page) =>
    githubPage(endpointPath(endpoint, target.number), page, token),
  (item) =>
    endpoint === "pull_request_reviews"
      ? mapPullRequestReview(item, { id: githubId, number: target.number })
      : mapIssueComment(item),
  );
  return {
    targetSourceId: target.sourceId,
    number: target.number,
    endpoint,
    status: fetched.status,
    pagesFetched: fetched.pagesFetched,
    recordCount: fetched.recordCount,
    httpStatus: fetched.httpStatus,
    stored: false,
    fetched,
  };
}

function endpointPath(endpoint: EndpointName, number: number): string {
  if (endpoint === "pull_request_reviews") {
    return `/repos/fastapi/fastapi/pulls/${number}/reviews`;
  }
  return `/repos/fastapi/fastapi/issues/${number}/comments`;
}

async function coreRemaining(token: string | undefined): Promise<number | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "OpenCompanyOS-discussion-preregistration",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${api}/rate_limit`, { headers });
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as { resources?: { core?: { remaining?: number } } };
  const remaining = body.resources?.core?.remaining;
  return typeof remaining === "number" ? remaining : null;
}

async function githubPage(
  resource: string,
  page: number,
  token: string | undefined,
): Promise<CollectionPage> {
  const url = new URL(`${api}${resource}`);
  url.searchParams.set("per_page", "100");
  url.searchParams.set("page", String(page));
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "OpenCompanyOS-discussion-preregistration",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, { headers });
  const body = response.status === 200 ? await response.json() : [];
  return {
    status: response.status,
    link: response.headers.get("link"),
    data: Array.isArray(body) ? body : [],
  };
}

function lastBlocked(collections: Array<{ status: string; httpStatus: number | null }>): boolean {
  const last = collections.at(-1);
  return last?.status === "not_fetched" && (last.httpStatus === 403 || last.httpStatus === 429);
}

const isEntry = process.argv[1]?.endsWith("fetch-fastapi-discussions.ts") === true;
if (isEntry) {
  const report = await runBoundedDiscussionFetch();
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const counts = report.collections.map(
    (collection) =>
      `${collection.endpoint}:${collection.number}:${collection.status}:${collection.recordCount ?? "none"}`,
  );
  console.log(report.database);
  console.log(counts.join("\n"));
}
