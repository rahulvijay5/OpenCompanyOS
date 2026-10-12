import { l2Norm, LOCAL_MODEL, LOCAL_PROBE_TEXT, normalizeForStorage } from "./local-embedding.js";
import { embedWithOllama } from "./local-embedding-ollama.js";

export async function runLocalProbe(options?: {
  fetchImpl?: typeof fetch;
}): Promise<{
  model: string;
  dimensions: number;
  finite: boolean;
  rawNorm: number;
  unitNorm: number;
}> {
  const embedOptions = {
    texts: [LOCAL_PROBE_TEXT] as const,
    ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  };
  const [vector] = await embedWithOllama(embedOptions);
  if (!vector) {
    throw new Error("probe_empty");
  }
  const rawNorm = l2Norm(vector);
  const unit = normalizeForStorage(vector);
  return {
    model: LOCAL_MODEL,
    dimensions: vector.length,
    finite: true,
    rawNorm,
    unitNorm: l2Norm(unit),
  };
}

const isEntry = process.argv[1]?.endsWith("embeddinggemma-v1.ts") === true;
if (isEntry) {
  const command = process.argv[2];
  if (command === "probe") {
    const result = await runLocalProbe();
    console.log(JSON.stringify(result));
  } else if (command === "generate") {
    const { runLocalEmbeddingGenerate } = await import("./embeddinggemma-generate.js");
    await runLocalEmbeddingGenerate();
  } else {
    throw new Error("usage: embeddinggemma-v1.ts probe|generate");
  }
}
