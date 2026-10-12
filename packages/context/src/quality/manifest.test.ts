import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertManifestHash, canonicalJson, hashManifest } from "./manifest.js";

const directory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../eval/context-quality/corpora/fastapi-v1",
);

describe("fastapi manifest hash", () => {
  it("validates the committed manifest bytes and rejects a changed byte", async () => {
    const content = await readFile(path.join(directory, "manifest.json"), "utf8");
    const recorded = await readFile(path.join(directory, "manifest.sha256"), "utf8");
    expect(hashManifest(content)).toBe(hashManifest(content));
    expect(canonicalJson(JSON.parse(content))).toBe(content);
    assertManifestHash(content, recorded);
    expect(() => assertManifestHash(`${content} `, recorded)).toThrow(/manifest_hash_mismatch/);
  });

  it("keeps facts empty and generated questions unverified", async () => {
    const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
    const digest = (await readFile(path.join(directory, "manifest.sha256"), "utf8")).trim();
    const facts = JSON.parse(await readFile(path.join(directory, "facts.json"), "utf8"));
    const questions = JSON.parse(
      await readFile(path.join(directory, "generated-questions.json"), "utf8"),
    );
    expect(manifest.comments.status).toBe("not_fetched");
    expect(manifest.reviews.status).toBe("not_fetched");
    expect(manifest.repositoryComplete).toBe(false);
    expect(manifest.counts.combined).toBeGreaterThanOrEqual(300);
    expect(manifest.counts.combined).toBeLessThanOrEqual(800);
    expect(facts.facts).toEqual([]);
    expect(facts.manifestSha256).toBe(digest);
    expect(questions.questions.length).toBeGreaterThan(0);
    expect(questions.questions.every((question: { verified: boolean }) => question.verified === false)).toBe(
      true,
    );
  });
});

const v2Directory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../eval/context-quality/corpora/fastapi-v2",
);

describe("fastapi v2 manifest hash", () => {
  it("validates the v2 manifest bytes and rejects a changed byte", async () => {
    const content = await readFile(path.join(v2Directory, "manifest.json"), "utf8");
    const recorded = await readFile(path.join(v2Directory, "manifest.sha256"), "utf8");
    expect(hashManifest(content)).toBe(hashManifest(content));
    expect(canonicalJson(JSON.parse(content))).toBe(content);
    assertManifestHash(content, recorded);
    expect(() => assertManifestHash(`${content} `, recorded)).toThrow(/manifest_hash_mismatch/);
    expect(recorded.trim()).not.toBe(
      (await readFile(path.join(directory, "manifest.sha256"), "utf8")).trim(),
    );
  });

  it("copies the v1 pull requests and keeps the issue sample bounded", async () => {
    const v1 = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
    const v2 = JSON.parse(await readFile(path.join(v2Directory, "manifest.json"), "utf8"));
    const facts = JSON.parse(await readFile(path.join(v2Directory, "facts.json"), "utf8"));
    const questions = JSON.parse(
      await readFile(path.join(v2Directory, "generated-questions.json"), "utf8"),
    );
    expect(v2.repository.githubRepositoryId).toBe(160919119);
    expect(v2.repository.fullName).toBe("fastapi/fastapi");
    expect(v2.selection.issues.sampleKind).toBe("search_selected_created_descending");
    expect(v2.selection.issues.incompleteResults).toBe(false);
    expect(v2.counts.issues).toBeGreaterThanOrEqual(200);
    expect(v2.counts.issues).toBeLessThanOrEqual(300);
    expect(v2.pullRequests.map((item: { sourceEventId: string }) => item.sourceEventId)).toEqual(
      v1.pullRequests.map((item: { sourceEventId: string }) => item.sourceEventId),
    );
    expect(v2.comments.status).toBe("not_fetched");
    expect(v2.reviews.status).toBe("not_fetched");
    expect(facts.facts).toEqual([]);
    expect(questions.questions.every((question: { verified: boolean }) => question.verified === false)).toBe(
      true,
    );
  });
});
