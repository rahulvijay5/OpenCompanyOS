export type EvalDatabaseSource = "EVAL_DATABASE_URL" | "DATABASE_URL";

export type EvalDatabaseResolution =
  | { status: "ready"; url: string; source: EvalDatabaseSource }
  | { status: "skipped"; reason: string };

/**
 * Prefer an isolated evaluation database. `DATABASE_URL` is used only when
 * `EVAL_ALLOW_APP_DATABASE=1`. That opt-in can share the application database.
 */
export function resolveEvalDatabaseUrl(
  env: NodeJS.ProcessEnv,
): EvalDatabaseResolution {
  const evaluationUrl = env.EVAL_DATABASE_URL?.trim();
  if (evaluationUrl) {
    return {
      status: "ready",
      url: evaluationUrl,
      source: "EVAL_DATABASE_URL",
    };
  }

  if (env.EVAL_ALLOW_APP_DATABASE === "1" && env.DATABASE_URL?.trim()) {
    return {
      status: "ready",
      url: env.DATABASE_URL.trim(),
      source: "DATABASE_URL",
    };
  }

  if (env.DATABASE_URL?.trim()) {
    return {
      status: "skipped",
      reason:
        "DATABASE_URL is set, but the runner did not use it. Set EVAL_DATABASE_URL to an isolated database, or set EVAL_ALLOW_APP_DATABASE=1 to opt in. Opting in can read and write the application database.",
    };
  }

  return {
    status: "skipped",
    reason: "EVAL_DATABASE_URL is not set.",
  };
}
