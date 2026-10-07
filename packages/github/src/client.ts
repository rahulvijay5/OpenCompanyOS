import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

export type GitHubAppCredentials = {
  appId: string;
  privateKey: string;
  clientId: string;
  clientSecret: string;
};

export function createAppOctokit(credentials: GitHubAppCredentials): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: credentials.appId,
      privateKey: credentials.privateKey,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    },
  });
}

export function createInstallationOctokit(
  credentials: GitHubAppCredentials,
  installationId: number,
): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: credentials.appId,
      privateKey: credentials.privateKey,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      installationId,
    },
  });
}
