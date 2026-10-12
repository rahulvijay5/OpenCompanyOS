import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertManifestHash, canonicalJson, hashManifest } from "./manifest.js";

const REPOSITORY_ID = 160919119;
const FULL_NAME = "fastapi/fastapi";
const ISSUE_CAP = 300;
const ISSUE_PAGE_CAP = 3;
const MIN_ISSUES = 200;
const PER_PAGE = 100;

const corpora = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../eval/context-quality/corpora",
);
const v1Directory = path.join(corpora, "fastapi-v1");
const v2Directory = path.join(corpora, "fastapi-v2");

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
};

class FetchBlocked extends Error {}

async function main(): Promise<void> {
  const v1ManifestPath = path.join(v1Directory, "manifest.json");
  const v1HashPath = path.join(v1Directory, "manifest.sha256");
  const v1Content = await readFile(v1ManifestPath, "utf8");
  const v1Hash = (await readFile(v1HashPath, "utf8")).trim();
  assertManifestHash(v1Content, v1Hash);
  const v1 = JSON.parse(v1Content) as {
    pullRequests?: GitHubRecord[];
    repository?: { githubRepositoryId?: number; fullName?: string };
  };
  const pullRequests = v1.pullRequests ?? [];
  if (
    pullRequests.length !== 300 ||
    v1.repository?.githubRepositoryId !== REPOSITORY_ID ||
    v1.repository.fullName !== FULL_NAME
  ) {
    throw new FetchBlocked("v1_pull_request_slice_unexpected");
  }

  const manifestPath = path.join(v2Directory, "manifest.json");
  const hashPath = path.join(v2Directory, "manifest.sha256");
  try {
    const existing = await readFile(manifestPath, "utf8");
    const recorded = await readFile(hashPath, "utf8");
    assertManifestHash(existing, recorded);
    const stillV1 = await readFile(v1ManifestPath, "utf8");
    assertManifestHash(stillV1, v1Hash);
    console.log("existing_valid_manifest_kept");
    console.log(recorded.trim());
    return;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("manifest_hash_mismatch")) {
      throw error;
    }
  }

  const retrievedAt = new Date().toISOString();
  const repositoryResponse = await github("/repos/fastapi/fastapi");
  const repository = asRecord(repositoryResponse.body);
  if (
    asNumber(repository.id) !== REPOSITORY_ID ||
    asString(repository.full_name) !== FULL_NAME
  ) {
    throw new FetchBlocked("repository_identity_changed");
  }

  const issues = await collectIssues();
  if (issues.records.length < MIN_ISSUES || issues.records.length > ISSUE_CAP) {
    throw new FetchBlocked(`issue_count_${issues.records.length}`);
  }

  const manifest = {
    version: 2,
    sampleDescription:
      "Search-selected created-descending issue sample plus the fastapi-v1 pull-request records. Not a representative random sample.",
    repositoryComplete: false,
    selectionStatus: "search_sample_bounded",
    retrievedAt,
    repository: {
      githubRepositoryId: REPOSITORY_ID,
      requestedFullName: "tiangolo/fastapi",
      fullName: FULL_NAME,
      htmlUrl: asString(repository.html_url),
      repositoryRequestUrl: "https://api.github.com/repos/fastapi/fastapi",
      repositoryFinalUrl: repositoryResponse.finalUrl,
    },
    selection: {
      issues: issues.meta,
      pullRequests: {
        source: "fastapi-v1",
        sourceSha256: v1Hash,
        refetched: false,
        copiedCount: pullRequests.length,
        order: "fastapi-v1 pullRequests array order",
      },
    },
    counts: {
      issues: issues.records.length,
      pullRequests: pullRequests.length,
      combined: issues.records.length + pullRequests.length,
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
      "Issues are a search-selected created-descending sample from GitHub Search, not a random sample and not the full issue list.",
      "Pull requests were copied from fastapi-v1 in their original order and were not refetched.",
      "A search result that is a pull request aborts the freeze. None were kept.",
      "Issue and pull-request bodies are not stored in this manifest.",
      "updated_at is the snapshot timestamp returned by GitHub. It is not a closure time or a decision time.",
      "Inline review comments, comment edit history, linked issues, and commits were not requested.",
      "comments.status and reviews.status not_fetched are absent collections, not empty collections.",
    ],
    notes: [
      "This file is an evaluation source of truth independent of fastapi-v1. Evaluation must not refetch or regenerate it.",
      "A later import must reject the file when its SHA-256 does not match manifest.sha256.",
    ],
    issues: issues.records,
    pullRequests,
  };

  const content = canonicalJson(manifest);
  const digest = hashManifest(content);
  const unchangedV1 = await readFile(v1ManifestPath, "utf8");
  if (unchangedV1 !== v1Content || hashManifest(unchangedV1) !== v1Hash) {
    throw new FetchBlocked("v1_changed_during_freeze");
  }
  await mkdir(v2Directory, { recursive: true });
  await writeFile(manifestPath, content);
  await writeFile(hashPath, `${digest}\n`);
  await writeFile(
    path.join(v2Directory, "facts.json"),
    canonicalJson({ version: 1, manifestSha256: digest, facts: [] }),
  );
  await writeFile(
    path.join(v2Directory, "generated-questions.json"),
    canonicalJson({
      version: 1,
      verified: false,
      questions: [
        ...issues.records.slice(0, 3).map((issue) => ({
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
      ],
    }),
  );
  console.log(
    JSON.stringify({
      issues: issues.records.length,
      pullRequests: pullRequests.length,
      combined: issues.records.length + pullRequests.length,
      issueStop: issues.meta.stopReason,
      paginationRemaining: issues.meta.paginationRemaining,
      incompleteResults: issues.meta.incompleteResults,
      totalCount: issues.meta.totalCount,
      sha256: digest,
      v1Sha256: v1Hash,
    }),
  );
}

async function collectIssues(): Promise<{
  records: GitHubRecord[];
  meta: {
    endpoint: string;
    query: string;
    sort: "created";
    order: "desc";
    perPage: number;
    pages: Array<{ page: number; httpStatus: number; rawRows: number; keptFromPage: number }>;
    pagesRead: number;
    stopReason: "record_cap" | "page_cap" | "pagination_exhausted";
    paginationRemaining: boolean;
    incompleteResults: false;
    totalCount: number | null;
    sampleKind: "search_selected_created_descending";
  };
}> {
  const records: GitHubRecord[] = [];
  const pages: Array<{ page: number; httpStatus: number; rawRows: number; keptFromPage: number }> =
    [];
  let stopReason: "record_cap" | "page_cap" | "pagination_exhausted" | null = null;
  let paginationRemaining = false;
  let totalCount: number | null = null;
  const query = "repo:fastapi/fastapi is:issue";

  for (let page = 1; page <= ISSUE_PAGE_CAP; page += 1) {
    const pathname = `/search/issues?q=${encodeURIComponent(query)}&sort=created&order=desc&per_page=${PER_PAGE}&page=${page}`;
    const response = await github(pathname);
    const body = asRecord(response.body);
    if (body.incomplete_results !== false) {
      throw new FetchBlocked("search_results_incomplete");
    }
    if (!Array.isArray(body.items)) {
      throw new FetchBlocked("search_items_malformed");
    }
    if (page === 1) {
      totalCount = asNumber(body.total_count);
    }
    let keptFromPage = 0;
    for (const item of body.items) {
      const row = asRecord(item);
      if ("pull_request" in row && row.pull_request) {
        throw new FetchBlocked("search_result_was_pull_request");
      }
      records.push(mapIssue(row));
      keptFromPage += 1;
      if (records.length === ISSUE_CAP) {
        stopReason = "record_cap";
        paginationRemaining = keptFromPage < body.items.length || hasNext(response.link);
        break;
      }
    }
    pages.push({
      page,
      httpStatus: response.status,
      rawRows: body.items.length,
      keptFromPage,
    });
    if (stopReason) {
      break;
    }
    if (body.items.length < PER_PAGE || !hasNext(response.link)) {
      stopReason = "pagination_exhausted";
      paginationRemaining = false;
      break;
    }
    if (page === ISSUE_PAGE_CAP) {
      stopReason = "page_cap";
      paginationRemaining = hasNext(response.link) || (totalCount !== null && totalCount > records.length);
    }
  }

  if (!stopReason) {
    throw new FetchBlocked("issue_stop_reason_missing");
  }
  return {
    records,
    meta: {
      endpoint: "https://api.github.com/search/issues",
      query,
      sort: "created",
      order: "desc",
      perPage: PER_PAGE,
      pages,
      pagesRead: pages.length,
      stopReason,
      paginationRemaining,
      incompleteResults: false,
      totalCount,
      sampleKind: "search_selected_created_descending",
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
  if (id === null || number === null || !state || title === null || !htmlUrl || !createdAt || !updatedAt) {
    throw new FetchBlocked("malformed_issue");
  }
  return {
    sourceEventId: `github:issue:${id}`,
    githubId: id,
    number,
    state,
    title,
    htmlUrl,
    userLogin: row.user ? asString(asRecord(row.user).login) : null,
    createdAt,
    updatedAt,
    closedAt: asString(row.closed_at),
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
