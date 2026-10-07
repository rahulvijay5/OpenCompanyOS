import {
  events,
  githubInstallations,
  repositories,
  syncJobs,
  type Database,
} from "@opencompanyos/db";
import {
  fetchRepositoryCommits,
  fetchRepositoryIssues,
  fetchRepositoryPullRequests,
  type GitHubAppCredentials,
} from "@opencompanyos/github";
import { and, eq } from "drizzle-orm";

export type SyncJobView = {
  id: string;
  status: string;
  objectType: string | null;
  processedCount: number;
  error: string | null;
  repositoryId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
};

async function upsertEvent(
  db: Database,
  input: {
    tenantId: string;
    sourceEventId: string;
    eventType: string;
    eventTime: Date | null;
    payload: Record<string, unknown>;
  },
): Promise<boolean> {
  const observedAt = new Date();
  const inserted = await db
    .insert(events)
    .values({
      tenantId: input.tenantId,
      sourceSystem: "github",
      sourceEventId: input.sourceEventId,
      eventType: input.eventType,
      eventTime: input.eventTime,
      observedAt,
      payload: input.payload,
      createdAt: observedAt,
    })
    .onConflictDoUpdate({
      target: [events.tenantId, events.sourceSystem, events.sourceEventId],
      set: {
        eventType: input.eventType,
        eventTime: input.eventTime,
        observedAt,
        payload: input.payload,
      },
    })
    .returning({ id: events.id });

  return inserted.length > 0;
}

export async function enqueueRepositorySync(
  db: Database,
  input: {
    tenantId: string;
    installationId: string;
    repositoryId: string;
  },
): Promise<SyncJobView> {
  const installation = await db.query.githubInstallations.findFirst({
    where: and(
      eq(githubInstallations.id, input.installationId),
      eq(githubInstallations.tenantId, input.tenantId),
    ),
  });
  if (!installation) {
    throw new Error("installation_not_found");
  }

  const repository = await db.query.repositories.findFirst({
    where: and(
      eq(repositories.id, input.repositoryId),
      eq(repositories.tenantId, input.tenantId),
      eq(repositories.githubInstallationId, input.installationId),
      eq(repositories.selected, true),
    ),
  });
  if (!repository) {
    throw new Error("repository_not_found_or_not_selected");
  }

  const [job] = await db
    .insert(syncJobs)
    .values({
      tenantId: input.tenantId,
      githubInstallationId: input.installationId,
      repositoryId: input.repositoryId,
      objectType: "repository",
      status: "queued",
      processedCount: 0,
    })
    .returning();

  if (!job) {
    throw new Error("failed_to_create_sync_job");
  }

  return {
    id: job.id,
    status: job.status,
    objectType: job.objectType,
    processedCount: job.processedCount,
    error: job.error,
    repositoryId: job.repositoryId,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
  };
}

export async function getSyncJob(
  db: Database,
  tenantId: string,
  jobId: string,
): Promise<SyncJobView | null> {
  const job = await db.query.syncJobs.findFirst({
    where: and(eq(syncJobs.id, jobId), eq(syncJobs.tenantId, tenantId)),
  });
  if (!job) {
    return null;
  }
  return {
    id: job.id,
    status: job.status,
    objectType: job.objectType,
    processedCount: job.processedCount,
    error: job.error,
    repositoryId: job.repositoryId,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
  };
}

export async function claimNextSyncJob(db: Database): Promise<string | null> {
  const job = await db.query.syncJobs.findFirst({
    where: eq(syncJobs.status, "queued"),
    orderBy: (table, { asc }) => [asc(table.createdAt)],
  });
  if (!job) {
    return null;
  }

  const startedAt = new Date();
  const updated = await db
    .update(syncJobs)
    .set({ status: "running", startedAt, error: null })
    .where(and(eq(syncJobs.id, job.id), eq(syncJobs.status, "queued")))
    .returning({ id: syncJobs.id });

  return updated[0]?.id ?? null;
}

export async function runRepositorySyncJob(
  db: Database,
  credentials: GitHubAppCredentials,
  jobId: string,
): Promise<SyncJobView> {
  const job = await db.query.syncJobs.findFirst({
    where: eq(syncJobs.id, jobId),
  });
  if (!job) {
    throw new Error("sync_job_not_found");
  }
  if (!job.repositoryId) {
    throw new Error("sync_job_missing_repository");
  }

  const installation = await db.query.githubInstallations.findFirst({
    where: eq(githubInstallations.id, job.githubInstallationId),
  });
  const repository = await db.query.repositories.findFirst({
    where: eq(repositories.id, job.repositoryId),
  });

  if (!installation || !repository) {
    const completedAt = new Date();
    await db
      .update(syncJobs)
      .set({
        status: "failed",
        error: "installation_or_repository_missing",
        completedAt,
      })
      .where(eq(syncJobs.id, jobId));
    throw new Error("installation_or_repository_missing");
  }

  try {
    let processedCount = 0;

    await db
      .update(syncJobs)
      .set({ cursor: "issues", status: "running" })
      .where(eq(syncJobs.id, jobId));

    const issues = await fetchRepositoryIssues(
      credentials,
      installation.githubInstallationId,
      repository.ownerLogin,
      repository.name,
    );
    for (const issue of issues) {
      await upsertEvent(db, {
        tenantId: job.tenantId,
        sourceEventId: issue.sourceEventId,
        eventType: issue.eventType,
        eventTime: issue.eventTime,
        payload: {
          ...issue.payload,
          repositoryId: repository.id,
          fullName: repository.fullName,
        },
      });
      processedCount += 1;
    }
    await db
      .update(syncJobs)
      .set({ processedCount, cursor: "pull_requests" })
      .where(eq(syncJobs.id, jobId));

    const pullRequests = await fetchRepositoryPullRequests(
      credentials,
      installation.githubInstallationId,
      repository.ownerLogin,
      repository.name,
    );
    for (const pr of pullRequests) {
      await upsertEvent(db, {
        tenantId: job.tenantId,
        sourceEventId: pr.sourceEventId,
        eventType: pr.eventType,
        eventTime: pr.eventTime,
        payload: {
          ...pr.payload,
          repositoryId: repository.id,
          fullName: repository.fullName,
        },
      });
      processedCount += 1;
    }
    await db
      .update(syncJobs)
      .set({ processedCount, cursor: "commits" })
      .where(eq(syncJobs.id, jobId));

    const commits = await fetchRepositoryCommits(
      credentials,
      installation.githubInstallationId,
      repository.ownerLogin,
      repository.name,
      repository.defaultBranch,
    );
    for (const commit of commits) {
      await upsertEvent(db, {
        tenantId: job.tenantId,
        sourceEventId: commit.sourceEventId,
        eventType: commit.eventType,
        eventTime: commit.eventTime,
        payload: {
          ...commit.payload,
          repositoryId: repository.id,
          fullName: repository.fullName,
        },
      });
      processedCount += 1;
    }

    const completedAt = new Date();
    const [done] = await db
      .update(syncJobs)
      .set({
        status: "completed",
        cursor: "done",
        processedCount,
        completedAt,
        error: null,
      })
      .where(eq(syncJobs.id, jobId))
      .returning();

    if (!done) {
      throw new Error("failed_to_finalize_sync_job");
    }

    return {
      id: done.id,
      status: done.status,
      objectType: done.objectType,
      processedCount: done.processedCount,
      error: done.error,
      repositoryId: done.repositoryId,
      startedAt: done.startedAt,
      completedAt: done.completedAt,
      createdAt: done.createdAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "sync_failed";
    const completedAt = new Date();
    await db
      .update(syncJobs)
      .set({ status: "failed", error: message, completedAt })
      .where(eq(syncJobs.id, jobId));
    throw error;
  }
}
