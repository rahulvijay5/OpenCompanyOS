import {
  LOCAL_EMBED_URL,
  LOCAL_MODEL,
  parseOllamaEmbeddings,
} from "./local-embedding.js";

export class OllamaHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`ollama_http:${status}`);
    this.name = "OllamaHttpError";
    this.status = status;
  }
}

export function assertLocalEmbedUrl(url: string): void {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "localhost" ||
    parsed.port !== "11434" ||
    parsed.pathname !== "/api/embed"
  ) {
    throw new Error("ollama_endpoint_rejected");
  }
}

export function isRetryableOllamaFailure(error: unknown): boolean {
  if (error instanceof OllamaHttpError) {
    return error.status >= 500;
  }
  if (error instanceof TypeError) {
    return true;
  }
  const message = error instanceof Error ? error.message : "";
  return /ECONNREFUSED|fetch failed|network|ollama_unreachable/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function embedWithOllama(input: {
  texts: readonly string[];
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  onRetry?: () => void;
  attempts?: number;
}): Promise<number[][]> {
  assertLocalEmbedUrl(LOCAL_EMBED_URL);
  if (input.texts.length === 0) {
    return [];
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const sleepImpl = input.sleepImpl ?? sleep;
  const attempts = input.attempts ?? 4;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      let response: Response;
      try {
        response = await fetchImpl(LOCAL_EMBED_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: LOCAL_MODEL, input: [...input.texts] }),
        });
      } catch (error) {
        throw error instanceof Error ? error : new Error("ollama_unreachable");
      }
      if (!response.ok) {
        throw new OllamaHttpError(response.status);
      }
      return parseOllamaEmbeddings(await response.json(), input.texts.length);
    } catch (error) {
      lastError = error;
      if (!isRetryableOllamaFailure(error) || attempt === attempts) {
        throw error;
      }
      input.onRetry?.();
      await sleepImpl(500 * 2 ** (attempt - 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("ollama_unreachable");
}
