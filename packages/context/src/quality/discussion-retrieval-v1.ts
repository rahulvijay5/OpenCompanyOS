import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { schema, createSqlClient } from "@opencompanyos/db";
import { searchEvidence } from "@opencompanyos/retrieval";
import { keywordOrQuery } from "../../../retrieval/src/text.ts";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { buildContext } from "../build.js";
import { resolveEvalDatabaseUrl } from "./database.js";
import { scoreRetrieved } from "./discussion-retrieval.js";
import {
  EVAL_DATABASE_NAME,
  FASTAPI_FULL_NAME,
  FASTAPI_V2_SLUG,
} from "./import-fastapi-v2.js";
import { assertManifestHash } from "./manifest.js";

const directory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../eval/context-quality/corpora/fastapi-v2",
);
const reportPath = path.join(directory, "discussion-retrieval-v1.json");

type Judgment = {
  sourceId: string;
  relevant: boolean;
  eventTime: string;
  excerpt?: string;
};

type LabelQuestion = {
  id: string;
  verified: boolean;
  relevanceStatus: "verified_relevant_set" | "verified_empty";
  relevantSourceIds: string[];
  window: { from: string; to: string; role: string };
  judgments?: Judgment[];
};

type StoredRow = {
  source_event_id: string;
  event_type: string;
  event_time: Date | null;
  record_kind: string;
  payload: { body?: string };
};

export async function runDiscussionRetrieval(env: NodeJS.ProcessEnv = process.env) {
  const preregistrationText = await readFile(
    path.join(directory, "discussion-preregistration-v1.json"),
    "utf8",
  );
  const preregistration = JSON.parse(preregistrationText) as {
    verified: boolean;
    questions: Array<{ id: string; question: string; verified: boolean }>;
  };
  if (
    preregistration.verified !== false ||
    preregistration.questions.some((question) => question.verified !== false)
  ) {
    throw new Error("preregistration_must_stay_unverified");
  }
  const labels = JSON.parse(
    await readFile(path.join(directory, "discussion-labels-v1.json"), "utf8"),
  ) as { questions: LabelQuestion[] };
  if (labels.questions.length !== 16 || preregistration.questions.length !== 16) {
    throw new Error("question_count");
  }
  const questionsById = new Map(
    preregistration.questions.map((question) => [question.id, question.question]),
  );
  for (const label of labels.questions) {
    if (!label.verified || !questionsById.has(label.id)) {
      throw new Error(`label_unverified:${label.id}`);
    }
    if (label.relevanceStatus === "verified_empty" && label.relevantSourceIds.length !== 0) {
      throw new Error(`empty_set_has_ids:${label.id}`);
    }
    if (label.relevanceStatus === "verified_relevant_set" && label.relevantSourceIds.length === 0) {
      throw new Error(`relevant_set_empty:${label.id}`);
    }
  }

  const manifestText = await readFile(path.join(directory, "manifest.json"), "utf8");
  assertManifestHash(manifestText, await readFile(path.join(directory, "manifest.sha256"), "utf8"));
  const frozenDigests = {
    "benchmark-v1.json": await digest("benchmark-v1.json"),
    "benchmark-v1-results.json": await digest("benchmark-v1-results.json"),
    "benchmark-v1-results-lexical-v1.json": await digest("benchmark-v1-results-lexical-v1.json"),
    "benchmark-v1-results-repro.json": await digest("benchmark-v1-results-repro.json"),
    "facts.json": await digest("facts.json"),
    "generated-questions.json": await digest("generated-questions.json"),
  };

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
    const repository = await db.query.repositories.findFirst({
      where: eq(schema.repositories.tenantId, tenant?.id ?? ""),
    });
    if (!tenant || !repository || repository.fullName !== FASTAPI_FULL_NAME || !repository.selected) {
      throw new Error("eval_repository_missing");
    }
    const rows = await sql<StoredRow[]>`
      select source_event_id, event_type, event_time, record_kind, payload
      from events
      where tenant_id = ${tenant.id}
    `;
    const byId = new Map(rows.map((row) => [row.source_event_id, row]));
    const snapshots = rows.filter((row) => row.record_kind === "snapshot");
    const reviews = rows.filter((row) => row.event_type === "pull_request_review.backfill");
    if (snapshots.length !== 600 || reviews.length !== 0) {
      throw new Error(`stored_shape:${snapshots.length}:${reviews.length}`);
    }
    for (const label of labels.questions) {
      for (const judgment of label.judgments ?? []) {
        const row = byId.get(judgment.sourceId);
        if (!row || Date.parse(String(row.event_time)) !== Date.parse(judgment.eventTime)) {
          throw new Error(`stored_mismatch:${judgment.sourceId}`);
        }
        const body = typeof row.payload.body === "string" ? row.payload.body : "";
        if (judgment.excerpt && !body.includes(judgment.excerpt)) {
          throw new Error(`excerpt_missing:${judgment.sourceId}`);
        }
        const listed = label.relevantSourceIds.includes(judgment.sourceId);
        if (listed !== judgment.relevant) {
          throw new Error(`relevance_mismatch:${judgment.sourceId}`);
        }
      }
    }

    const questions = [];
    for (const label of labels.questions) {
      const query = questionsById.get(label.id);
      if (!query) {
        throw new Error(`missing_question:${label.id}`);
      }
      const from = new Date(label.window.from);
      const to = new Date(label.window.to);
      const searched = await searchEvidence(db, {
        tenantId: tenant.id,
        repositoryIds: [repository.id],
        text: query,
        since: from,
        until: to,
        config: null,
      });
      const built = await buildContext(db, {
        tenantId: tenant.id,
        query,
        config: null,
        from,
        to,
        now: new Date("2026-10-11T00:00:00.000Z"),
      });
      const searchIds = searched.map((hit) => hit.sourceId);
      const evidenceIds = built.evidence.map((item) => item.sourceId);
      questions.push({
        id: label.id,
        query,
        lexicalQuery: keywordOrQuery(query),
        relevanceStatus: label.relevanceStatus,
        relevantSourceIds: label.relevantSourceIds,
        window: label.window,
        searchEvidence: {
          sourceIds: searchIds,
          snippets: searched.map((hit) => ({
            sourceId: hit.sourceId,
            title: hit.title,
            snippet: (hit.snippet ?? "").slice(0, 240),
          })),
          ...scoreRetrieved(label.relevantSourceIds, searchIds),
        },
        buildContext: {
          sourceIds: evidenceIds,
          addedByListChanges: evidenceIds.filter((id) => !searchIds.includes(id)),
          snippets: built.evidence.map((item) => ({
            sourceId: item.sourceId,
            title: item.title,
            snippet: (item.snippet ?? "").slice(0, 240),
          })),
          ...scoreRetrieved(label.relevantSourceIds, evidenceIds),
        },
      });
    }

    return {
      version: 1,
      realCorpus: {
        status: "not_run" as const,
        reason:
          "This is a 16-question discussion slice. facts.json is empty, generated questions are unverified, and the 24-question lexical benchmark has no verified relevant set.",
      },
      database: EVAL_DATABASE_NAME,
      tenantSlug: FASTAPI_V2_SLUG,
      snapshots: snapshots.length,
      reviews: reviews.length,
      frozenDigests,
      measures: {
        recall: "Fraction of verified relevant source ids present in that retrieval list. Null when the relevant set is empty.",
        precision: "Fraction of retrieved source ids that are in the verified relevant set. Null when nothing was retrieved. Scored only because this label file verifies the full set.",
        claimSupport: "supports when every retrieved id is relevant and every relevant id was retrieved. mixed when relevant and non-relevant text are both retrieved. does_not_support when no relevant text was retrieved. abstained when the verified set is empty and nothing was retrieved.",
        abstention: "For a verified empty set, abstained is true only when that retrieval list is empty.",
      },
      questions,
    };
  } finally {
    await sql.end();
  }
}

async function digest(name: string): Promise<string> {
  const bytes = await readFile(path.join(directory, name));
  return createHash("sha256").update(bytes).digest("hex");
}

const isEntry = process.argv[1]?.endsWith("discussion-retrieval-v1.ts") === true;
if (isEntry) {
  const report = await runDiscussionRetrieval();
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  for (const question of report.questions) {
    console.log(
      [
        question.id,
        `search=${question.searchEvidence.claimSupport}`,
        `context=${question.buildContext.claimSupport}`,
        `searchRecall=${question.searchEvidence.recall ?? "empty"}`,
        `contextRecall=${question.buildContext.recall ?? "empty"}`,
      ].join(" "),
    );
  }
}
