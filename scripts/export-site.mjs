import { spawn } from "node:child_process";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "apps/web/src/app");
const hold = path.join(root, "apps/web/.static-park");
const parkedRoutes = ["app", "integrations"];

async function parkRoutes() {
  await mkdir(hold, { recursive: true });
  for (const name of parkedRoutes) {
    await rename(path.join(appDir, name), path.join(hold, name));
  }
}

async function restoreRoutes() {
  for (const name of parkedRoutes) {
    await rename(path.join(hold, name), path.join(appDir, name)).catch(() => {});
  }
  await rm(hold, { recursive: true, force: true });
}

function buildStaticSite() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["--filter", "@opencompanyos/web", "exec", "next", "build"],
      {
        cwd: root,
        stdio: "inherit",
        env: { ...process.env, STATIC_SITE: "1" },
      },
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Static site build exited with code ${code ?? "unknown"}.`));
    });
  });
}

try {
  await parkRoutes();
  await buildStaticSite();
} finally {
  await restoreRoutes();
}
