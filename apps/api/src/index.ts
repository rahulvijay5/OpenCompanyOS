import { buildApp } from "./app.js";
import { getRuntimeEnv } from "./env.js";

const runtime = getRuntimeEnv();
const app = await buildApp();

try {
  await app.listen({ port: runtime.API_PORT, host: "0.0.0.0" });
  app.log.info(`API listening on ${runtime.API_PORT}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
