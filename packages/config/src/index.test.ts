import { describe, expect, it } from "vitest";
import { loadEnv, loadRuntimeEnv } from "./index.js";

const validGithubEnv = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/opencompanyos",
  APP_URL: "http://localhost:3000",
  API_URL: "http://localhost:4000",
  API_PORT: "4000",
  GITHUB_APP_ID: "12345",
  GITHUB_APP_SLUG: "opencompanyos-local",
  GITHUB_CLIENT_ID: "Iv1.abc",
  GITHUB_CLIENT_SECRET: "secret",
  GITHUB_PRIVATE_KEY:
    "-----BEGIN RSA PRIVATE KEY-----\\nABC\\n-----END RSA PRIVATE KEY-----",
  GITHUB_WEBHOOK_SECRET: "whsec",
  LOG_LEVEL: "debug",
} as const;

describe("loadRuntimeEnv", () => {
  it("loads required runtime fields", () => {
    const env = loadRuntimeEnv({
      DATABASE_URL: validGithubEnv.DATABASE_URL,
    });
    expect(env.DATABASE_URL).toBe(validGithubEnv.DATABASE_URL);
    expect(env.API_PORT).toBe(4000);
  });

  it("rejects missing DATABASE_URL", () => {
    expect(() => loadRuntimeEnv({})).toThrow(/DATABASE_URL/);
  });
});

describe("loadEnv", () => {
  it("normalizes escaped newlines in GITHUB_PRIVATE_KEY", () => {
    const env = loadEnv({ ...validGithubEnv });
    expect(env.GITHUB_PRIVATE_KEY).toContain("\n");
    expect(env.GITHUB_PRIVATE_KEY).not.toContain("\\n");
    expect(env.GITHUB_PRIVATE_KEY.startsWith("-----BEGIN RSA PRIVATE KEY-----")).toBe(
      true,
    );
  });

  it("repairs a PEM pasted without newlines", () => {
    const env = loadEnv({
      ...validGithubEnv,
      GITHUB_PRIVATE_KEY:
        "-----BEGIN RSA PRIVATE KEY-----ABCDEFGHIJKLMNOP-----END RSA PRIVATE KEY-----",
    });
    expect(env.GITHUB_PRIVATE_KEY).toContain(
      "-----BEGIN RSA PRIVATE KEY-----\nABCDEFGHIJKLMNOP\n-----END RSA PRIVATE KEY-----",
    );
  });

  it("rejects missing GitHub credentials", () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: validGithubEnv.DATABASE_URL,
      }),
    ).toThrow(/GITHUB_/);
  });
});
