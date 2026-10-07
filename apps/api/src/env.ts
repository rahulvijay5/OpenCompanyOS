import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, loadRuntimeEnv, type Env } from "@opencompanyos/config";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

loadDotenv({ path: path.join(rootDir, ".env") });

let cachedEnv: Env | null = null;

export function getRuntimeEnv() {
  return loadRuntimeEnv();
}

export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = loadEnv();
  }
  return cachedEnv;
}

export function tryGetEnv(): Env | null {
  try {
    return getEnv();
  } catch {
    return null;
  }
}
