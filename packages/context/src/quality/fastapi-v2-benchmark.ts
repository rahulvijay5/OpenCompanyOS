import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { schema, createSqlClient, type Database } from "@opencompanyos/db";
import { searchEvidence } from "@opencompanyos/retrieval";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { buildContext } from "../build.js";
import { resolveEvalDatabaseUrl } from "./database.js";
import {
  EVAL_DATABASE_NAME,
  FASTAPI_FULL_NAME,
  FASTAPI_V2_SLUG,
} from "./import-fastapi-v2.js";
import { assertManifestHash } from "./manifest.js";

const v2Directory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../eval/context-quality/corpora/fastapi-v2",
);

export type BenchmarkFact = {
  summary: string;
  number: number;
  title: string;
  state: string;
  updatedAt: string;
  closedAt: string | null;
  eventTime: string;
  merged: boolean | null;
  mergedAt: string | null;
};

export type BenchmarkQuestion = {
  id: string;
  category: string;
  question: string;
  query: string;
  expectedSourceIds: string[];
  expectedSubjectSourceId: string | null;
  fact: BenchmarkFact;
  window: { from: string; to: string };
  verification: { status: string; method: string };
};

type ManifestRecord = {
  sourceEventId: string;
  number: number;
  title: string;
  state: string;
  updatedAt: string;
  closedAt: string | null;
  merged?: boolean;
  mergedAt?: string | null;
};

export function manifestMismatches(
  question: BenchmarkQuestion,
  record: ManifestRecord | undefined,
): string[] {
  if (!record) {
    return ["missing_from_manifest"];
  }
  const fact = question.fact;
  const mismatches: string[] = [];
  if (record.sourceEventId !== question.expectedSourceIds[0]) {
    mismatches.push("source_id");
  }
  if (record.number !== fact.number) mismatches.push("number");
  if (record.title !== fact.title) mismatches.push("title");
  if (record.state !== fact.state) mismatches.push("state");
  if (record.updatedAt !== fact.updatedAt) mismatches.push("updatedAt");
  if (record.closedAt !== fact.closedAt) mismatches.push("closedAt");
  if (fact.eventTime !== fact.updatedAt) mismatches.push("event_time_not_updated_at");
  const merged = record.merged ?? null;
  const mergedAt = record.mergedAt ?? null;
  if (merged !== fact.merged) mismatches.push("merged");
  if (mergedAt !== fact.mergedAt) mismatches.push("mergedAt");
  if (question.window.from !== fact.updatedAt || question.window.to !== fact.updatedAt) {
    mismatches.push("window");
  }
  return mismatches;
}

export async function loadFastapiV2Benchmark(): Promise<{
  questions: BenchmarkQuestion[];
  manifestText: string;
  manifestRecords: Map<string, ManifestRecord>;
  digest: string;
}> {
  const [manifestText, hashText, benchmarkText] = await Promise.all([
    readFile(path.join(v2Directory, "manifest.json"), "utf8"),
    readFile(path.join(v2Directory, "manifest.sha256"), "utf8"),
    readFile(path.join(v2Directory, "benchmark-v1.json"), "utf8"),
  ]);
  assertManifestHash(manifestText, hashText);
  const digest = hashText.trim();
  const manifest = JSON.parse(manifestText) as {
    issues: ManifestRecord[];
    pullRequests: ManifestRecord[];
    comments: { status: string };
    reviews: { status: string };
  };
  if (manifest.comments.status !== "not_fetched" || manifest.reviews.status !== "not_fetched") {
    throw new Error("discussion_status_unexpected");
  }
  const benchmark = JSON.parse(benchmarkText) as { questions: BenchmarkQuestion[] };
  const manifestRecords = new Map<string, ManifestRecord>();
  for (const record of [...manifest.issues, ...manifest.pullRequests]) {
    manifestRecords.set(record.sourceEventId, record);
  }
  if (manifestRecords.size !== 600) {
    throw new Error(`manifest_count:${manifestRecords.size}`);
  }
  return { questions: benchmark.questions, manifestText, manifestRecords, digest };
}

export async function runFastapiV2Benchmark(env: NodeJS.ProcessEnv = process.env) {
  const loaded = await loadFastapiV2Benchmark();
  const resolution = resolveEvalDatabaseUrl(env);
  if (resolution.status !== "ready") {
    throw new Error(resolution.reason);
  }
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
    if (!tenant) {
      throw new Error("eval_tenant_missing");
    }
    const repository = await db.query.repositories.findFirst({
      where: eq(schema.repositories.tenantId, tenant.id),
    });
    if (!repository || repository.fullName !== FASTAPI_FULL_NAME || !repository.selected) {
      throw new Error("eval_repository_missing");
    }
    const stored = await db.query.events.findMany({
      where: eq(schema.events.tenantId, tenant.id),
    });
    const storedIds = new Set(stored.map((row) => row.sourceEventId));
    const missing = [...loaded.manifestRecords.keys()].filter((id) => !storedIds.has(id));
    const unexpected = [...storedIds].filter((id) => !loaded.manifestRecords.has(id));
    if (missing.length > 0 || unexpected.length > 0 || stored.length !== 600) {
      throw new Error(
        `import_id_mismatch:stored=${stored.length}:missing=${missing.length}:unexpected=${unexpected.length}`,
      );
    }
    const bySource = new Map(stored.map((row) => [row.sourceEventId, row]));
    const questions = [];
    for (const question of loaded.questions) {
      const sourceId = question.expectedSourceIds[0];
      if (!sourceId || question.expectedSourceIds.length !== 1) {
        throw new Error(`expected_one_source:${question.id}`);
      }
      const manifestDiff = manifestMismatches(question, loaded.manifestRecords.get(sourceId));
      const row = bySource.get(sourceId);
      const databaseDiff = row ? databaseMismatches(question, row) : ["missing_event"];
      const verified = manifestDiff.length === 0 && databaseDiff.length === 0;
      const from = new Date(question.window.from);
      const to = new Date(question.window.to);
      const searched = await searchEvidence(db, {
        tenantId: tenant.id,
        repositoryIds: [repository.id],
        text: question.query,
        since: from,
        until: to,
        config: null,
      });
      const built = await buildContext(db, {
        tenantId: tenant.id,
        query: question.query,
        config: null,
        from,
        to,
        now: new Date("2026-10-11T00:00:00.000Z"),
      });
      const evidenceSourceIds = built.evidence.map((item) => item.sourceId);
      const searchSourceIds = searched.map((item) => item.sourceId);
      const subjectSourceId =
        built.subject.status === "resolved" ? built.subject.entity.sourceId : null;
      const eligible = verified && insideWindow(question.fact.eventTime, question.window);
      questions.push({
        id: question.id,
        category: question.category,
        query: question.query,
        expectedSourceIds: question.expectedSourceIds,
        fact: question.fact.summary,
        window: question.window,
        verification: {
          status: verified ? "verified" : "unverified",
          manifestMismatches: manifestDiff,
          databaseMismatches: databaseDiff,
        },
        eligible,
        searchEvidenceSourceIds: searchSourceIds,
        evidenceSourceIds,
        expectedInEvidence: evidenceSourceIds.includes(sourceId),
        expectedInEventsOnly: storedIds.has(sourceId) && !evidenceSourceIds.includes(sourceId),
        storedInEventsTable: storedIds.has(sourceId),
        inPackageEvents: built.events.some((item) => item.sourceEventId === sourceId),
        inCurrentState: built.currentState.some((item) => item.sourceId === sourceId),
        subject: {
          status: built.subject.status,
          sourceId: subjectSourceId,
          expectedSourceId: question.expectedSubjectSourceId,
          matches:
            question.expectedSubjectSourceId === null
              ? built.subject.status === "unresolved"
              : subjectSourceId === question.expectedSubjectSourceId,
        },
        scopeRepositoryIds: built.scope.repositoryIds,
      });
    }
    const issueMetrics = metricsFor(questions, "github:issue:");
    const pullRequestMetrics = metricsFor(questions, "github:pull_request:");
    return {
      version: 1,
      realCorpus: {
        status: "not_run" as const,
        reason: "precision_unscored_without_verified_relevant_set",
      },
      manifestSha256: loaded.digest,
      database: EVAL_DATABASE_NAME,
      tenantSlug: FASTAPI_V2_SLUG,
      repositoryFullName: repository.fullName,
      import: {
        expectedSourceIds: 600,
        storedSourceIds: stored.length,
        missing,
        unexpected,
      },
      comments: "not_fetched" as const,
      reviews: "not_fetched" as const,
      precision: {
        status: "unscored" as const,
        reason: "verified relevant set is absent",
      },
      measures: {
        factVerification: "verification.status agrees the manifest and the imported events row. It is not retrieval success.",
        expectedInEvidence: "The expected source id is in buildContext evidence for the question window.",
        expectedInEventsOnly: "The expected source id is in the events table and absent from buildContext evidence.",
        questionLevelRecall: "metrics.issues.questionLevel.recall and metrics.pullRequests.questionLevel.recall count each question.",
        distinctSourceRecall: "metrics.issues.distinctSource.recall and metrics.pullRequests.distinctSource.recall count each source id once.",
        precision: "precision.status stays unscored without a verified relevant set.",
      },
      questions,
      metrics: {
        issues: issueMetrics,
        pullRequests: pullRequestMetrics,
      },
      limitations: [
        "Recall uses buildContext evidence for verified questions whose event_time is inside the question window. Precision is unscored because the capped evidence list is not a verified relevant set.",
        "Issue and pull-request snapshots are stored in the events table and can appear in currentState. package.events contains occurrences only, so these snapshots are absent there.",
        "This run passes the question window start and end to both searchEvidence and buildContext. Answer evidence is the search hit list. listChanges stays on the changes API and is not merged into that list.",
        "Comments and reviews were not fetched. Their coverage is not zero.",
        "Search splits slash, underscore, and dot before the English parser so a path segment can match. Hyphens stay with that parser. Precision stays unscored.",
      ],
    };
  } finally {
    await sql.end();
  }
}

export function metricsFor(
  questions: Array<{
    id: string;
    expectedSourceIds: string[];
    eligible: boolean;
    expectedInEvidence: boolean;
    storedInEventsTable: boolean;
  }>,
  prefix: string,
) {
  const rows = questions.filter((question) => question.expectedSourceIds[0]?.startsWith(prefix));
  const eligibleRows = rows.filter((question) => question.eligible);
  const hits = eligibleRows.filter((question) => question.expectedInEvidence);
  const eventsNotInEvidence = eligibleRows
    .filter((question) => question.storedInEventsTable && !question.expectedInEvidence)
    .map((question) => ({ id: question.id, sourceId: question.expectedSourceIds[0] }));
  const distinct = new Set(eligibleRows.map((question) => question.expectedSourceIds[0]));
  const distinctHits = new Set(
    hits.map((question) => question.expectedSourceIds[0]),
  );
  const questionRecall = eligibleRows.length === 0 ? null : hits.length / eligibleRows.length;
  const distinctRecall = distinct.size === 0 ? null : distinctHits.size / distinct.size;
  return {
    questions: rows.length,
    questionLevel: {
      eligible: eligibleRows.length,
      evidenceHits: hits.length,
      recall: questionRecall,
    },
    distinctSource: {
      eligible: distinct.size,
      evidenceHits: distinctHits.size,
      recall: distinctRecall,
    },
    eligible: eligibleRows.length,
    evidenceHits: hits.length,
    recall: questionRecall,
    distinctEligible: distinct.size,
    distinctEvidenceHits: distinctHits.size,
    distinctRecall,
    eventsNotInEvidence,
  };
}

function insideWindow(eventTime: string, window: { from: string; to: string }): boolean {
  const time = Date.parse(eventTime);
  return time >= Date.parse(window.from) && time <= Date.parse(window.to);
}

function databaseMismatches(
  question: BenchmarkQuestion,
  row: {
    eventType: string;
    eventTime: Date | null;
    payload: Record<string, unknown>;
    recordKind: string;
  },
): string[] {
  const fact = question.fact;
  const mismatches: string[] = [];
  if (row.recordKind !== "snapshot") mismatches.push("record_kind");
  if (row.eventTime?.getTime() !== Date.parse(fact.eventTime)) mismatches.push("event_time");
  if (row.payload.title !== fact.title) mismatches.push("title");
  if (row.payload.state !== fact.state) mismatches.push("state");
  if (row.payload.number !== fact.number) mismatches.push("number");
  if ((row.payload.updatedAt ?? null) !== fact.updatedAt) mismatches.push("updatedAt");
  if ((row.payload.closedAt ?? null) !== fact.closedAt) mismatches.push("closedAt");
  if ((row.payload.merged ?? null) !== fact.merged) mismatches.push("merged");
  if ((row.payload.mergedAt ?? null) !== fact.mergedAt) mismatches.push("mergedAt");
  const expectedType = fact.merged
    ? "pull_request.merged"
    : question.expectedSourceIds[0]?.startsWith("github:issue:")
      ? `issues.${fact.state}`
      : `pull_request.${fact.state}`;
  if (row.eventType !== expectedType) mismatches.push("event_type");
  return mismatches;
}
