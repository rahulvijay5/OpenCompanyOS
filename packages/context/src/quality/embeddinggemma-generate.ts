import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSqlClient } from "@opencompanyos/db";
import { resolveEvalDatabaseUrl } from "./database.js";
import { embedWithOllama } from "./local-embedding-ollama.js";
import {
  DOCUMENT_PREPROCESSING,
  EVAL_DATABASE_NAME,
  EVAL_REPOSITORY,
  EVAL_TENANT_SLUG,
  LOCAL_EMBEDDING_DDL,
  LOCAL_EXPERIMENT,
  LOCAL_MODEL,
  LOCAL_RUNTIME,
  NORMALIZATION_METHOD,
  QUERY_PREPROCESSING,
  contentHash,
  documentPrompt,
  localVectorIdentity,
  normalizeForStorage,
  queryPrompt,
  shouldReuseStoredVector,
  type VectorIdentity,
} from "./local-embedding.js";

const BATCH = 16;
const questionsPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../eval/context-quality/context-quality-v2/questions.json",
);

type Sql = ReturnType<typeof createSqlClient>;

function vectorLiteral(values: readonly number[]): string {
  return `[${values.join(",")}]`;
}

function identityFromRow(row: Record<string, string | number>): VectorIdentity {
  return {
    experiment: String(row.experiment),
    preprocessing: String(row.preprocessing),
    contentSha256: String(row.content_sha256),
    modelName: String(row.model_name),
    dimensions: Number(row.dimensions),
    normalizationMethod: String(row.normalization_method),
  };
}

async function assertEvalTenant(sql: Sql): Promise<void> {
  const names = await sql<{ name: string }[]>`select current_database() as name`;
  const database = names[0]?.name ?? "unknown";
  if (database !== EVAL_DATABASE_NAME) {
    throw new Error(`eval_database_rejected:${database}`);
  }
  const tenants = await sql<{ slug: string; full_name: string | null }[]>`
    select t.slug, r.full_name
    from tenants t
    left join repositories r on r.tenant_id = t.id
    where t.slug = ${EVAL_TENANT_SLUG}
  `;
  if (tenants.length !== 1 || tenants[0]?.full_name !== EVAL_REPOSITORY) {
    throw new Error("tenant_or_repository_mismatch");
  }
}

export async function runLocalEmbeddingGenerate(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const resolution = resolveEvalDatabaseUrl(env);
  if (resolution.status !== "ready") {
    throw new Error(resolution.reason);
  }
  const sql = createSqlClient(resolution.url);
  const runId = `embeddinggemma-${new Date().toISOString()}`;
  let requests = 0;
  let retries = 0;
  let failures = 0;
  try {
    await assertEvalTenant(sql);
    for (const statement of LOCAL_EMBEDDING_DDL) {
      await sql.unsafe(statement);
    }
    await sql`
      insert into eval_local_embedding_runs (run_id, status)
      values (${runId}, 'running')
    `;
    const chunks = await sql<{ id: string; content: string }[]>`
      select c.id, c.content
      from document_chunks c
      join documents d on d.id = c.document_id
      join tenants t on t.id = d.tenant_id
      where t.slug = ${EVAL_TENANT_SLUG}
      order by c.id
    `;
    const suite = JSON.parse(await readFile(questionsPath, "utf8")) as {
      questions: Array<{ id: string; question: string }>;
    };
    const storedChunks = await sql<Array<Record<string, string | number>>>`
      select document_chunk_id, experiment, preprocessing, content_sha256,
             model_name, dimensions, normalization_method
      from eval_local_chunk_embeddings
      where experiment = ${LOCAL_EXPERIMENT}
    `;
    const storedByChunk = new Map(
      storedChunks.map((row) => [String(row.document_chunk_id), identityFromRow(row)]),
    );
    const pendingChunks = chunks.filter((chunk) => {
      const stored = storedByChunk.get(chunk.id);
      return !(
        stored &&
        shouldReuseStoredVector(
          stored,
          localVectorIdentity({ preprocessing: DOCUMENT_PREPROCESSING, content: chunk.content }),
        )
      );
    });

    async function recordFailure(kind: string, id: string, content: string, error: unknown) {
      failures += 1;
      const message = error instanceof Error ? error.message.slice(0, 300) : "embedding_failed";
      await sql`
        insert into eval_local_embedding_failures (run_id, target_kind, target_id, content_sha256, error)
        values (${runId}, ${kind}, ${id}, ${contentHash(content)}, ${message})
      `;
    }

    for (let index = 0; index < pendingChunks.length; index += BATCH) {
      const batch = pendingChunks.slice(index, index + BATCH);
      requests += 1;
      try {
        const vectors = await embedWithOllama({
          texts: batch.map((chunk) => documentPrompt(chunk.content)),
          onRetry: () => {
            retries += 1;
          },
        });
        for (let item = 0; item < batch.length; item += 1) {
          const chunk = batch[item];
          const vector = vectors[item];
          if (!chunk || !vector) {
            continue;
          }
          try {
          const unit = normalizeForStorage(vector);
          await sql.unsafe(
            `insert into eval_local_chunk_embeddings (
               document_chunk_id, experiment, preprocessing, content_sha256, embedding,
               model_name, runtime, dimensions, normalized, normalization_method
             ) values ($1, $2, $3, $4, $5::vector, $6, $7, $8, true, $9)
             on conflict (document_chunk_id, experiment, preprocessing) do update set
               content_sha256 = excluded.content_sha256,
               embedding = excluded.embedding,
               model_name = excluded.model_name,
               runtime = excluded.runtime,
               dimensions = excluded.dimensions,
               normalized = excluded.normalized,
               normalization_method = excluded.normalization_method,
               created_at = now()`,
            [
              chunk.id,
              LOCAL_EXPERIMENT,
              DOCUMENT_PREPROCESSING,
              contentHash(chunk.content),
              vectorLiteral(unit),
              LOCAL_MODEL,
              LOCAL_RUNTIME,
              unit.length,
              NORMALIZATION_METHOD,
            ],
          );
          } catch (error) {
            await recordFailure("chunk", chunk.id, chunk.content, error);
          }
        }
      } catch (error) {
        for (const chunk of batch) {
          await recordFailure("chunk", chunk.id, chunk.content, error);
        }
      }
    }

    const storedQuestions = await sql<Array<Record<string, string | number>>>`
      select question_id, experiment, preprocessing, question_sha256 as content_sha256,
             model_name, dimensions, normalization_method
      from eval_local_query_embeddings
      where experiment = ${LOCAL_EXPERIMENT}
    `;
    const storedByQuestion = new Map(
      storedQuestions.map((row) => [String(row.question_id), identityFromRow(row)]),
    );
    const pendingQuestions = suite.questions.filter((question) => {
      const stored = storedByQuestion.get(question.id);
      return !(
        stored &&
        shouldReuseStoredVector(
          stored,
          localVectorIdentity({ preprocessing: QUERY_PREPROCESSING, content: question.question }),
        )
      );
    });
    if (pendingQuestions.length > 0) {
      requests += 1;
      try {
        const vectors = await embedWithOllama({
          texts: pendingQuestions.map((question) => queryPrompt(question.question)),
          onRetry: () => {
            retries += 1;
          },
        });
        for (let item = 0; item < pendingQuestions.length; item += 1) {
          const question = pendingQuestions[item];
          const vector = vectors[item];
          if (!question || !vector) {
            continue;
          }
          try {
          const unit = normalizeForStorage(vector);
          await sql.unsafe(
            `insert into eval_local_query_embeddings (
               question_id, experiment, preprocessing, question_sha256, embedding,
               model_name, runtime, dimensions, normalized, normalization_method
             ) values ($1, $2, $3, $4, $5::vector, $6, $7, $8, true, $9)
             on conflict (question_id, experiment, preprocessing) do update set
               question_sha256 = excluded.question_sha256,
               embedding = excluded.embedding,
               model_name = excluded.model_name,
               runtime = excluded.runtime,
               dimensions = excluded.dimensions,
               normalized = excluded.normalized,
               normalization_method = excluded.normalization_method,
               created_at = now()`,
            [
              question.id,
              LOCAL_EXPERIMENT,
              QUERY_PREPROCESSING,
              contentHash(question.question),
              vectorLiteral(unit),
              LOCAL_MODEL,
              LOCAL_RUNTIME,
              unit.length,
              NORMALIZATION_METHOD,
            ],
          );
          } catch (error) {
            await recordFailure("question", question.id, question.question, error);
          }
        }
      } catch (error) {
        for (const question of pendingQuestions) {
          await recordFailure("question", question.id, question.question, error);
        }
      }
    }

    const storedCount = await sql<{ chunks: number; questions: number }[]>`
      select
        (select count(*) from eval_local_chunk_embeddings where experiment = ${LOCAL_EXPERIMENT})::int as chunks,
        (select count(*) from eval_local_query_embeddings where experiment = ${LOCAL_EXPERIMENT})::int as questions
    `;
    const complete =
      failures === 0 &&
      storedCount[0]?.chunks === chunks.length &&
      storedCount[0]?.questions === suite.questions.length;
    await sql`
      update eval_local_embedding_runs
      set status = ${complete ? "complete" : "incomplete"},
          request_count = ${requests},
          retry_count = ${retries},
          failure_count = ${failures},
          finished_at = now()
      where run_id = ${runId}
    `;
    console.log(
      JSON.stringify({
        runId,
        complete,
        chunks: storedCount[0]?.chunks ?? 0,
        questions: storedCount[0]?.questions ?? 0,
        failures,
        requests,
      }),
    );
    if (!complete) {
      process.exitCode = 4;
    }
  } finally {
    await sql.end();
  }
}
