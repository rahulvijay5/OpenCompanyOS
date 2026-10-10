import {
  createAppOctokit,
  createInstallationOctokit,
  type GitHubAppCredentials,
} from "./client.js";

export {
  createAppOctokit,
  createInstallationOctokit,
  type GitHubAppCredentials,
} from "./client.js";

export {
  fetchRepositoryCommits,
  fetchRepositoryIssues,
  fetchRepositoryPullRequests,
  type SyncedCommit,
  type SyncedIssue,
  type SyncedPullRequest,
} from "./fetch.js";

export {
  discussionClientFromOctokit,
  fetchIssueComments,
  fetchPullRequestReviews,
  issueNumberFromUrl,
  mapIssueComment,
  mapPullRequestReview,
  type DiscussionClient,
  type DiscussionFetch,
  type DiscussionRecord,
  type GitHubPage,
} from "./discussions.js";

export {
  RateLimitExceeded,
  RetryableHttpError,
  withBoundedRetry,
} from "./retry.js";

export {
  normalizeGithubWebhook,
  verifyGithubWebhookSignature,
  type NormalizedWebhookEvent,
} from "./webhook.js";

export type GitHubInstallationAccount = {
  id: number;
  login: string;
  type: string;
};

export type GitHubRepositorySummary = {
  githubRepositoryId: number;
  ownerLogin: string;
  name: string;
  fullName: string;
  defaultBranch: string | null;
  visibility: string | null;
  htmlUrl: string | null;
};

export function buildInstallUrl(appSlug: string, state?: string): string {
  const url = new URL(`https://github.com/apps/${appSlug}/installations/new`);
  if (state) {
    url.searchParams.set("state", state);
  }
  return url.toString();
}

export async function getInstallation(
  credentials: GitHubAppCredentials,
  installationId: number,
): Promise<{
  id: number;
  account: GitHubInstallationAccount;
}> {
  const octokit = createAppOctokit(credentials);
  const { data } = await octokit.rest.apps.getInstallation({
    installation_id: installationId,
  });

  const account = data.account;
  if (!account || !("login" in account) || account.login == null) {
    throw new Error(`Installation ${installationId} has no account login`);
  }

  return {
    id: data.id,
    account: {
      id: account.id,
      login: account.login,
      type: "type" in account && typeof account.type === "string"
        ? account.type
        : "Organization",
    },
  };
}

export async function listInstallationRepositories(
  credentials: GitHubAppCredentials,
  installationId: number,
): Promise<GitHubRepositorySummary[]> {
  const octokit = createInstallationOctokit(credentials, installationId);
  const repositories: GitHubRepositorySummary[] = [];

  for await (const response of octokit.paginate.iterator(
    octokit.rest.apps.listReposAccessibleToInstallation,
    { per_page: 100 },
  )) {
    for (const repo of response.data) {
      repositories.push({
        githubRepositoryId: repo.id,
        ownerLogin: repo.owner.login,
        name: repo.name,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch ?? null,
        visibility: repo.visibility ?? null,
        htmlUrl: repo.html_url ?? null,
      });
    }
  }

  return repositories;
}
