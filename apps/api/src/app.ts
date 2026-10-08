import cors from "@fastify/cors";
import {
  createDb,
  ensureLocalTenant,
  type Database,
} from "@opencompanyos/db";
import Fastify, { type FastifyInstance } from "fastify";
import { getRuntimeEnv, tryGetEnv } from "./env.js";
import { registerEntityRoutes } from "./routes/entities.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerGithubRoutes } from "./routes/github.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerQueryRoutes } from "./routes/query.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";

export type AppContext = {
  db: Database;
  tenantId: string;
  userId: string;
};

export async function buildApp(): Promise<FastifyInstance> {
  const runtime = getRuntimeEnv();
  const app = Fastify({
    logger: {
      level: runtime.LOG_LEVEL,
    },
  });

  await app.register(cors, {
    origin: runtime.APP_URL,
  });

  const db = createDb(runtime.DATABASE_URL);
  const bootstrap = await ensureLocalTenant(db);
  const ctx: AppContext = {
    db,
    tenantId: bootstrap.tenantId,
    userId: bootstrap.userId,
  };

  await registerHealthRoutes(app, ctx);
  await registerGithubRoutes(app, ctx, () => tryGetEnv());
  await registerEventRoutes(app, ctx);
  await registerEntityRoutes(app, ctx);
  await registerQueryRoutes(app, ctx, () => tryGetEnv());
  await registerWebhookRoutes(app, ctx, () => tryGetEnv());

  return app;
}
