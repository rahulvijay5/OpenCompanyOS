import type { LlmConfig } from "@opencompanyos/config";

type EmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
};

type ChatResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function embedTexts(
  config: LlmConfig,
  inputs: string[],
): Promise<number[][]> {
  if (inputs.length === 0) {
    return [];
  }

  const response = await fetch(endpoint(config.baseUrl, "/embeddings"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.embeddingModel,
      input: inputs,
      dimensions: config.embeddingDimensions,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`embedding_failed:${response.status}:${detail.slice(0, 200)}`);
  }

  const body = (await response.json()) as EmbeddingResponse;
  const vectors = (body.data ?? []).map((item) => item.embedding ?? []);
  if (vectors.length !== inputs.length) {
    throw new Error("embedding_count_mismatch");
  }
  for (const vector of vectors) {
    if (vector.length !== config.embeddingDimensions) {
      throw new Error(
        `embedding_dimension_mismatch: expected ${config.embeddingDimensions}, got ${vector.length}. Set EMBEDDING_DIMENSIONS to the model output size and migrate the vector column to match.`,
      );
    }
  }
  return vectors;
}

export async function completeGroundedAnswer(
  config: LlmConfig,
  input: { question: string; evidence: string },
): Promise<{
  answer: string;
  confidence: number;
  evidenceIds: string[];
  inputTokens: number | null;
  outputTokens: number | null;
}> {
  const messages = [
    {
      role: "system",
      content:
        'You answer questions about engineering activity using ONLY the evidence snippets. If the snippets do not support an answer, say so. Never invent people, dates, repositories, or URLs. Return JSON {"answer": string, "confidence": number from 0 to 1, "evidenceIds": string[]}. evidenceIds must be ids copied from the evidence list. A URL in the answer is not a citation.',
    },
    {
      role: "user",
      content: `Question:\n${input.question}\n\nEvidence:\n${input.evidence}`,
    },
  ];

  const body = await chatCompletion(config, messages);
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("chat_empty");
  }

  const parsed = parseAnswerJson(content);
  const answer = typeof parsed.answer === "string" ? parsed.answer : "";
  const confidence =
    typeof parsed.confidence === "number"
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0;
  const evidenceIds = Array.isArray(parsed.evidenceIds)
    ? parsed.evidenceIds.filter((id): id is string => typeof id === "string")
    : [];

  return {
    answer,
    confidence,
    evidenceIds,
    inputTokens: body.usage?.prompt_tokens ?? null,
    outputTokens: body.usage?.completion_tokens ?? null,
  };
}

async function chatCompletion(
  config: LlmConfig,
  messages: Array<{ role: string; content: string }>,
): Promise<ChatResponse> {
  const response = await postChat(config, messages, true);
  if (response.ok) {
    return (await response.json()) as ChatResponse;
  }

  const detail = await response.text();
  if (response.status === 400) {
    const retry = await postChat(config, messages, false);
    if (retry.ok) {
      return (await retry.json()) as ChatResponse;
    }
    const retryDetail = await retry.text();
    throw new Error(`chat_failed:${retry.status}:${retryDetail.slice(0, 200)}`);
  }

  throw new Error(`chat_failed:${response.status}:${detail.slice(0, 200)}`);
}

function postChat(
  config: LlmConfig,
  messages: Array<{ role: string; content: string }>,
  jsonMode: boolean,
): Promise<Response> {
  return fetch(endpoint(config.baseUrl, "/chat/completions"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.chatModel,
      temperature: 0,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages,
    }),
  });
}

function parseAnswerJson(content: string): {
  answer?: unknown;
  confidence?: unknown;
  evidenceIds?: unknown;
} {
  const fenced = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(fenced) as {
      answer?: unknown;
      confidence?: unknown;
      evidenceIds?: unknown;
    };
  } catch {
    const start = fenced.indexOf("{");
    const end = fenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(fenced.slice(start, end + 1)) as {
          answer?: unknown;
          confidence?: unknown;
          evidenceIds?: unknown;
        };
      } catch {
        // The model answered in prose. Keep that text.
      }
    }
    return { answer: fenced, confidence: 0.5, evidenceIds: [] };
  }
}
