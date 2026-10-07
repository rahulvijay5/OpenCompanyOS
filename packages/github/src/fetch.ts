import type { Octokit } from "@octokit/rest";
import {
  createInstallationOctokit,
  type GitHubAppCredentials,
} from "./client.js";

export type SyncedIssue = {
  sourceEventId: string;
  eventType: string;
  eventTime: Date | null;
  payload: Record<string, unknown>;
};

export type SyncedPullRequest = {
  sourceEventId: string;
  eventType: string;
  eventTime: Date | null;
  payload: Record<string, unknown>;
};

export type SyncedCommit = {
  sourceEventId: string;
  eventType: string;
  eventTime: Date | null;
  payload: Record<string, unknown>;
};

function installationClient(
  credentials: GitHubAppCredentials,
  installationId: number,
): Octokit {
  return createInstallationOctokit(credentials, installationId);
}

export async function fetchRepositoryIssues(
  credentials: GitHubAppCredentials,
  installationId: number,
  owner: string,
  repo: string,
): Promise<SyncedIssue[]> {
  const octokit = installationClient(credentials, installationId);
  const items: SyncedIssue[] = [];

  for await (const response of octokit.paginate.iterator(
    octokit.rest.issues.listForRepo,
    {
      owner,
      repo,
      state: "all",
      per_page: 100,
    },
  )) {
    for (const issue of response.data) {
      // GitHub's issues API also returns pull requests.
      if ("pull_request" in issue && issue.pull_request) {
        continue;
      }

      items.push({
        sourceEventId: `github:issue:${issue.id}`,
        eventType: `issues.${issue.state}`,
        eventTime: issue.updated_at ? new Date(issue.updated_at) : null,
        payload: {
          id: issue.id,
          number: issue.number,
          title: issue.title,
          state: issue.state,
          htmlUrl: issue.html_url,
          userLogin: issue.user?.login ?? null,
          createdAt: issue.created_at,
          updatedAt: issue.updated_at,
          closedAt: issue.closed_at,
          labels: issue.labels.map((label) =>
            typeof label === "string" ? label : label.name,
          ),
          body: issue.body,
        },
      });
    }
  }

  return items;
}

export async function fetchRepositoryPullRequests(
  credentials: GitHubAppCredentials,
  installationId: number,
  owner: string,
  repo: string,
): Promise<SyncedPullRequest[]> {
  const octokit = installationClient(credentials, installationId);
  const items: SyncedPullRequest[] = [];

  for await (const response of octokit.paginate.iterator(
    octokit.rest.pulls.list,
    {
      owner,
      repo,
      state: "all",
      per_page: 100,
    },
  )) {
    for (const pr of response.data) {
      const merged = Boolean(pr.merged_at);
      const eventType = merged
        ? "pull_request.merged"
        : `pull_request.${pr.state}`;

      items.push({
        sourceEventId: `github:pull_request:${pr.id}`,
        eventType,
        eventTime: pr.updated_at ? new Date(pr.updated_at) : null,
        payload: {
          id: pr.id,
          number: pr.number,
          title: pr.title,
          state: pr.state,
          merged,
          htmlUrl: pr.html_url,
          userLogin: pr.user?.login ?? null,
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          closedAt: pr.closed_at,
          mergedAt: pr.merged_at,
          baseRef: pr.base.ref,
          headRef: pr.head.ref,
          body: pr.body,
        },
      });
    }
  }

  return items;
}

export async function fetchRepositoryCommits(
  credentials: GitHubAppCredentials,
  installationId: number,
  owner: string,
  repo: string,
  defaultBranch: string | null,
): Promise<SyncedCommit[]> {
  const octokit = installationClient(credentials, installationId);
  const items: SyncedCommit[] = [];
  const params: {
    owner: string;
    repo: string;
    per_page: number;
    sha?: string;
  } = {
    owner,
    repo,
    per_page: 100,
  };
  if (defaultBranch) {
    params.sha = defaultBranch;
  }

  const commits = await octokit.paginate(octokit.rest.repos.listCommits, params);

  for (const commit of commits) {
    items.push({
      sourceEventId: `github:commit:${commit.sha}`,
      eventType: "push.commit",
      eventTime: commit.commit.committer?.date
        ? new Date(commit.commit.committer.date)
        : commit.commit.author?.date
          ? new Date(commit.commit.author.date)
          : null,
      payload: {
        sha: commit.sha,
        htmlUrl: commit.html_url,
        message: commit.commit.message,
        authorLogin: commit.author?.login ?? null,
        authorName: commit.commit.author?.name ?? null,
        committerLogin: commit.committer?.login ?? null,
        committedAt:
          commit.commit.committer?.date ?? commit.commit.author?.date ?? null,
      },
    });
  }

  return items;
}
