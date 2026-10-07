import { config as loadDotenv } from "dotenv";
import { loadEnv } from "@opencompanyos/config";
import { createDb } from "@opencompanyos/db";
import {
  claimNextSyncJob,
  claimNextWebhookDelivery,
  processWebhookDelivery,
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

  console.log("[worker] polling for sync jobs and webhook deliveries");

  for (;;) {
    try {
      const deliveryId = await claimNextWebhookDelivery(db);
      if (deliveryId) {
        console.log(`[worker] processing webhook delivery ${deliveryId}`);
        const result = await processWebhookDelivery(db, deliveryId);
        console.log(
          `[worker] webhook ${result.githubDeliveryId} ${result.status} (${result.eventName})`,
        );
      }

      const jobId = await claimNextSyncJob(db);
      if (jobId) {
        console.log(`[worker] running sync job ${jobId}`);
        const result = await runRepositorySyncJob(db, credentials, jobId);
        console.log(
          `[worker] sync job ${jobId} ${result.status} (processed=${result.processedCount})`,
        );
      }
    } catch (error) {
      console.error("[worker] loop error", error);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error) => {
  console.error("[worker] fatal", error);
  process.exit(1);
});
