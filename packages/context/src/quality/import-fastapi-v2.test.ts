import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateFastapiV2Manifest } from "./import-fastapi-v2.js";

const corpora = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../eval/context-quality/corpora",
);

describe("fastapi v2 manifest gate", () => {
  it("accepts the frozen manifest and refuses a hash mismatch before any database call", async () => {
    const v2Text = await readFile(path.join(corpora, "fastapi-v2/manifest.json"), "utf8");
    const v2HashText = await readFile(path.join(corpora, "fastapi-v2/manifest.sha256"), "utf8");
    const v1Text = await readFile(path.join(corpora, "fastapi-v1/manifest.json"), "utf8");
    const records = validateFastapiV2Manifest({ v2Text, v2HashText, v1Text });
    expect(records).toHaveLength(600);
    expect(records.filter((record) => record.sourceEventId.startsWith("github:issue:"))).toHaveLength(
      300,
    );
    expect(
      records.filter((record) => record.sourceEventId.startsWith("github:pull_request:")),
    ).toHaveLength(300);
    expect(records.every((record) => record.eventTime.length > 0)).toBe(true);
    expect(() =>
      validateFastapiV2Manifest({ v2Text, v2HashText: `${v2HashText.trim()}00`, v1Text }),
    ).toThrow(/manifest_hash_mismatch/);
  });
});
