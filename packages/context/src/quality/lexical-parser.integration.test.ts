import { createSqlClient } from "@opencompanyos/db";
import { LEXICAL_SEPARATORS } from "@opencompanyos/retrieval";
import { afterAll, describe, expect, it } from "vitest";
import { resolveEvalDatabaseUrl } from "./database.js";

const resolution = resolveEvalDatabaseUrl(process.env);
const sql = resolution.status === "ready" ? createSqlClient(resolution.url) : null;

afterAll(async () => {
  await sql?.end();
});

/**
 * Observed PostgreSQL english parser behavior. These checks do not change
 * ranking or call an embedding model. A prefix query matches the start of a
 * lexeme, not a fragment later in that lexeme.
 */
describe.skipIf(!sql || resolution.status !== "ready")("english title parser", () => {
  const database = sql!;

  async function lexemes(text: string): Promise<string> {
    const rows = await database<{ lexemes: string }[]>`
      select to_tsvector('english', ${text})::text as lexemes
    `;
    return rows[0]?.lexemes ?? "";
  }

  async function matches(text: string, query: string): Promise<boolean> {
    const rows = await database<{ matches: boolean }[]>`
      select to_tsvector('english', ${text}) @@ to_tsquery('english', ${query}) as matches
    `;
    return rows[0]?.matches === true;
  }

  it("keeps a slash path as one lexeme and does not match a fragment inside it", async () => {
    const title = "Docs: migrate sql_databases/tutorial001_an_py310.py from on_event to lifespan";
    const parsed = await lexemes(title);
    expect(parsed).toContain("'databases/tutorial001_an_py310.py'");
    expect(parsed).toContain("'lifespan'");
    expect(parsed).toContain("'sql'");
    expect(parsed).toContain("'event'");
    expect(await matches(title, "tutorial001:*")).toBe(false);
    expect(await matches(title, "py310:*")).toBe(false);
    expect(await matches(title, "lifespan:*")).toBe(true);
    expect(await matches("tutorial001", "tutorial001:*")).toBe(true);
  });

  it("splits underscores, keeps hyphenated words, and matches a path only from its start", async () => {
    expect(await lexemes("foo_bar_baz")).toBe("'bar':2 'baz':3 'foo':1");
    expect(await matches("foo_bar_baz", "bar:*")).toBe(true);
    expect(await lexemes("on_event")).toBe("'event':2");
    expect(await lexemes("hello-world")).toBe("'hello':2 'hello-world':1 'world':3");
    expect(await matches("hello-world", "world:*")).toBe(true);
    expect(await lexemes("path/to/file.py")).toBe("'path/to/file.py':1");
    expect(await matches("path/to/file.py", "path:*")).toBe(true);
    expect(await matches("path/to/file.py", "file:*")).toBe(false);
  });
});

describe.skipIf(!sql || resolution.status !== "ready")("normalized lexical segments", () => {
  const database = sql!;

  async function matches(text: string, query: string): Promise<boolean> {
    const rows = await database<{ matches: boolean }[]>`
      select to_tsvector(
        'english',
        regexp_replace(${text}, ${LEXICAL_SEPARATORS}, ' ', 'g')
      ) @@ to_tsquery('english', ${query}) as matches
    `;
    return rows[0]?.matches === true;
  }

  it("matches path segments and filename parts that the raw parser keeps inside one lexeme", async () => {
    const title = "Docs: migrate sql_databases/tutorial001_an_py310.py from on_event to lifespan";
    expect(await matches(title, "tutorial001:*")).toBe(true);
    expect(await matches(title, "py310:*")).toBe(true);
    expect(await matches(title, "lifespan:*")).toBe(true);
    expect(await matches("path/to/file.py", "file:*")).toBe(true);
    expect(await matches("path/to/file.py", "path:*")).toBe(true);
    expect(await matches("foo_bar_baz", "bar:*")).toBe(true);
    expect(await matches("hello-world", "world:*")).toBe(true);
    expect(await matches("hello-world", "hello:*")).toBe(true);
  });
});
