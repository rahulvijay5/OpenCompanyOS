export type EvalDatabaseSource = "EVAL_DATABASE_URL";

export type EvalDatabaseResolution =
  | { status: "ready"; url: string; source: EvalDatabaseSource }
  | { status: "skipped"; reason: string };

/**
 * Destructive evaluation and integration tests open this URL only.
 * `DATABASE_URL` is the application database and is never used here.
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

  return {
    status: "skipped",
    reason:
      "EVAL_DATABASE_URL is not set. DATABASE_URL is not used for evaluation or destructive tests.",
  };
}
