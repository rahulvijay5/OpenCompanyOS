import { llmConfigFromEnv, type Env } from "@opencompanyos/config";
import { EVIDENCE_KINDS, buildContext } from "@opencompanyos/context";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app.js";

const bodySchema = z.object({
  query: z
    .string()
    .max(2000)
    .refine((value) => value.trim().length > 0, {
      message: "Enter a question before asking.",
    }),
  repositoryIds: z.array(z.string().uuid()).max(50).optional(),
  entityId: z.string().uuid().optional(),
  sourceId: z.string().min(1).max(500).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  evidenceKind: z.enum(EVIDENCE_KINDS).optional(),
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
    ...(body.evidenceKind ? { evidenceKind: body.evidenceKind } : {}),
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
      return rejectInvalidBody(reply, parsed.error);
    }
    const context = await buildContext(
      ctx.db,
      contextInput(ctx.tenantId, parsed.data, getEnv()),
    );
    return context;
  });
}

export function rejectInvalidBody(reply: FastifyReply, error: z.ZodError) {
  const queryInvalid = error.issues.some((issue) => issue.path[0] === "query");
  return reply.code(400).send({
    error: "invalid_body",
    ...(queryInvalid ? { message: "Enter a question before asking." } : {}),
  });
}

export { bodySchema as contextBodySchema };
