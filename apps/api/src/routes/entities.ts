import {
  countEntitiesByType,
  getEntity,
  listEntities,
  listEntityRelationships,
  listEntityTimeline,
  projectStoredEvents,
} from "@opencompanyos/sync";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app.js";

export async function registerEntityRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get("/api/v1/entities", async (request, reply) => {
    const query = z
      .object({
        type: z.string().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .safeParse(request.query);

    if (!query.success) {
      return reply.code(400).send({ error: "invalid_query" });
    }

    const [entities, counts] = await Promise.all([
      listEntities(ctx.db, ctx.tenantId, {
        ...(query.data.type ? { type: query.data.type } : {}),
        limit: query.data.limit,
      }),
      countEntitiesByType(ctx.db, ctx.tenantId),
    ]);

    return { counts, entities };
  });

  app.get("/api/v1/entities/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid_params" });
    }

    const entity = await getEntity(ctx.db, ctx.tenantId, params.data.id);
    if (!entity) {
      return reply.code(404).send({ error: "entity_not_found" });
    }

    return {
      entity: {
        id: entity.id,
        type: entity.type,
        canonicalName: entity.canonicalName,
        description: entity.description,
        sourceSystem: entity.sourceSystem,
        sourceId: entity.sourceId,
        metadata: entity.metadata,
      },
    };
  });

  app.get("/api/v1/entities/:id/relationships", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid_params" });
    }

    const entity = await getEntity(ctx.db, ctx.tenantId, params.data.id);
    if (!entity) {
      return reply.code(404).send({ error: "entity_not_found" });
    }

    const rows = await listEntityRelationships(
      ctx.db,
      ctx.tenantId,
      params.data.id,
    );

    return {
      relationships: rows.map((row) => ({
        id: row.id,
        relationshipType: row.relationshipType,
        sourceEntityId: row.sourceEntityId,
        targetEntityId: row.targetEntityId,
        direction:
          row.sourceEntityId === params.data.id ? "outgoing" : "incoming",
        validFrom: row.validFrom,
        validTo: row.validTo,
        observedAt: row.observedAt,
      })),
    };
  });

  app.get("/api/v1/entities/:id/timeline", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const query = z
      .object({
        since: z.string().datetime({ offset: true }).optional(),
        until: z.string().datetime({ offset: true }).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.code(400).send({ error: "invalid_params" });
    }

    const entity = await getEntity(ctx.db, ctx.tenantId, params.data.id);
    if (!entity) {
      return reply.code(404).send({ error: "entity_not_found" });
    }

    const timeline = await listEntityTimeline(
      ctx.db,
      ctx.tenantId,
      params.data.id,
      {
        since: query.data.since ? new Date(query.data.since) : null,
        until: query.data.until ? new Date(query.data.until) : null,
        limit: query.data.limit,
      },
    );
    const metadata = entity.metadata ?? {};

    return {
      entity: {
        id: entity.id,
        type: entity.type,
        canonicalName: entity.canonicalName,
        state: typeof metadata.state === "string" ? metadata.state : null,
        title: entity.canonicalName,
      },
      events: timeline.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        sourceEventId: event.sourceEventId,
        eventTime: event.eventTime,
        recordKind: event.recordKind,
        title:
          typeof event.payload.title === "string"
            ? event.payload.title
            : typeof event.payload.message === "string"
              ? event.payload.message.split("\n")[0]
              : null,
        htmlUrl:
          typeof event.payload.htmlUrl === "string" ? event.payload.htmlUrl : null,
      })),
    };
  });

  app.post("/api/v1/entities/rebuild", async () => {
    const processed = await projectStoredEvents(ctx.db, ctx.tenantId);
    const counts = await countEntitiesByType(ctx.db, ctx.tenantId);
    return { processedEvents: processed, counts };
  });
}
