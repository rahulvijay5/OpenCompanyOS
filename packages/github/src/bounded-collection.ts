import type { DiscussionRecord } from "./discussions.js";

export const BOUNDED_PAGE_SIZE = 100;
export const BOUNDED_MAX_PAGES = 2;

export type CollectionStatus = "complete" | "incomplete_bounded" | "not_fetched";

export type CollectionPage = {
  status: number;
  link: string | null;
  data: unknown[];
};

export type BoundedCollection = {
  status: CollectionStatus;
  records: DiscussionRecord[];
  pagesFetched: number;
  httpStatus: number | null;
  recordCount: number | null;
};

/** True only when the pagination header offers another page. */
export function linkHasNext(link: string | null | undefined): boolean {
  if (!link) {
    return false;
  }
  return link.split(",").some((part) => /;\s*rel="?next"?/i.test(part));
}

/**
 * Completeness comes from the pagination response. A full page is complete
 * only when no next page is offered. Reaching the page cap while a next page
 * exists is incomplete_bounded.
 */
export function stepAfterPage(input: {
  page: number;
  maxPages: number;
  link: string | null;
}): "continue" | "complete" | "incomplete_bounded" {
  if (!linkHasNext(input.link)) {
    return "complete";
  }
  if (input.page >= input.maxPages) {
    return "incomplete_bounded";
  }
  return "continue";
}

export async function fetchBoundedCollection(
  requestPage: (page: number) => Promise<CollectionPage>,
  mapRecord: (item: unknown) => DiscussionRecord | null,
  options: { maxPages?: number } = {},
): Promise<BoundedCollection> {
  const maxPages = options.maxPages ?? BOUNDED_MAX_PAGES;
  const records: DiscussionRecord[] = [];
  let pagesFetched = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    let response: CollectionPage;
    try {
      response = await requestPage(page);
    } catch {
      return notFetched(pagesFetched, null);
    }
    if (response.status === 403 || response.status === 429 || response.status !== 200) {
      return notFetched(pagesFetched, response.status);
    }
    pagesFetched += 1;
    for (const item of response.data) {
      const record = mapRecord(item);
      if (record) {
        records.push(record);
      }
    }
    const step = stepAfterPage({ page, maxPages, link: response.link });
    if (step === "continue") {
      continue;
    }
    return {
      status: step,
      records,
      pagesFetched,
      httpStatus: 200,
      recordCount: records.length,
    };
  }
  return notFetched(pagesFetched, null);
}

function notFetched(pagesFetched: number, httpStatus: number | null): BoundedCollection {
  return {
    status: "not_fetched",
    records: [],
    pagesFetched,
    httpStatus,
    recordCount: null,
  };
}
