import { describe, expect, it } from "vitest";
import {
  fetchBoundedCollection,
  linkHasNext,
  stepAfterPage,
  type CollectionPage,
} from "./bounded-collection.js";

function comment(id: number) {
  return {
    id,
    body: `c${id}`,
    user: { login: "ada" },
    issue_url: "https://api.github.com/repos/fastapi/fastapi/issues/1",
    updated_at: "2026-03-02T00:00:00Z",
  };
}

const next = '<https://api.github.com/issues/1/comments?page=2>; rel="next"';

function map(item: unknown) {
  const id = (item as { id?: number }).id;
  return id
    ? {
        sourceEventId: `github:issue_comment:${id}`,
        eventType: "issue_comment.backfill",
        eventTime: null,
        payload: {},
      }
    : null;
}

describe("bounded collection pagination", () => {
  it("treats a missing next link as complete, including a full page", () => {
    expect(linkHasNext(null)).toBe(false);
    expect(linkHasNext('<https://api.github.com/x?page=2>; rel="last"')).toBe(false);
    expect(stepAfterPage({ page: 1, maxPages: 2, link: null })).toBe("complete");
    expect(stepAfterPage({ page: 2, maxPages: 2, link: null })).toBe("complete");
  });

  it("keeps a capped collection incomplete when another page is offered", () => {
    expect(linkHasNext(next)).toBe(true);
    expect(stepAfterPage({ page: 1, maxPages: 2, link: next })).toBe("continue");
    expect(stepAfterPage({ page: 2, maxPages: 2, link: next })).toBe("incomplete_bounded");
  });

  it("stores both pages when the second page has no next link", async () => {
    const pages: CollectionPage[] = [
      { status: 200, link: next, data: Array.from({ length: 100 }, (_, index) => comment(index + 1)) },
      { status: 200, link: null, data: [comment(101)] },
    ];
    const fetched = await fetchBoundedCollection(async (page) => pages[page - 1]!, map);
    expect(fetched.status).toBe("complete");
    expect(fetched.recordCount).toBe(101);
    expect(fetched.pagesFetched).toBe(2);
  });

  it("does not request a third page when the second page still has a next link", async () => {
    const requested: number[] = [];
    const fetched = await fetchBoundedCollection(async (page) => {
      requested.push(page);
      return {
        status: 200,
        link: next,
        data: Array.from({ length: 100 }, (_, index) => comment(page * 100 + index)),
      };
    }, map);
    expect(requested).toEqual([1, 2]);
    expect(fetched.status).toBe("incomplete_bounded");
    expect(fetched.recordCount).toBe(200);
  });

  it("records a completed empty page as zero records", async () => {
    const fetched = await fetchBoundedCollection(async () => ({ status: 200, link: null, data: [] }), map);
    expect(fetched.status).toBe("complete");
    expect(fetched.recordCount).toBe(0);
    expect(fetched.records).toEqual([]);
  });

  it("stops the collection on 403 or 429 and does not keep partial records", async () => {
    const blocked = await fetchBoundedCollection(async () => ({ status: 429, link: null, data: [] }), map);
    expect(blocked.status).toBe("not_fetched");
    expect(blocked.recordCount).toBeNull();
    expect(blocked.records).toEqual([]);

    const partial = await fetchBoundedCollection(async (page) => {
      if (page === 1) {
        return { status: 200, link: next, data: [comment(1)] };
      }
      return { status: 403, link: null, data: [] };
    }, map);
    expect(partial.status).toBe("not_fetched");
    expect(partial.recordCount).toBeNull();
    expect(partial.records).toEqual([]);
    expect(partial.httpStatus).toBe(403);
  });
});
