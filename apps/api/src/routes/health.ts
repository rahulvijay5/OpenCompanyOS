import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.js";

export async function registerHealthRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get("/health", async () => ({
    status: "ok",
  }));

  app.get("/ready", async (_request, reply) => {
    try {
      await ctx.db.execute(sql`select 1`);
      return { status: "ready" };
    } catch (error) {
      app.log.error(error, "readiness check failed");
      return reply.code(503).send({
        status: "not_ready",
        reason: "database_unavailable",
      });
    }
  });
}
