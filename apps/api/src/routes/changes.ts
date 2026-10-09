import { CHANGE_KINDS, getChange, listChanges } from "@opencompanyos/retrieval";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app.js";

const windowSchema = z.object({
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  repositoryId: z.string().uuid().optional(),
  kind: z.enum(CHANGE_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function registerChangeRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get("/api/v1/changes", async (request, reply) => {
    const query = windowSchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: "invalid_query" });
    }

    const since = query.data.since
      ? new Date(query.data.since)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const changes = await listChanges(ctx.db, ctx.tenantId, {
      since,
      until: query.data.until ? new Date(query.data.until) : null,
      repositoryId: query.data.repositoryId ?? null,
      kind: query.data.kind ?? null,
      limit: query.data.limit,
    });

    return { changes };
  });

  app.get("/api/v1/changes/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid_params" });
    }

    const found = await getChange(ctx.db, ctx.tenantId, params.data.id);
    if (!found) {
      return reply.code(404).send({ error: "change_not_found" });
    }

    return found;
  });
}
