import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DOCUMENT_PREPROCESSING,
  LOCAL_EMBEDDING_DDL,
  LOCAL_EXPERIMENT,
  LOCAL_MODEL,
  NORMALIZATION_METHOD,
  QUERY_PREPROCESSING,
  contentHash,
  documentPrompt,
  localVectorIdentity,
  normalizeForStorage,
  parseOllamaEmbeddings,
  queryPrompt,
  shouldReuseStoredVector,
} from "./local-embedding.js";
import {
  OllamaHttpError,
  assertLocalEmbedUrl,
  embedWithOllama,
  isRetryableOllamaFailure,
} from "./local-embedding-ollama.js";
import { runLocalProbe } from "./embeddinggemma-v1.js";

function unitVector(): number[] {
  const values = Array.from({ length: 768 }, () => 0);
  values[0] = 2;
  return values;
}

describe("local embedding validation", () => {
  it("accepts a 768-value vector and normalizes it to unit length", () => {
    const unit = normalizeForStorage(unitVector());
    expect(unit).toHaveLength(768);
    expect(unit[0]).toBe(1);
    expect(unit.slice(1).every((value) => value === 0)).toBe(true);
  });

  it("rejects a non-finite value, a zero vector, and the wrong dimension", () => {
    const nonFinite = unitVector();
    nonFinite[1] = Number.NaN;
    expect(() => normalizeForStorage(nonFinite)).toThrow(/non_finite_component/);
    expect(() => normalizeForStorage(Array.from({ length: 768 }, () => 0))).toThrow(/zero_norm/);
    expect(() => normalizeForStorage([1, 0])).toThrow(/dimension_mismatch:2/);
  });

  it("requires the Ollama model identity and one embedding per input", () => {
    expect(parseOllamaEmbeddings({ model: "embeddinggemma", embeddings: [unitVector()] }, 1)).toHaveLength(1);
    expect(() => parseOllamaEmbeddings({ model: "gemini-embedding-001", embeddings: [[1]] }, 1)).toThrow(
      /ollama_model_mismatch/,
    );
    expect(() => parseOllamaEmbeddings({ model: "embeddinggemma", embeddings: [[1]] }, 2)).toThrow(
      /ollama_count_mismatch/,
    );
  });

  it("keeps document and query preprocessing distinct", () => {
    expect(DOCUMENT_PREPROCESSING).not.toBe(QUERY_PREPROCESSING);
    expect(documentPrompt("body")).toBe("title: none | text: body");
    expect(queryPrompt("compression")).toBe("task: search result | query: compression");
    expect(contentHash("body")).not.toBe(contentHash(documentPrompt("body")));
  });
});

describe("local embedding isolation and idempotency", () => {
  it("reuses a vector only when model, preprocessing, hash, and normalization match", () => {
    const requested = localVectorIdentity({ preprocessing: DOCUMENT_PREPROCESSING, content: "body" });
    expect(shouldReuseStoredVector(requested, requested)).toBe(true);
    expect(
      shouldReuseStoredVector(
        { ...requested, contentSha256: contentHash("other") },
        requested,
      ),
    ).toBe(false);
    expect(
      shouldReuseStoredVector({ ...requested, preprocessing: QUERY_PREPROCESSING }, requested),
    ).toBe(false);
    expect(shouldReuseStoredVector({ ...requested, modelName: "gemini/gemini-embedding-001" }, requested)).toBe(
      false,
    );
    expect(shouldReuseStoredVector({ ...requested, experiment: "gemini-hosted" }, requested)).toBe(false);
    expect(shouldReuseStoredVector({ ...requested, normalizationMethod: "none" }, requested)).toBe(false);
  });

  it("does not create or alter the Gemini evaluation tables", () => {
    const ddl = LOCAL_EMBEDDING_DDL.join("\n");
    expect(ddl).toContain("eval_local_chunk_embeddings");
    expect(ddl).toContain("eval_local_query_embeddings");
    expect(ddl).not.toContain("eval_chunk_embeddings");
    expect(ddl).not.toContain("eval_query_embeddings");
    expect(ddl.toLowerCase()).not.toContain("document_chunks.embedding");
    expect(ddl.toLowerCase()).not.toContain("drop table");
    expect(LOCAL_EXPERIMENT).toBe("embeddinggemma-ollama-v1");
    expect(LOCAL_MODEL).toBe("embeddinggemma");
    expect(NORMALIZATION_METHOD).toBe("l2-unit");
  });
});

describe("Ollama client", () => {
  it("accepts only the local embed endpoint", () => {
    expect(() => assertLocalEmbedUrl("http://localhost:11434/api/embed")).not.toThrow();
    expect(() => assertLocalEmbedUrl("https://generativelanguage.googleapis.com/v1beta/models")).toThrow(
      /ollama_endpoint_rejected/,
    );
    expect(() => assertLocalEmbedUrl("http://127.0.0.1:11434/api/embed")).toThrow(/ollama_endpoint_rejected/);
  });

  it("retries a 500 and does not retry a 404", async () => {
    expect(isRetryableOllamaFailure(new OllamaHttpError(503))).toBe(true);
    expect(isRetryableOllamaFailure(new OllamaHttpError(404))).toBe(false);
    expect(isRetryableOllamaFailure(new TypeError("fetch failed"))).toBe(true);
    let calls = 0;
    const sleeps: number[] = [];
    const vectors = await embedWithOllama({
      texts: ["probe"],
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
      fetchImpl: async () => {
        calls += 1;
        if (calls < 3) {
          return new Response("unavailable", { status: 503 });
        }
        return Response.json({ model: "embeddinggemma:latest", embeddings: [unitVector()] });
      },
    });
    expect(calls).toBe(3);
    expect(sleeps).toEqual([500, 1000]);
    expect(vectors[0]).toHaveLength(768);

    await expect(
      embedWithOllama({
        texts: ["probe"],
        fetchImpl: async () => new Response("missing", { status: 404 }),
      }),
    ).rejects.toThrow(/ollama_http:404/);
  });

  it("runs the probe through an injected response and does not read the database module", async () => {
    const source = readFileSync(new URL("./embeddinggemma-v1.ts", import.meta.url), "utf8");
    expect(source).not.toContain("EVAL_DATABASE_URL");
    expect(source).not.toContain("createSqlClient");
    const result = await runLocalProbe({
      fetchImpl: async () => Response.json({ model: "embeddinggemma", embeddings: [unitVector()] }),
    });
    expect(result).toMatchObject({ model: "embeddinggemma", dimensions: 768, finite: true, unitNorm: 1 });
    expect(result.rawNorm).toBe(2);
  });
});
