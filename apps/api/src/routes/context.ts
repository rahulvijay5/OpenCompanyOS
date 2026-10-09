import { llmConfigFromEnv, type Env } from "@opencompanyos/config";
import { buildContext } from "@opencompanyos/context";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app.js";

const bodySchema = z.object({
  query: z.string().min(1).max(2000),
  repositoryIds: z.array(z.string().uuid()).max(50).optional(),
  entityId: z.string().uuid().optional(),
  sourceId: z.string().min(1).max(500).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export function contextInput(
  tenantId: string,
  body: z.infer<typeof bodySchema>,
  env: Env | null,
) {
  return {
    tenantId,
    query: body.query,
    config: env ? llmConfigFromEnv(env) : null,
    ...(body.repositoryIds ? { repositoryIds: body.repositoryIds } : {}),
    ...(body.entityId ? { entityId: body.entityId } : {}),
    ...(body.sourceId ? { sourceId: body.sourceId } : {}),
    ...(body.from ? { from: new Date(body.from) } : {}),
    ...(body.to ? { to: new Date(body.to) } : {}),
  };
}

export async function registerContextRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  getEnv: () => Env | null,
): Promise<void> {
  app.post("/api/v1/context", async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    const context = await buildContext(
      ctx.db,
      contextInput(ctx.tenantId, parsed.data, getEnv()),
    );
    return context;
  });
}

export { bodySchema as contextBodySchema };
