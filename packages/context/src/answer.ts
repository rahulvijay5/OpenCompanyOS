import type { LlmConfig } from "@opencompanyos/config";
import { evidence, queries, queryEvidence, type Database } from "@opencompanyos/db";
import { completeGroundedAnswer } from "@opencompanyos/retrieval";
import { eq } from "drizzle-orm";
import { selectCitedEvidence } from "./resolve.js";
import type { ContextAnswer, ContextEvidence, ContextPackage } from "./types.js";

type Completer = typeof completeGroundedAnswer;

export async function answerFromPackage(
  db: Database,
  input: {
    tenantId: string;
    userId: string;
    query: string;
    package: ContextPackage;
    config: LlmConfig | null;
    complete?: Completer;
  },
): Promise<ContextAnswer> {
  const started = Date.now();
  const [saved] = await db
    .insert(queries)
    .values({
      tenantId: input.tenantId,
      userId: input.userId,
      queryText: input.query,
    })
    .returning({ id: queries.id });
  if (!saved) {
    throw new Error("failed_to_store_query");
  }

  const uncertainties = [...input.package.uncertainties];
  let answer: string;
  let confidence: number;
  let cited: ContextEvidence[];
  let model: string | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  if (input.package.evidence.length === 0) {
    answer = "I don't have evidence in the selected repositories for that question.";
    confidence = 0;
    cited = [];
    if (!uncertainties.some((item) => item.code === "insufficient_evidence")) {
      uncertainties.push({
        code: "insufficient_evidence",
        message: "No indexed evidence was found inside the selected repositories.",
      });
    }
  } else if (!input.config) {
    answer = titlesAnswer(input.package.evidence);
    confidence = 0;
    cited = input.package.evidence;
    model = null;
    uncertainties.push({
      code: "model_unavailable",
      message: "No model is configured. The answer lists stored evidence titles only.",
    });
  } else {
    try {
      const complete = input.complete ?? completeGroundedAnswer;
      const completion = await complete(input.config, {
        question: input.query,
        evidence: input.package.evidence
          .map(
            (item) =>
              `id: ${item.id}\n${item.title ?? "untitled"}\n${item.snippet ?? ""}`,
          )
          .join("\n\n"),
      });
      answer = completion.answer || "The model returned an empty answer.";
      confidence = completion.confidence;
      cited = selectCitedEvidence(input.package.evidence, completion.evidenceIds);
      model = input.config.chatModel;
      inputTokens = completion.inputTokens;
      outputTokens = completion.outputTokens;
    } catch (error) {
      console.error("[context] answer generation failed", error);
      answer = titlesAnswer(input.package.evidence);
      confidence = 0;
      cited = input.package.evidence;
      uncertainties.push({
        code: "model_unavailable",
        message: "The model did not return an answer. Titles below are stored evidence, not model citations.",
      });
    }
  }

  await db
    .update(queries)
    .set({
      answerText: answer,
      model,
      latencyMs: Date.now() - started,
      inputTokens,
      outputTokens,
    })
    .where(eq(queries.id, saved.id));

  if (cited.length > 0) {
    const stored = [];
    for (const item of cited) {
      const [row] = await db
        .insert(evidence)
        .values({
          tenantId: input.tenantId,
          sourceSystem: "github",
          sourceType: "document",
          sourceId: item.sourceId,
          title: item.title,
          snippet: item.snippet,
          url: item.url,
        })
        .returning({ id: evidence.id });
      if (row) {
        stored.push(row.id);
      }
    }
    if (stored.length > 0) {
      await db.insert(queryEvidence).values(
        stored.map((evidenceId, rank) => ({
          queryId: saved.id,
          evidenceId,
          rank,
        })),
      );
    }
  }

  return {
    answer,
    confidence,
    evidence: cited,
    uncertainties,
    traceId: saved.id,
    latencyMs: Date.now() - started,
    inputTokens,
    outputTokens,
    context: { ...input.package, uncertainties },
  };
}

function titlesAnswer(items: ContextEvidence[]): string {
  const titles = items
    .map((item) => item.title)
    .filter((title): title is string => Boolean(title));
  if (titles.length === 0) {
    return "Matching activity was retrieved, but the model could not produce a grounded answer.";
  }
  return `The model is unavailable. Matching activity:\n\n${titles
    .map((title) => `- ${title}`)
    .join("\n")}`;
}
