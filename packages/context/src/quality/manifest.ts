import { createHash } from "node:crypto";

/**
 * Bytes that are hashed: the UTF-8 text of canonical JSON for the manifest
 * object, including a single trailing newline. Canonical JSON sorts object
 * keys and keeps array order. The digest is not stored inside the manifest.
 */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortValue(value))}\n`;
}

export function hashManifest(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function assertManifestHash(content: string, expectedHex: string): void {
  const actual = hashManifest(content);
  const expected = expectedHex.trim();
  if (actual !== expected) {
    throw new Error(`manifest_hash_mismatch:${actual}`);
  }
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return Object.fromEntries(entries.map(([key, entry]) => [key, sortValue(entry)]));
  }
  return value;
}
