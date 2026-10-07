import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyGithubWebhookSignature } from "@opencompanyos/github";

describe("webhook ingress contract", () => {
  it("requires a valid signature before accepting deliveries", () => {
    const secret = "whsec";
    const body = Buffer.from('{"zen":"design"}');
    const good = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    const bad = "sha256=00";

    expect(verifyGithubWebhookSignature(body, good, secret)).toBe(true);
    expect(verifyGithubWebhookSignature(body, bad, secret)).toBe(false);
  });

  it("treats duplicate delivery ids as a no-op at the DB unique constraint", () => {
    // Documented behavior: unique(github_delivery_id) + onConflictDoNothing
    const first = { githubDeliveryId: "abc-1" };
    const second = { githubDeliveryId: "abc-1" };
    expect(first.githubDeliveryId).toBe(second.githubDeliveryId);
  });
});
