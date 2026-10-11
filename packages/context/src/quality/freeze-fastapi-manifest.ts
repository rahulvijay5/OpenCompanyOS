import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertManifestHash, canonicalJson, hashManifest } from "./manifest.js";

const OWNER = "tiangolo";
const REPO = "fastapi";
const ISSUE_CAP = 500;
const ISSUE_PAGE_CAP = 8;
const PULL_CAP = 300;
const PULL_PAGE_CAP = 4;
const PER_PAGE = 100;
const MIN_COMBINED = 300;
const MAX_COMBINED = 800;

const directory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../eval/context-quality/corpora/fastapi-v1",
);

type GitHubRecord = {
  sourceEventId: string;
  githubId: number;
  number: number;
  state: string;
  title: string;
  htmlUrl: string;
  userLogin: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt?: string | null;
  merged?: boolean;
};

type PageLog = {
  page: number;
  httpStatus: number;
  rawRows: number;
  keptFromPage: number;
};

type CollectionFetch = {
  endpoint: string;
  query: { state: "all"; sort: "created"; direction: "desc"; per_page: number };
  pages: PageLog[];
  pagesRead: number;
  stopReason: "record_cap" | "page_cap" | "pagination_exhausted";
  paginationRemaining: boolean;
  excludedRows: number;
};

class FetchBlocked extends Error {}

async function main(): Promise<void> {
  const manifestPath = path.join(directory, "manifest.json");
  const hashPath = path.join(directory, "manifest.sha256");
  try {
    const existing = await readFile(manifestPath, "utf8");
    const recorded = await readFile(hashPath, "utf8");
    assertManifestHash(existing, recorded);
    console.log("existing_valid_manifest_kept");
    console.log(recorded.trim());
    return;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("manifest_hash_mismatch")) {
      throw error;
    }
  }

  const retrievedAt = new Date().toISOString();
  const repositoryResponse = await github(`/repos/${OWNER}/${REPO}`);
  const repository = asRecord(repositoryResponse.body);
  const repositoryId = asNumber(repository.id);
  const fullName = asString(repository.full_name);
  const requestedFullName = `${OWNER}/${REPO}`;
  if (
    repositoryId === null ||
    !fullName ||
    !repositoryResponse.finalUrl.endsWith(`/repositories/${repositoryId}`)
  ) {
    throw new FetchBlocked("repository_identity_malformed");
  }

  const canonical = fullName;
  const issues = await collect({
    endpoint: `/repos/${canonical}/issues`,
    cap: ISSUE_CAP,
    pageCap: ISSUE_PAGE_CAP,
    keep: (row) => !("pull_request" in row && row.pull_request),
    map: (row) => mapIssue(row),
  });
  const pullRequests = await collect({
    endpoint: `/repos/${canonical}/pulls`,
    cap: PULL_CAP,
    pageCap: PULL_PAGE_CAP,
    keep: () => true,
    map: (row) => mapPull(row),
  });

  const combined = issues.records.length + pullRequests.records.length;
  if (combined < MIN_COMBINED || combined > MAX_COMBINED) {
    throw new FetchBlocked(
      `combined_count_${combined}_outside_${MIN_COMBINED}_${MAX_COMBINED}`,
    );
  }

  const manifest = {
    version: 1,
    repositoryComplete: false,
    selectionStatus: "bounded_prefix_complete",
    retrievedAt,
    repository: {
      githubRepositoryId: repositoryId,
      requestedFullName,
      fullName,
      htmlUrl: asString(repository.html_url),
      repositoryRequestUrl: `https://api.github.com/repos/${requestedFullName}`,
      repositoryFinalUrl: repositoryResponse.finalUrl,
    },
    selection: {
      issues: issues.meta,
      pullRequests: pullRequests.meta,
    },
    counts: {
      issues: issues.records.length,
      pullRequests: pullRequests.records.length,
      combined,
    },
    comments: {
      status: "not_fetched",
      reason:
        "Current issue and pull-request conversation comments can be imported later by the existing backfill. This manifest does not contain that collection.",
    },
    reviews: {
      status: "not_fetched",
      reason:
        "Current pull-request review decisions can be imported later by the existing per-pull backfill. This manifest does not contain that collection.",
    },
    exclusions: [
      `The requested repository ${requestedFullName} redirects to ${fullName}. Records were read from the canonical repository id ${repositoryId}.`,
      "Issue-list rows that are pull requests are counted as excluded, not stored as issues.",
      "Issue and pull-request bodies are not stored in this manifest.",
      "updated_at is the snapshot timestamp returned by GitHub. It is not a closure time or a decision time.",
      "Inline review comments, comment edit history, linked issues, and commits were not requested.",
      "comments.status and reviews.status not_fetched are absent collections, not empty collections.",
    ],
    notes: [
      "This file is the evaluation source of truth. Evaluation must not refetch or regenerate it.",
      "A later import must reject the file when its SHA-256 does not match manifest.sha256.",
    ],
    issues: issues.records,
    pullRequests: pullRequests.records,
  };

  const content = canonicalJson(manifest);
  const digest = hashManifest(content);
  await mkdir(directory, { recursive: true });
  const facts = canonicalJson({
    version: 1,
    manifestSha256: digest,
    facts: [],
  });
  const questions = canonicalJson({
    version: 1,
    verified: false,
    questions: templateQuestions(issues.records, pullRequests.records),
  });
  await writeFile(manifestPath, content);
  await writeFile(hashPath, `${digest}\n`);
  await writeFile(path.join(directory, "facts.json"), facts);
  await writeFile(path.join(directory, "generated-questions.json"), questions);
  console.log(
    JSON.stringify({
      issues: issues.records.length,
      pullRequests: pullRequests.records.length,
      combined,
      issueStop: issues.meta.stopReason,
      issuePaginationRemaining: issues.meta.paginationRemaining,
      pullStop: pullRequests.meta.stopReason,
      pullPaginationRemaining: pullRequests.meta.paginationRemaining,
      sha256: digest,
    }),
  );
}

function templateQuestions(issues: GitHubRecord[], pullRequests: GitHubRecord[]) {
  return [
    ...issues.slice(0, 3).map((issue) => ({
      id: `generated-issue-${issue.number}`,
      question: `What is the recorded title of issue ${issue.number}?`,
      candidateSourceId: issue.sourceEventId,
      verified: false,
    })),
    ...pullRequests.slice(0, 2).map((pull) => ({
      id: `generated-pull-${pull.number}`,
      question: `What is the recorded title of pull request ${pull.number}?`,
      candidateSourceId: pull.sourceEventId,
      verified: false,
    })),
  ];
}

async function collect(input: {
  endpoint: string;
  cap: number;
  pageCap: number;
  keep: (row: Record<string, unknown>) => boolean;
  map: (row: Record<string, unknown>) => GitHubRecord;
}): Promise<{ records: GitHubRecord[]; meta: CollectionFetch }> {
  const records: GitHubRecord[] = [];
  const pages: PageLog[] = [];
  let excludedRows = 0;
  let stopReason: CollectionFetch["stopReason"] | null = null;
  let paginationRemaining = false;

  for (let page = 1; page <= input.pageCap; page += 1) {
    const response = await github(
      `${input.endpoint}?state=all&sort=created&direction=desc&per_page=${PER_PAGE}&page=${page}`,
    );
    if (!Array.isArray(response.body)) {
      throw new FetchBlocked(`${input.endpoint}_page_${page}_not_an_array`);
    }
    let keptFromPage = 0;
    for (const item of response.body) {
      const row = asRecord(item);
      if (!input.keep(row)) {
        excludedRows += 1;
        continue;
      }
      records.push(input.map(row));
      keptFromPage += 1;
      if (records.length === input.cap) {
        stopReason = "record_cap";
        paginationRemaining =
          keptFromPage < response.body.length || hasNext(response.link);
        break;
      }
    }
    pages.push({
      page,
      httpStatus: response.status,
      rawRows: response.body.length,
      keptFromPage,
    });
    if (stopReason) {
      break;
    }
    if (response.body.length < PER_PAGE || !hasNext(response.link)) {
      stopReason = "pagination_exhausted";
      paginationRemaining = false;
      break;
    }
    if (page === input.pageCap) {
      stopReason = "page_cap";
      paginationRemaining = hasNext(response.link);
    }
  }

  if (!stopReason) {
    throw new FetchBlocked(`${input.endpoint}_stop_reason_missing`);
  }

  return {
    records,
    meta: {
      endpoint: `https://api.github.com${input.endpoint}`,
      query: { state: "all", sort: "created", direction: "desc", per_page: PER_PAGE },
      pages,
      pagesRead: pages.length,
      stopReason,
      paginationRemaining,
      excludedRows,
    },
  };
}

function mapIssue(row: Record<string, unknown>): GitHubRecord {
  const id = asNumber(row.id);
  const number = asNumber(row.number);
  const state = asString(row.state);
  const title = asString(row.title);
  const htmlUrl = asString(row.html_url);
  const createdAt = asString(row.created_at);
  const updatedAt = asString(row.updated_at);
  if (
    id === null ||
    number === null ||
    !state ||
    title === null ||
    !htmlUrl ||
    !createdAt ||
    !updatedAt
  ) {
    throw new FetchBlocked("malformed_issue");
  }
  return {
    sourceEventId: `github:issue:${id}`,
    githubId: id,
    number,
    state,
    title,
    htmlUrl,
    userLogin: asString(row.user && asRecord(row.user).login),
    createdAt,
    updatedAt,
    closedAt: asString(row.closed_at),
  };
}

function mapPull(row: Record<string, unknown>): GitHubRecord {
  const mapped = mapIssue(row);
  return {
    ...mapped,
    sourceEventId: `github:pull_request:${mapped.githubId}`,
    mergedAt: asString(row.merged_at),
    merged: Boolean(row.merged_at),
  };
}

async function github(pathname: string): Promise<{
  status: number;
  finalUrl: string;
  link: string | null;
  body: unknown;
}> {
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "OpenCompanyOS-manifest-freeze",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (response.status !== 200) {
    throw new FetchBlocked(`github_http_${response.status}:${pathname}`);
  }
  return {
    status: response.status,
    finalUrl: response.url,
    link: response.headers.get("link"),
    body: await response.json(),
  };
}

function hasNext(link: string | null): boolean {
  return Boolean(link?.includes('rel="next"'));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FetchBlocked("malformed_object");
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "freeze_failed";
  console.error(message);
  process.exitCode = 1;
});
