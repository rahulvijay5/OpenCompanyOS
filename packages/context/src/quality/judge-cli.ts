import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { llmConfigFromEnv, loadEnv } from "@opencompanyos/config";
import { completeGroundedAnswer } from "@opencompanyos/retrieval";
import { repoRoot } from "./dataset.js";
import { judgeCases, type JudgeVerdict } from "./judge.js";
import { runContextQualityEvaluation } from "./run.js";

const budget = Number(process.env.EVAL_LLM_BUDGET ?? "0");
const enabled = process.env.EVAL_LLM === "1" && Number.isFinite(budget) && budget > 0;
const directory = path.join(repoRoot(), "eval/context-quality");
const cacheFile = path.join(directory, "cache/judge.json");
const reportFile = path.join(directory, "reports/judge.json");

if (!enabled) {
  await writeJudgeReport({
    status: "not_run",
    llmCalls: 0,
    cacheHits: 0,
    reason:
      "Set EVAL_LLM=1 and EVAL_LLM_BUDGET to a positive integer to run semantic judging. This command did not call a model.",
    cases: [],
  });
  console.log(JSON.stringify({ file: reportFile, status: "not_run", llmCalls: 0 }));
  process.exit(0);
}

const evaluation = await runContextQualityEvaluation();
if (evaluation.report.database.status !== "passed" || evaluation.packages.length === 0) {
  await writeJudgeReport({
    status: "skipped",
    llmCalls: 0,
    cacheHits: 0,
    reason: evaluation.report.database.reason ?? "Context packages were not available.",
    cases: [],
  });
  console.log(JSON.stringify({ file: reportFile, status: "skipped", llmCalls: 0 }));
  process.exit(0);
}

let config: ReturnType<typeof llmConfigFromEnv> = null;
try {
  config = llmConfigFromEnv(loadEnv());
} catch (error) {
  await writeJudgeReport({
    status: "skipped",
    llmCalls: 0,
    cacheHits: 0,
    reason: error instanceof Error ? error.message : "LLM config is unavailable.",
    cases: [],
  });
  console.log(JSON.stringify({ file: reportFile, status: "skipped", llmCalls: 0 }));
  process.exit(0);
}

if (!config) {
  await writeJudgeReport({
    status: "skipped",
    llmCalls: 0,
    cacheHits: 0,
    reason: "LITELLM_BASE_URL is not set. No model call was made.",
    cases: [],
  });
  console.log(JSON.stringify({ file: reportFile, status: "skipped", llmCalls: 0 }));
  process.exit(0);
}

const llm = config;
const cache = await readCache(cacheFile);
const judged = await judgeCases({
  budget,
  cache,
  cases: evaluation.packages.map((item) => ({
    id: item.questionId,
    question: item.questionId,
    factSummary: "Verified fixture facts for this question. Do not add facts.",
    packageJson: JSON.stringify(item.package),
  })),
  complete: async (prompt) => {
    const completion = await completeGroundedAnswer(llm, {
      question: prompt,
      evidence: prompt,
    });
    return interpretJudgeAnswer(completion.answer);
  },
});
await writeCache(cacheFile, cache);
await writeJudgeReport({
  status: judged.status,
  llmCalls: judged.llmCalls,
  cacheHits: judged.cacheHits,
  reason: null,
  cases: judged.cases,
});
console.log(
  JSON.stringify({
    file: reportFile,
    status: judged.status,
    llmCalls: judged.llmCalls,
    cacheHits: judged.cacheHits,
  }),
);
process.exit(judged.failed > 0 ? 1 : 0);

function interpretJudgeAnswer(answer: string): JudgeVerdict {
  const text = answer.toLowerCase();
  const detail = answer.slice(0, 500);
  if (text.includes("unsupported")) {
    return { verdict: "unsupported", detail };
  }
  if (/\bsupported\b/.test(text)) {
    return { verdict: "supported", detail };
  }
  return {
    verdict: "inconclusive",
    detail: detail || "The model response did not state whether the facts were supported.",
  };
}

async function readCache(file: string): Promise<Map<string, JudgeVerdict>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return new Map();
    }
    return new Map(Object.entries(parsed as Record<string, JudgeVerdict>));
  } catch {
    return new Map();
  }
}

async function writeCache(file: string, cache: Map<string, JudgeVerdict>): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(Object.fromEntries(cache), null, 2)}\n`);
}

async function writeJudgeReport(report: {
  status: string;
  llmCalls: number;
  cacheHits: number;
  reason: string | null;
  cases: unknown[];
}): Promise<void> {
  await mkdir(path.dirname(reportFile), { recursive: true });
  await writeFile(
    reportFile,
    `${JSON.stringify(
      {
        suite: "context-quality-judge",
        ...report,
        notes: [
          "Semantic judgments are not fixture assertions and are not combined with the deterministic score.",
          "This report does not change ground-truth facts.",
        ],
      },
      null,
      2,
    )}\n`,
  );
}
