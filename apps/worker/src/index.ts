import { config as loadDotenv } from "dotenv";
import { loadEnv } from "@opencompanyos/config";
import { createDb } from "@opencompanyos/db";
import {
  claimNextSyncJob,
  runRepositorySyncJob,
} from "@opencompanyos/sync";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
loadDotenv({ path: path.join(rootDir, ".env") });

const POLL_MS = 2_000;

async function main() {
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL);
  const credentials = {
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_PRIVATE_KEY,
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
  };

  console.log("[worker] polling for queued sync jobs");

  for (;;) {
    try {
      const jobId = await claimNextSyncJob(db);
      if (jobId) {
        console.log(`[worker] running sync job ${jobId}`);
        const result = await runRepositorySyncJob(db, credentials, jobId);
        console.log(
          `[worker] sync job ${jobId} ${result.status} (processed=${result.processedCount})`,
        );
      }
    } catch (error) {
      console.error("[worker] sync loop error", error);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error) => {
  console.error("[worker] fatal", error);
  process.exit(1);
});
