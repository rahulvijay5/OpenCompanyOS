import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  API_URL: z.string().url().default("http://localhost:4000"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_SLUG: z.string().min(1),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  GITHUB_PRIVATE_KEY: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type Env = z.infer<typeof envSchema>;

function normalizePrivateKey(value: string): string {
  let key = value.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\n/g, "\n").trim();

  const beginMatch = key.match(/-----BEGIN ([A-Z0-9 ]+)-----/);
  const endMatch = key.match(/-----END ([A-Z0-9 ]+)-----/);
  if (!beginMatch || !endMatch) {
    return key;
  }

  const label = beginMatch[1];
  const begin = `-----BEGIN ${label}-----`;
  const end = `-----END ${label}-----`;
  const body = key
    .replace(begin, "")
    .replace(end, "")
    .replace(/\s+/g, "");

  const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `${begin}\n${wrapped}\n${end}\n`;
}

export function loadEnv(
  source: NodeJS.ProcessEnv = process.env,
): Env {
  const parsed = envSchema.safeParse({
    ...source,
    GITHUB_PRIVATE_KEY: source.GITHUB_PRIVATE_KEY
      ? normalizePrivateKey(source.GITHUB_PRIVATE_KEY)
      : source.GITHUB_PRIVATE_KEY,
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return parsed.data;
}

/** Subset used by health checks before GitHub credentials are required. */
const runtimeEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  API_URL: z.string().url().default("http://localhost:4000"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type RuntimeEnv = z.infer<typeof runtimeEnvSchema>;

export function loadRuntimeEnv(
  source: NodeJS.ProcessEnv = process.env,
): RuntimeEnv {
  const parsed = runtimeEnvSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid runtime environment: ${details}`);
  }
  return parsed.data;
}
