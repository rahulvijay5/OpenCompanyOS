import { answerFromPackage } from "@opencompanyos/context";
import { buildContext } from "@opencompanyos/context";
import { reindexTenant } from "@opencompanyos/retrieval";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.js";
import { contextBodySchema, contextInput, rejectInvalidBody } from "./context.js";
import { llmConfigFromEnv, type Env } from "@opencompanyos/config";

export async function registerQueryRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  getEnv: () => Env | null,
): Promise<void> {
  app.post("/api/v1/query", async (request, reply) => {
    const parsed = contextBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return rejectInvalidBody(reply, parsed.error);
    }

    const env = getEnv();
    const built = await buildContext(
      ctx.db,
      contextInput(ctx.tenantId, parsed.data, env),
    );
    return answerFromPackage(ctx.db, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      query: parsed.data.query,
      package: built,
      config: env ? llmConfigFromEnv(env) : null,
    });
  });

  app.post("/api/v1/search/reindex", async () => {
    const env = getEnv();
    const processed = await reindexTenant(
      ctx.db,
      ctx.tenantId,
      env ? llmConfigFromEnv(env) : null,
    );
    return { processedEvents: processed };
  });
}
