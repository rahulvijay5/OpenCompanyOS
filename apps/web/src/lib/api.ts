const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type InstallationSummary = {
  id: string;
  githubInstallationId: number;
  accountLogin: string;
  accountType: string;
  status: string;
};

export type RepositorySummary = {
  id: string;
  githubRepositoryId: number;
  fullName: string;
  ownerLogin: string;
  name: string;
  defaultBranch: string | null;
  visibility: string | null;
  htmlUrl: string | null;
  selected: boolean;
};

export async function fetchRepositories(installationId?: string) {
  const url = new URL(`${API_URL}/api/v1/integrations/github/repositories`);
  if (installationId) {
    url.searchParams.set("installationId", installationId);
  }

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load repositories (${response.status})`);
  }

  return (await response.json()) as {
    installation: InstallationSummary | null;
    repositories: RepositorySummary[];
  };
}

export async function completeGithubSetup(installationId: string) {
  const url = new URL(`${API_URL}/api/v1/integrations/github/setup`);
  url.searchParams.set("installation_id", installationId);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
      error?: string;
    } | null;
    throw new Error(
      body?.message ?? body?.error ?? `Setup failed (${response.status})`,
    );
  }

  return (await response.json()) as {
    installation: InstallationSummary & { setupAction: string | null };
    repositoryCount: number;
  };
}

export async function selectRepositories(
  installationId: string,
  githubRepositoryIds: number[],
) {
  const response = await fetch(
    `${API_URL}/api/v1/integrations/github/repositories/select`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ installationId, githubRepositoryIds }),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to select repositories (${response.status})`);
  }

  return response.json();
}

export type SyncJobSummary = {
  id: string;
  status: string;
  objectType: string | null;
  processedCount: number;
  error: string | null;
  repositoryId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export async function startRepositorySync(
  installationId: string,
  repositoryId: string,
) {
  const response = await fetch(`${API_URL}/api/v1/integrations/github/sync`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ installationId, repositoryId }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Failed to start sync (${response.status})`);
  }

  return (await response.json()) as { job: SyncJobSummary };
}

export async function fetchSyncJob(jobId: string) {
  const response = await fetch(
    `${API_URL}/api/v1/integrations/github/sync/${jobId}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(`Failed to load sync job (${response.status})`);
  }
  return (await response.json()) as { job: SyncJobSummary };
}

export type EventListItem = {
  id: string;
  eventType: string;
  sourceEventId: string;
  eventTime: string | null;
  observedAt: string;
  title: string | null;
  htmlUrl: string | null;
  fullName: string | null;
};

export type EntityCount = { type: string; count: number };

export type EntityListItem = {
  id: string;
  type: string;
  canonicalName: string;
  sourceId: string | null;
};

export async function fetchEntities(limit = 40) {
  const url = new URL(`${API_URL}/api/v1/entities`);
  url.searchParams.set("limit", String(limit));
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load entities (${response.status})`);
  }
  return (await response.json()) as {
    counts: EntityCount[];
    entities: EntityListItem[];
  };
}

export type ChangeListItem = {
  id: string;
  kind: string;
  eventType: string;
  eventTime: string | null;
  title: string | null;
  url: string | null;
  actor: { id: string; name: string } | null;
  repository: { id: string | null; name: string | null } | null;
};

export async function fetchChanges(limit = 20) {
  const url = new URL(`${API_URL}/api/v1/changes`);
  url.searchParams.set("limit", String(limit));
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load changes (${response.status})`);
  }
  return (await response.json()) as { changes: ChangeListItem[] };
}

export async function fetchRecentEvents(limit = 20) {
  const url = new URL(`${API_URL}/api/v1/events`);
  url.searchParams.set("limit", String(limit));
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load events (${response.status})`);
  }
  return (await response.json()) as { events: EventListItem[] };
}

export function githubInstallHref(): string {
  return `${API_URL}/api/v1/integrations/github/install`;
}
