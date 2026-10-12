import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSqlClient, schema } from "@opencompanyos/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { buildContext } from "../build.js";
import { resolveQueryIntent } from "../intent.js";
import { resolveEvalDatabaseUrl } from "./database.js";
import { scoreRetrieved } from "./discussion-retrieval.js";
import {
  EVAL_DATABASE_NAME,
  FASTAPI_FULL_NAME,
  FASTAPI_V2_SLUG,
} from "./import-fastapi-v2.js";

const corpus = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../eval/context-quality/corpora/fastapi-v2",
);
const reportPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../eval/context-quality/reports/intent-evidence-v1.json",
);

const QUESTION_IDS = [
  "comment-issue-5833",
  "comment-issue-10370",
  "comment-pr-16465",
  "comment-pr-16480",
  "review-pr-16470",
  "review-pr-16480",
  "abstain-inline-review-16468",
  "abstain-issue-body-16451",
];

type FrozenQuestion = {
  id: string;
  buildContext?: { sourceIds?: string[] };
};

type LabelQuestion = {
  id: string;
  relevantSourceIds: string[];
  window: { from: string; to: string };
};

const now = new Date("2026-10-11T00:00:00.000Z");

export async function runIntentEvidence(env: NodeJS.ProcessEnv = process.env) {
  const resolution = resolveEvalDatabaseUrl(env);
  if (resolution.status !== "ready") {
    throw new Error(resolution.reason);
  }
  const preregistration = JSON.parse(
    await readFile(path.join(corpus, "discussion-preregistration-v1.json"), "utf8"),
  ) as { questions: Array<{ id: string; question: string }> };
  const labels = JSON.parse(
    await readFile(path.join(corpus, "discussion-labels-v1.json"), "utf8"),
  ) as { questions: LabelQuestion[] };
  const frozen = JSON.parse(
    await readFile(path.join(corpus, "discussion-retrieval-v1.json"), "utf8"),
  ) as { questions: FrozenQuestion[] };
  const questionsById = new Map(
    preregistration.questions.map((question) => [question.id, question.question]),
  );
  const labelsById = new Map(labels.questions.map((question) => [question.id, question]));
  const beforeById = new Map(
    frozen.questions.map((question) => [question.id, question.buildContext?.sourceIds ?? []]),
  );

  const sql = createSqlClient(resolution.url);
  const db = drizzle(sql, { schema });
  try {
    const names = await sql<{ name: string }[]>`select current_database() as name`;
    const database = names[0]?.name ?? "unknown";
    if (database !== EVAL_DATABASE_NAME) {
      throw new Error(`eval_database_rejected:${database}`);
    }
    const tenant = await db.query.tenants.findFirst({
      where: eq(schema.tenants.slug, FASTAPI_V2_SLUG),
    });
    const repository = await db.query.repositories.findFirst({
      where: eq(schema.repositories.tenantId, tenant?.id ?? ""),
    });
    if (!tenant || !repository || repository.fullName !== FASTAPI_FULL_NAME) {
      throw new Error("eval_repository_missing");
    }

    const questions = [];
    for (const id of QUESTION_IDS) {
      const query = questionsById.get(id);
      const label = labelsById.get(id);
      if (!query || !label) {
        throw new Error(`missing_question:${id}`);
      }
      const built = await buildContext(db, {
        tenantId: tenant.id,
        query,
        config: null,
        from: new Date(label.window.from),
        to: new Date(label.window.to),
        now,
      });
      const evidenceIds = built.evidence.map((item) => item.sourceId);
      questions.push({
        id,
        query,
        intent: resolveQueryIntent(query) ?? null,
        relevantSourceIds: label.relevantSourceIds,
        before: beforeById.get(id) ?? [],
        after: evidenceIds,
        currentStateSourceIds: built.currentState.map((item) => item.sourceId),
        insufficientEvidence: built.uncertainties.some(
          (item) => item.code === "insufficient_evidence",
        ),
        ...scoreRetrieved(label.relevantSourceIds, evidenceIds),
      });
    }

    const metadataQuery = "mangum #16451";
    const metadata = await buildContext(db, {
      tenantId: tenant.id,
      query: metadataQuery,
      config: null,
      from: new Date("2026-10-02T04:34:43Z"),
      to: new Date("2026-10-02T04:34:43Z"),
      now,
    });
    const naturalTitle = "What is the recorded title of issue #16451?";
    const title = await buildContext(db, {
      tenantId: tenant.id,
      query: naturalTitle,
      config: null,
      from: new Date("2026-10-02T04:34:43Z"),
      to: new Date("2026-10-02T04:34:43Z"),
      now,
    });

    return {
      version: 1,
      realCorpus: {
        status: "not_run" as const,
        reason:
          "Read-only intent experiment on the labeled discussion slice. It does not replace discussion-retrieval-v1.json or score the 24-question benchmark.",
      },
      database,
      tenantSlug: FASTAPI_V2_SLUG,
      questions,
      metadata: {
        query: metadataQuery,
        intent: resolveQueryIntent(metadataQuery) ?? null,
        evidenceSourceIds: metadata.evidence.map((item) => item.sourceId),
        abstained: metadata.uncertainties.some((item) => item.code === "insufficient_evidence"),
      },
      naturalTitle: {
        query: naturalTitle,
        intent: resolveQueryIntent(naturalTitle) ?? null,
        evidenceSourceIds: title.evidence.map((item) => item.sourceId),
        abstained: title.uncertainties.some((item) => item.code === "insufficient_evidence"),
      },
    };
  } finally {
    await sql.end();
  }
}

const isEntry = process.argv[1]?.endsWith("intent-evidence-v1.ts") === true;
if (isEntry) {
  const report = await runIntentEvidence();
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  for (const question of report.questions) {
    console.log(
      [
        question.id,
        `intent=${question.intent ?? "metadata"}`,
        `insufficient=${question.insufficientEvidence}`,
        `after=${question.after.join(",") || "-"}`,
      ].join(" "),
    );
  }
  console.log(
    `metadata intent=${report.metadata.intent ?? "metadata"} evidence=${report.metadata.evidenceSourceIds.join(",") || "-"}`,
  );
  console.log(
    `title intent=${report.naturalTitle.intent ?? "metadata"} evidence=${report.naturalTitle.evidenceSourceIds.join(",") || "-"}`,
  );
}
