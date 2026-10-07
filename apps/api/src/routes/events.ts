import { listRecentEvents } from "@opencompanyos/sync";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app.js";

export async function registerEventRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get("/api/v1/events", async (request, reply) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
      })
      .safeParse(request.query);

    if (!query.success) {
      return reply.code(400).send({ error: "invalid_query" });
    }

    const events = await listRecentEvents(
      ctx.db,
      ctx.tenantId,
      query.data.limit,
    );

    return {
      events: events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        sourceEventId: event.sourceEventId,
        eventTime: event.eventTime,
        observedAt: event.observedAt,
        title:
          typeof event.payload.title === "string"
            ? event.payload.title
            : typeof event.payload.message === "string"
              ? event.payload.message
              : null,
        htmlUrl:
          typeof event.payload.htmlUrl === "string"
            ? event.payload.htmlUrl
            : null,
        fullName:
          typeof event.payload.fullName === "string"
            ? event.payload.fullName
            : null,
      })),
    };
  });
}
