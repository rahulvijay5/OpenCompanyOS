import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const api = process.env.API_URL ?? "http://localhost:4000";
const dataset = JSON.parse(
  await readFile(path.join(root, "eval/company-brain.json"), "utf8"),
);

const failures = [];

function fail(name, detail) {
  failures.push({ name, detail });
  console.log(`FAIL  ${name}: ${detail}`);
}

function pass(name, detail) {
  console.log(`ok    ${name}${detail ? `: ${detail}` : ""}`);
}

let entitiesResponse;
try {
  entitiesResponse = await fetch(`${api}/api/v1/entities?limit=200`);
} catch (error) {
  console.error(`Could not reach ${api}. Start pnpm dev first.`);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
if (!entitiesResponse.ok) {
  console.error(`Could not reach ${api} (${entitiesResponse.status}). Start pnpm dev first.`);
  process.exit(1);
}
const entitiesBody = await entitiesResponse.json();

for (const expected of dataset.entities) {
  const found = entitiesBody.entities.some(
    (entity) =>
      entity.type === expected.type &&
      entity.canonicalName.toLowerCase().includes(expected.nameIncludes.toLowerCase()),
  );
  if (found) {
    pass(`entity ${expected.type}`, expected.nameIncludes);
  } else {
    fail(`entity ${expected.type}`, `no canonical name includes ${expected.nameIncludes}`);
  }
}

const repository = entitiesBody.entities.find(
  (entity) =>
    entity.type === "Repository" &&
    entity.canonicalName.toLowerCase().includes("company-brain"),
);
if (repository) {
  const timelineResponse = await fetch(
    `${api}/api/v1/entities/${repository.id}/timeline?limit=20`,
  );
  const timeline = await timelineResponse.json();
  const kinds = new Set((timeline.events ?? []).map((event) => event.recordKind));
  if (kinds.size === 0) {
    pass("repository timeline", "no occurrences yet");
  } else if (kinds.size === 1 && kinds.has("occurrence")) {
    pass("repository timeline", `${timeline.events.length} occurrences`);
  } else {
    fail("repository timeline", `expected occurrence rows, saw ${[...kinds].join(",")}`);
  }
}

const changesResponse = await fetch(`${api}/api/v1/changes?limit=50`);
const changesBody = await changesResponse.json();
const allowed = new Set(dataset.changes.allowedKinds);
const oldest = Date.now() - dataset.changes.maxAgeDays * 24 * 60 * 60 * 1000;
let changeProblems = 0;
for (const change of changesBody.changes ?? []) {
  if (!allowed.has(change.kind)) {
    changeProblems += 1;
    fail(`change ${change.id}`, `kind ${change.kind}`);
  }
  if (change.eventTime && Date.parse(change.eventTime) < oldest) {
    changeProblems += 1;
    fail(
      `change ${change.id}`,
      `event time ${change.eventTime} is outside ${dataset.changes.maxAgeDays} days`,
    );
  }
}
if (changeProblems === 0) {
  pass("changes window", `${(changesBody.changes ?? []).length} rows`);
}

console.log("");
console.log(`failed ${failures.length}`);
process.exit(failures.length === 0 ? 0 : 1);
