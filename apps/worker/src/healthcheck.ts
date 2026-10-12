import { loadRuntimeEnv } from "@opencompanyos/config";
import { createSqlClient } from "@opencompanyos/db";

const env = loadRuntimeEnv();
const sql = createSqlClient(env.DATABASE_URL);

try {
  await sql`select 1 as ready`;
  await sql`select 1 from sync_jobs limit 1`;
} catch (error) {
  console.error("[worker] database or sync queue is unavailable", error);
  process.exit(1);
} finally {
  await sql.end();
}
