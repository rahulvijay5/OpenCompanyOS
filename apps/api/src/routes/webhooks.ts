import type { Env } from "@opencompanyos/config";
import { webhookDeliveries } from "@opencompanyos/db";
import { verifyGithubWebhookSignature } from "@opencompanyos/github";
import { tenantForGithubInstallation } from "@opencompanyos/sync";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

async function resolveTenantId(
  ctx: AppContext,
  payload: Record<string, unknown>,
): Promise<string> {
  const resolved = await tenantForGithubInstallation(ctx.db, payload);
  return resolved ?? ctx.tenantId;
}

export async function registerWebhookRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  getEnv: () => Env | null,
): Promise<void> {
  await app.register(async (instance) => {
    instance.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_request, body, done) => {
        done(null, body);
      },
    );

    instance.post("/api/webhooks/github", async (request, reply) => {
      const env = getEnv();
      if (!env) {
        return reply.code(503).send({ error: "github_not_configured" });
      }

      const rawBody = request.body;
      if (!Buffer.isBuffer(rawBody)) {
        return reply.code(400).send({ error: "expected_raw_body" });
      }

      const signature = request.headers["x-hub-signature-256"];
      const signatureHeader = Array.isArray(signature)
        ? signature[0]
        : signature;

      if (
        !verifyGithubWebhookSignature(
          rawBody,
          signatureHeader,
          env.GITHUB_WEBHOOK_SECRET,
        )
      ) {
        return reply.code(401).send({ error: "invalid_signature" });
      }

      const deliveryHeader = request.headers["x-github-delivery"];
      const eventHeader = request.headers["x-github-event"];
      const githubDeliveryId = Array.isArray(deliveryHeader)
        ? deliveryHeader[0]
        : deliveryHeader;
      const eventName = Array.isArray(eventHeader)
        ? eventHeader[0]
        : eventHeader;

      if (!githubDeliveryId || !eventName) {
        return reply.code(400).send({ error: "missing_github_headers" });
      }

      let payload: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(rawBody.toString("utf8"));
        const record = asRecord(parsed);
        if (!record) {
          return reply.code(400).send({ error: "invalid_json_object" });
        }
        payload = record;
      } catch {
        return reply.code(400).send({ error: "invalid_json" });
      }

      let tenantId: string;
      try {
        tenantId = await resolveTenantId(ctx, payload);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "unknown_installation"
        ) {
          await ctx.db
            .insert(webhookDeliveries)
            .values({
              tenantId: null,
              githubDeliveryId,
              eventName,
              payload,
              receivedAt: new Date(),
              processedAt: new Date(),
              status: "failed",
              error: "unknown_installation",
            })
            .onConflictDoNothing({
              target: webhookDeliveries.githubDeliveryId,
            });
          return reply.code(202).send({
            status: "rejected",
            error: "unknown_installation",
            deliveryId: githubDeliveryId,
          });
        }
        throw error;
      }
      const receivedAt = new Date();

      const inserted = await ctx.db
        .insert(webhookDeliveries)
        .values({
          tenantId,
          githubDeliveryId,
          eventName,
          payload,
          receivedAt,
          status: "received",
        })
        .onConflictDoNothing({
          target: webhookDeliveries.githubDeliveryId,
        })
        .returning({ id: webhookDeliveries.id });

      if (inserted.length === 0) {
        return reply.code(202).send({
          status: "duplicate",
          deliveryId: githubDeliveryId,
        });
      }

      return reply.code(202).send({
        status: "accepted",
        deliveryId: githubDeliveryId,
        id: inserted[0]?.id,
      });
    });
  });
}
