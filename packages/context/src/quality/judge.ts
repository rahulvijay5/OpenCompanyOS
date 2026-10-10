import { createHash } from "node:crypto";
import type { CaseResult, CountSummary } from "./report.js";
import { summarize } from "./dataset.js";

export const JUDGE_PROMPT_VERSION = "judge-v1";

export type JudgeVerdict = {
  verdict: "supported" | "unsupported" | "inconclusive";
  detail: string;
};

export type JudgeCaseInput = {
  id: string;
  question: string;
  factSummary: string;
  packageJson: string;
};

export type JudgeRun = {
  status: "not_run" | "completed" | "skipped";
  llmCalls: number;
  cacheHits: number;
  promptVersion: string;
} & CountSummary & { cases: CaseResult[] };

export function judgeCacheKey(input: JudgeCaseInput, promptVersion = JUDGE_PROMPT_VERSION): string {
  return createHash("sha256")
    .update(`${promptVersion}\n${input.id}\n${input.packageJson}\n${input.factSummary}`)
    .digest("hex");
}

/**
 * Semantic judging is separate from fixture assertions. Cache hits do not spend budget.
 * This function never writes ground-truth files.
 */
export async function judgeCases(input: {
  cases: readonly JudgeCaseInput[];
  budget: number;
  cache: Map<string, JudgeVerdict>;
  complete: (prompt: string) => Promise<JudgeVerdict>;
  promptVersion?: string;
}): Promise<JudgeRun> {
  const promptVersion = input.promptVersion ?? JUDGE_PROMPT_VERSION;
  const cases: CaseResult[] = [];
  let llmCalls = 0;
  let cacheHits = 0;

  for (const item of input.cases) {
    const key = judgeCacheKey(item, promptVersion);
    const cached = input.cache.get(key);
    if (cached) {
      cacheHits += 1;
      cases.push(verdictCase(item.id, cached));
      continue;
    }
    if (llmCalls >= input.budget) {
      cases.push({
        id: item.id,
        status: "skipped",
        reasons: ["LLM request budget exhausted"],
      });
      continue;
    }
    llmCalls += 1;
    try {
      const verdict = await input.complete(judgePrompt(item, promptVersion));
      input.cache.set(key, verdict);
      cases.push(verdictCase(item.id, verdict));
    } catch (error) {
      cases.push({
        id: item.id,
        status: "failed",
        reasons: [error instanceof Error ? error.message : "judge failed"],
      });
    }
  }

  return {
    status: "completed",
    llmCalls,
    cacheHits,
    promptVersion,
    ...summarize(cases),
    cases,
  };
}

export function judgePrompt(item: JudgeCaseInput, promptVersion: string): string {
  return [
    `promptVersion: ${promptVersion}`,
    "Judge only whether the package supports the verified fact summary.",
    "Do not invent history, review coverage, or causal conclusions.",
    `Question: ${item.question}`,
    `Facts: ${item.factSummary}`,
    `Package: ${item.packageJson}`,
  ].join("\n");
}

function verdictCase(id: string, verdict: JudgeVerdict): CaseResult {
  if (verdict.verdict === "supported") {
    return { id, status: "passed", reasons: [] };
  }
  if (verdict.verdict === "unsupported") {
    return { id, status: "failed", reasons: [verdict.detail] };
  }
  return { id, status: "inconclusive", reasons: [verdict.detail] };
}
