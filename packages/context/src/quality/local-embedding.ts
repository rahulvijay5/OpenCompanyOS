import { createHash } from "node:crypto";

export const LOCAL_EXPERIMENT = "embeddinggemma-ollama-v1";
export const LOCAL_MODEL = "embeddinggemma";
export const LOCAL_RUNTIME = "ollama";
export const LOCAL_EMBED_URL = "http://localhost:11434/api/embed";
export const EXPECTED_DIMENSIONS = 768;
export const NORMALIZATION_METHOD = "l2-unit";
export const DOCUMENT_PREPROCESSING = "embeddinggemma-document-v1";
export const QUERY_PREPROCESSING = "embeddinggemma-query-v1";
export const LOCAL_PROBE_TEXT = "local embedding probe";
export const EVAL_DATABASE_NAME = "opencompanyos_eval";
export const EVAL_TENANT_SLUG = "fastapi-v2-eeb18b73";
export const EVAL_REPOSITORY = "fastapi/fastapi";

export type VectorIdentity = {
  experiment: string;
  preprocessing: string;
  contentSha256: string;
  modelName: string;
  dimensions: number;
  normalizationMethod: string;
};

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function documentPrompt(content: string): string {
  return `title: none | text: ${content}`;
}

export function queryPrompt(question: string): string {
  return `task: search result | query: ${question}`;
}

export function localVectorIdentity(input: {
  preprocessing: string;
  content: string;
}): VectorIdentity {
  return {
    experiment: LOCAL_EXPERIMENT,
    preprocessing: input.preprocessing,
    contentSha256: contentHash(input.content),
    modelName: LOCAL_MODEL,
    dimensions: EXPECTED_DIMENSIONS,
    normalizationMethod: NORMALIZATION_METHOD,
  };
}

/** A stored vector is reusable only when the local experiment identity matches exactly. */
export function shouldReuseStoredVector(
  stored: VectorIdentity,
  requested: VectorIdentity,
): boolean {
  return (
    stored.experiment === requested.experiment &&
    stored.experiment === LOCAL_EXPERIMENT &&
    stored.preprocessing === requested.preprocessing &&
    stored.contentSha256 === requested.contentSha256 &&
    stored.modelName === requested.modelName &&
    stored.modelName === LOCAL_MODEL &&
    stored.dimensions === requested.dimensions &&
    stored.dimensions === EXPECTED_DIMENSIONS &&
    stored.normalizationMethod === requested.normalizationMethod &&
    stored.normalizationMethod === NORMALIZATION_METHOD
  );
}

export function assertOllamaModel(model: unknown): void {
  if (typeof model !== "string" || !/^embeddinggemma(?::|$)/.test(model)) {
    throw new Error("ollama_model_mismatch");
  }
}

export function parseOllamaEmbeddings(body: unknown, expectedCount: number): number[][] {
  if (body === null || typeof body !== "object") {
    throw new Error("ollama_response_invalid");
  }
  const record = body as { model?: unknown; embeddings?: unknown };
  assertOllamaModel(record.model);
  if (!Array.isArray(record.embeddings) || record.embeddings.length !== expectedCount) {
    throw new Error("ollama_count_mismatch");
  }
  return record.embeddings.map((embedding) => {
    if (!Array.isArray(embedding) || embedding.some((value) => typeof value !== "number")) {
      throw new Error("ollama_response_invalid");
    }
    return embedding as number[];
  });
}

export function l2Norm(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new Error("non_finite_component");
    }
    sum += value * value;
  }
  return Math.sqrt(sum);
}

export function normalizeForStorage(values: readonly number[]): number[] {
  if (values.length !== EXPECTED_DIMENSIONS) {
    throw new Error(`dimension_mismatch:${values.length}`);
  }
  const norm = l2Norm(values);
  if (!(norm > 0)) {
    throw new Error("zero_norm");
  }
  const unit = values.map((value) => value / norm);
  const unitNorm = l2Norm(unit);
  if (Math.abs(unitNorm - 1) > 1e-6) {
    throw new Error("unit_norm_mismatch");
  }
  return unit;
}

export const LOCAL_EMBEDDING_DDL = [
  `CREATE TABLE IF NOT EXISTS eval_local_chunk_embeddings (
      document_chunk_id uuid NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
      experiment text NOT NULL,
      preprocessing text NOT NULL,
      content_sha256 text NOT NULL,
      embedding vector(768) NOT NULL,
      model_name text NOT NULL,
      runtime text NOT NULL,
      dimensions integer NOT NULL,
      normalized boolean NOT NULL,
      normalization_method text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (document_chunk_id, experiment, preprocessing)
    )`,
  `CREATE TABLE IF NOT EXISTS eval_local_query_embeddings (
      question_id text NOT NULL,
      experiment text NOT NULL,
      preprocessing text NOT NULL,
      question_sha256 text NOT NULL,
      embedding vector(768) NOT NULL,
      model_name text NOT NULL,
      runtime text NOT NULL,
      dimensions integer NOT NULL,
      normalized boolean NOT NULL,
      normalization_method text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (question_id, experiment, preprocessing)
    )`,
  `CREATE TABLE IF NOT EXISTS eval_local_embedding_failures (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id text NOT NULL,
      target_kind text NOT NULL,
      target_id text NOT NULL,
      content_sha256 text,
      error text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
  `CREATE TABLE IF NOT EXISTS eval_local_embedding_runs (
      run_id text PRIMARY KEY,
      status text NOT NULL,
      request_count integer NOT NULL DEFAULT 0,
      retry_count integer NOT NULL DEFAULT 0,
      failure_count integer NOT NULL DEFAULT 0,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz
    )`,
] as const;
