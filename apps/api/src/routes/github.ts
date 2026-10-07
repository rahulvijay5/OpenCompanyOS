import type { Env } from "@opencompanyos/config";
import {
  githubInstallations,
  repositories,
} from "@opencompanyos/db";
import {
  buildInstallUrl,
  getInstallation,
  listInstallationRepositories,
  type GitHubAppCredentials,
} from "@opencompanyos/github";
import {
  enqueueRepositorySync,
  getSyncJob,
} from "@opencompanyos/sync";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app.js";

function credentialsFromEnv(env: Env): GitHubAppCredentials {
  return {
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_PRIVATE_KEY,
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
  };
}

const setupQuerySchema = z.object({
  installation_id: z.coerce.number().int().positive(),
  setup_action: z.string().optional(),
});

const selectBodySchema = z.object({
  installationId: z.string().uuid(),
  githubRepositoryIds: z.array(z.number().int().positive()).min(1),
});

const syncBodySchema = z.object({
  installationId: z.string().uuid(),
  repositoryId: z.string().uuid(),
});

export async function registerGithubRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  getEnv: () => Env | null,
): Promise<void> {
  app.get("/api/v1/integrations/github/install", async (_request, reply) => {
    const env = getEnv();
    if (!env) {
      return reply.code(503).send({
        error: "github_not_configured",
        message:
          "GitHub App environment variables are missing. Copy .env.example to .env and fill in credentials.",
      });
    }

    const url = buildInstallUrl(env.GITHUB_APP_SLUG);
    return reply.redirect(url);
  });

  app.get("/api/v1/integrations/github/setup", async (request, reply) => {
    const env = getEnv();
    if (!env) {
      return reply.code(503).send({ error: "github_not_configured" });
    }

    const parsed = setupQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_query",
        details: parsed.error.flatten(),
      });
    }

    const installation = await getInstallation(
      credentialsFromEnv(env),
      parsed.data.installation_id,
    );

    const now = new Date();
    const [saved] = await ctx.db
      .insert(githubInstallations)
      .values({
        tenantId: ctx.tenantId,
        githubInstallationId: installation.id,
        githubAccountId: installation.account.id,
        githubAccountLogin: installation.account.login,
        githubAccountType: installation.account.type,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: githubInstallations.githubInstallationId,
        set: {
          githubAccountId: installation.account.id,
          githubAccountLogin: installation.account.login,
          githubAccountType: installation.account.type,
          status: "active",
          updatedAt: now,
          tenantId: ctx.tenantId,
        },
      })
      .returning();

    if (!saved) {
      return reply.code(500).send({ error: "failed_to_persist_installation" });
    }

    const remoteRepos = await listInstallationRepositories(
      credentialsFromEnv(env),
      installation.id,
    );

    for (const repo of remoteRepos) {
      await ctx.db
        .insert(repositories)
        .values({
          tenantId: ctx.tenantId,
          githubInstallationId: saved.id,
          githubRepositoryId: repo.githubRepositoryId,
          ownerLogin: repo.ownerLogin,
          name: repo.name,
          fullName: repo.fullName,
          defaultBranch: repo.defaultBranch,
          visibility: repo.visibility,
          htmlUrl: repo.htmlUrl,
          selected: false,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            repositories.githubInstallationId,
            repositories.githubRepositoryId,
          ],
          set: {
            ownerLogin: repo.ownerLogin,
            name: repo.name,
            fullName: repo.fullName,
            defaultBranch: repo.defaultBranch,
            visibility: repo.visibility,
            htmlUrl: repo.htmlUrl,
            updatedAt: now,
          },
        });
    }

    return {
      installation: {
        id: saved.id,
        githubInstallationId: saved.githubInstallationId,
        accountLogin: saved.githubAccountLogin,
        accountType: saved.githubAccountType,
        status: saved.status,
        setupAction: parsed.data.setup_action ?? null,
      },
      repositoryCount: remoteRepos.length,
    };
  });

  app.get("/api/v1/integrations/github/repositories", async (request, reply) => {
    const query = z
      .object({
        installationId: z.string().uuid().optional(),
      })
      .safeParse(request.query);

    if (!query.success) {
      return reply.code(400).send({ error: "invalid_query" });
    }

    let installationId = query.data.installationId;
    if (!installationId) {
      const latest = await ctx.db.query.githubInstallations.findFirst({
        where: eq(githubInstallations.tenantId, ctx.tenantId),
        orderBy: (table, { desc }) => [desc(table.createdAt)],
      });
      if (!latest) {
        return { installation: null, repositories: [] };
      }
      installationId = latest.id;
    }

    const installation = await ctx.db.query.githubInstallations.findFirst({
      where: and(
        eq(githubInstallations.id, installationId),
        eq(githubInstallations.tenantId, ctx.tenantId),
      ),
    });

    if (!installation) {
      return reply.code(404).send({ error: "installation_not_found" });
    }

    const repos = await ctx.db.query.repositories.findMany({
      where: eq(repositories.githubInstallationId, installation.id),
      orderBy: (table, { asc }) => [asc(table.fullName)],
    });

    return {
      installation: {
        id: installation.id,
        githubInstallationId: installation.githubInstallationId,
        accountLogin: installation.githubAccountLogin,
        accountType: installation.githubAccountType,
        status: installation.status,
      },
      repositories: repos.map((repo) => ({
        id: repo.id,
        githubRepositoryId: repo.githubRepositoryId,
        fullName: repo.fullName,
        ownerLogin: repo.ownerLogin,
        name: repo.name,
        defaultBranch: repo.defaultBranch,
        visibility: repo.visibility,
        htmlUrl: repo.htmlUrl,
        selected: repo.selected,
      })),
    };
  });

  app.post(
    "/api/v1/integrations/github/repositories/select",
    async (request, reply) => {
      const parsed = selectBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_body",
          details: parsed.error.flatten(),
        });
      }

      const installation = await ctx.db.query.githubInstallations.findFirst({
        where: and(
          eq(githubInstallations.id, parsed.data.installationId),
          eq(githubInstallations.tenantId, ctx.tenantId),
        ),
      });

      if (!installation) {
        return reply.code(404).send({ error: "installation_not_found" });
      }

      const now = new Date();

      await ctx.db
        .update(repositories)
        .set({ selected: false, updatedAt: now })
        .where(eq(repositories.githubInstallationId, installation.id));

      await ctx.db
        .update(repositories)
        .set({ selected: true, updatedAt: now })
        .where(
          and(
            eq(repositories.githubInstallationId, installation.id),
            inArray(
              repositories.githubRepositoryId,
              parsed.data.githubRepositoryIds,
            ),
          ),
        );

      const selected = await ctx.db.query.repositories.findMany({
        where: and(
          eq(repositories.githubInstallationId, installation.id),
          eq(repositories.selected, true),
        ),
        orderBy: (table, { asc }) => [asc(table.fullName)],
      });

      return {
        installationId: installation.id,
        selectedRepositories: selected.map((repo) => ({
          id: repo.id,
          githubRepositoryId: repo.githubRepositoryId,
          fullName: repo.fullName,
          selected: repo.selected,
        })),
      };
    },
  );

  app.post("/api/v1/integrations/github/sync", async (request, reply) => {
    const env = getEnv();
    if (!env) {
      return reply.code(503).send({ error: "github_not_configured" });
    }

    const parsed = syncBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        details: parsed.error.flatten(),
      });
    }

    try {
      const job = await enqueueRepositorySync(ctx.db, {
        tenantId: ctx.tenantId,
        installationId: parsed.data.installationId,
        repositoryId: parsed.data.repositoryId,
      });
      return reply.code(202).send({ job });
    } catch (error) {
      const message = error instanceof Error ? error.message : "sync_enqueue_failed";
      if (
        message === "installation_not_found" ||
        message === "repository_not_found_or_not_selected"
      ) {
        return reply.code(404).send({ error: message });
      }
      throw error;
    }
  });

  app.get("/api/v1/integrations/github/sync/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid_params" });
    }

    const job = await getSyncJob(ctx.db, ctx.tenantId, params.data.id);
    if (!job) {
      return reply.code(404).send({ error: "sync_job_not_found" });
    }
    return { job };
  });
}
