import {
  githubInstallations,
  repositories,
  webhookDeliveries,
  type Database,
} from "@opencompanyos/db";
import { normalizeGithubWebhook } from "@opencompanyos/github";
import { and, eq } from "drizzle-orm";
import { upsertEvent } from "./events.js";

export type WebhookDeliveryView = {
  id: string;
  githubDeliveryId: string;
  eventName: string;
  status: string;
  error: string | null;
  processedAt: Date | null;
};

export async function claimNextWebhookDelivery(
  db: Database,
): Promise<string | null> {
  const delivery = await db.query.webhookDeliveries.findFirst({
    where: eq(webhookDeliveries.status, "received"),
    orderBy: (table, { asc }) => [asc(table.receivedAt)],
  });
  if (!delivery) {
    return null;
  }

  const updated = await db
    .update(webhookDeliveries)
    .set({ status: "processing", error: null })
    .where(
      and(
        eq(webhookDeliveries.id, delivery.id),
        eq(webhookDeliveries.status, "received"),
      ),
    )
    .returning({ id: webhookDeliveries.id });

  return updated[0]?.id ?? null;
}

export async function processWebhookDelivery(
  db: Database,
  deliveryId: string,
): Promise<WebhookDeliveryView> {
  const delivery = await db.query.webhookDeliveries.findFirst({
    where: eq(webhookDeliveries.id, deliveryId),
  });
  if (!delivery) {
    throw new Error("webhook_delivery_not_found");
  }

  try {
    const normalized = normalizeGithubWebhook(
      delivery.eventName,
      delivery.payload,
    );

    if (normalized === null) {
      const processedAt = new Date();
      const [ignored] = await db
        .update(webhookDeliveries)
        .set({ status: "ignored", processedAt, error: null })
        .where(eq(webhookDeliveries.id, deliveryId))
        .returning();
      if (!ignored) {
        throw new Error("failed_to_mark_ignored");
      }
      return {
        id: ignored.id,
        githubDeliveryId: ignored.githubDeliveryId,
        eventName: ignored.eventName,
        status: ignored.status,
        error: ignored.error,
        processedAt: ignored.processedAt,
      };
    }

    const tenantId =
      delivery.tenantId ??
      (await tenantForGithubInstallation(db, delivery.payload));

    if (!tenantId) {
      throw new Error("tenant_not_resolved");
    }

    for (const event of normalized) {
      if (!event.installationScoped) {
        if (event.githubRepositoryId == null) {
          continue;
        }
        const repo = await db.query.repositories.findFirst({
          where: and(
            eq(repositories.tenantId, tenantId),
            eq(repositories.githubRepositoryId, event.githubRepositoryId),
            eq(repositories.selected, true),
          ),
        });
        if (!repo) {
          continue;
        }

        await upsertEvent(db, {
          tenantId,
          sourceEventId: event.sourceEventId,
          eventType: event.eventType,
          eventTime: event.eventTime,
          recordKind: event.recordKind,
          payload: {
            ...event.payload,
            repositoryId: repo.id,
            fullName: repo.fullName,
            githubDeliveryId: delivery.githubDeliveryId,
          },
        });
      } else {
        await upsertEvent(db, {
          tenantId,
          sourceEventId: event.sourceEventId,
          eventType: event.eventType,
          eventTime: event.eventTime,
          recordKind: event.recordKind,
          payload: {
            ...event.payload,
            githubDeliveryId: delivery.githubDeliveryId,
          },
        });
      }
    }

    const processedAt = new Date();
    const [done] = await db
      .update(webhookDeliveries)
      .set({
        status: "processed",
        processedAt,
        error: null,
        tenantId,
      })
      .where(eq(webhookDeliveries.id, deliveryId))
      .returning();

    if (!done) {
      throw new Error("failed_to_finalize_webhook_delivery");
    }

    return {
      id: done.id,
      githubDeliveryId: done.githubDeliveryId,
      eventName: done.eventName,
      status: done.status,
      error: done.error,
      processedAt: done.processedAt,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "webhook_process_failed";
    const processedAt = new Date();
    await db
      .update(webhookDeliveries)
      .set({ status: "failed", error: message, processedAt })
      .where(eq(webhookDeliveries.id, deliveryId));
    throw error;
  }
}

export async function tenantForGithubInstallation(
  db: Database,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const installation = payload.installation;
  if (
    installation &&
    typeof installation === "object" &&
    !Array.isArray(installation) &&
    typeof (installation as { id?: unknown }).id === "number"
  ) {
    const githubInstallationId = (installation as { id: number }).id;
    const row = await db.query.githubInstallations.findFirst({
      where: eq(
        githubInstallations.githubInstallationId,
        githubInstallationId,
      ),
    });
    if (!row) {
      throw new Error("unknown_installation");
    }
    return row.tenantId;
  }
  return null;
}
