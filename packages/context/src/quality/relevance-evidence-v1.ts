import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSqlClient, schema } from "@opencompanyos/db";
import { discussionContentTokens } from "@opencompanyos/retrieval";
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

const root = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../eval/context-quality",
);
const corpus = path.join(root, "corpora/fastapi-v2");
const reportPath = path.join(root, "reports/relevance-evidence-v1.json");

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

type PriorQuestion = {
  id: string;
  after?: string[];
  buildContext?: { sourceIds?: string[] };
};

type LabelQuestion = {
  id: string;
  relevantSourceIds: string[];
  window: { from: string; to: string };
};

const now = new Date("2026-10-11T00:00:00.000Z");

export async function runRelevanceEvidence(env: NodeJS.ProcessEnv = process.env) {
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
  const previous = JSON.parse(
    await readFile(path.join(root, "reports/intent-evidence-v1.json"), "utf8"),
  ) as { questions: PriorQuestion[] };
  const questionsById = new Map(
    preregistration.questions.map((question) => [question.id, question.question]),
  );
  const labelsById = new Map(labels.questions.map((question) => [question.id, question]));
  const previousById = new Map(
    previous.questions.map((question) => [question.id, question.after ?? []]),
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
      const scored = scoreRetrieved(label.relevantSourceIds, evidenceIds);
      questions.push({
        id,
        query,
        intent: resolveQueryIntent(query) ?? null,
        contentTokens: discussionContentTokens(query),
        relevantSourceIds: label.relevantSourceIds,
        previous: previousById.get(id) ?? [],
        evidenceSourceIds: evidenceIds,
        currentStateSourceIds: built.currentState.map((item) => item.sourceId),
        insufficientEvidence: built.uncertainties.some(
          (item) => item.code === "insufficient_evidence",
        ),
        ...scored,
        limitation:
          id === "comment-issue-5833"
            ? "The stored comments mention GZipMiddleware, not the words response or compression. Strict topic matching abstains instead of returning the whole thread."
            : null,
      });
    }

    const titleQuery = "What is the recorded title of issue #16451?";
    const titleWindow = {
      from: new Date("2026-10-02T04:34:43Z"),
      to: new Date("2026-10-02T04:34:43Z"),
    };
    const title = await buildContext(db, {
      tenantId: tenant.id,
      query: titleQuery,
      config: null,
      from: titleWindow.from,
      to: titleWindow.to,
      now,
    });
    const titleOutside = await buildContext(db, {
      tenantId: tenant.id,
      query: titleQuery,
      config: null,
      from: new Date("2026-10-11T00:00:00Z"),
      to: new Date("2026-10-11T00:00:00Z"),
      now,
    });
    const unknown = await buildContext(db, {
      tenantId: tenant.id,
      query: "What is the recorded title of issue #999999?",
      config: null,
      from: titleWindow.from,
      to: titleWindow.to,
      now,
    });

    return {
      version: 1,
      realCorpus: {
        status: "not_run" as const,
        reason:
          "Read-only relevance check on the labeled discussion slice and one metadata title question. It does not score the 24-question benchmark or the corpus as a whole.",
      },
      database,
      tenantSlug: FASTAPI_V2_SLUG,
      questions,
      recordedTitle: {
        query: titleQuery,
        expectedSourceId: "github:issue:5671616833",
        evidenceSourceIds: title.evidence.map((item) => item.sourceId),
        currentStateSourceIds: title.currentState.map((item) => item.sourceId),
        outsideWindowEvidenceSourceIds: titleOutside.evidence.map((item) => item.sourceId),
        outsideWindowCurrentStateSourceIds: titleOutside.currentState.map((item) => item.sourceId),
      },
      unknownNumber: {
        query: "What is the recorded title of issue #999999?",
        subject: unknown.subject.status,
        evidenceSourceIds: unknown.evidence.map((item) => item.sourceId),
      },
    };
  } finally {
    await sql.end();
  }
}

const isEntry = process.argv[1]?.endsWith("relevance-evidence-v1.ts") === true;
if (isEntry) {
  const report = await runRelevanceEvidence();
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  for (const question of report.questions) {
    console.log(
      [
        question.id,
        `tokens=${question.contentTokens.join("+") || "-"}`,
        `evidence=${question.evidenceSourceIds.join(",") || "-"}`,
        `insufficient=${question.insufficientEvidence}`,
      ].join(" "),
    );
  }
  console.log(
    `title evidence=${report.recordedTitle.evidenceSourceIds.join(",") || "-"} outside=${report.recordedTitle.outsideWindowEvidenceSourceIds.join(",") || "-"}`,
  );
  console.log(
    `unknown subject=${report.unknownNumber.subject} evidence=${report.unknownNumber.evidenceSourceIds.join(",") || "-"}`,
  );
}
