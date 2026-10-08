import { llmConfigFromEnv, type Env } from "@opencompanyos/config";
import { answerQuery, reindexTenant } from "@opencompanyos/retrieval";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app.js";

function llmConfigFromEnvOrNull(env: Env | null) {
  return env ? llmConfigFromEnv(env) : null;
}

export async function registerQueryRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  getEnv: () => Env | null,
): Promise<void> {
  app.post("/api/v1/query", async (request, reply) => {
    const parsed = z
      .object({ query: z.string().min(1).max(2000) })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }

    const result = await answerQuery(ctx.db, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      query: parsed.data.query,
      config: llmConfigFromEnvOrNull(getEnv()),
    });

    return result;
  });

  app.post("/api/v1/search/reindex", async () => {
    const processed = await reindexTenant(
      ctx.db,
      ctx.tenantId,
      llmConfigFromEnvOrNull(getEnv()),
    );
    return { processedEvents: processed };
  });
}
