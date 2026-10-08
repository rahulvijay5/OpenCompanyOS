import { customType } from "drizzle-orm/pg-core";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/** Matches the default LiteLLM embedding alias (Gemini embedding-001 at 768). */
export const EMBEDDING_DIMENSIONS = 768;

const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1536})`;
  },
  toDriver(value: number[]) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: unknown) {
    if (typeof value !== "string") {
      return [];
    }
    return value
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .split(",")
      .filter((part) => part.length > 0)
      .map((part) => Number(part));
  },
});

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantMembers = pgTable(
  "tenant_members",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.userId] })],
);

export const githubInstallations = pgTable("github_installations", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  githubInstallationId: bigint("github_installation_id", { mode: "number" })
    .notNull()
    .unique(),
  githubAccountId: bigint("github_account_id", { mode: "number" }).notNull(),
  githubAccountLogin: text("github_account_login").notNull(),
  githubAccountType: text("github_account_type").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const repositories = pgTable(
  "repositories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    githubInstallationId: uuid("github_installation_id")
      .notNull()
      .references(() => githubInstallations.id, { onDelete: "cascade" }),
    githubRepositoryId: bigint("github_repository_id", {
      mode: "number",
    }).notNull(),
    ownerLogin: text("owner_login").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(),
    defaultBranch: text("default_branch"),
    visibility: text("visibility"),
    htmlUrl: text("html_url"),
    selected: boolean("selected").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("repositories_installation_repo_unique").on(
      table.githubInstallationId,
      table.githubRepositoryId,
    ),
  ],
);

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    canonicalName: text("canonical_name").notNull(),
    description: text("description"),
    sourceSystem: text("source_system"),
    sourceId: text("source_id"),
    metadata: jsonb("metadata")
      .notNull()
      .default({})
      .$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("entities_tenant_type_source_unique").on(
      table.tenantId,
      table.type,
      table.sourceSystem,
      table.sourceId,
    ),
  ],
);

export const entityAliases = pgTable("entity_aliases", {
  id: uuid("id").defaultRandom().primaryKey(),
  entityId: uuid("entity_id")
    .notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  alias: text("alias").notNull(),
  sourceSystem: text("source_system"),
  sourceId: text("source_id"),
  confidence: real("confidence"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    sourceSystem: text("source_system").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    eventType: text("event_type").notNull(),
    actorEntityId: uuid("actor_entity_id").references(() => entities.id, {
      onDelete: "set null",
    }),
    objectEntityId: uuid("object_entity_id").references(() => entities.id, {
      onDelete: "set null",
    }),
    eventTime: timestamp("event_time", { withTimezone: true }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("events_tenant_source_event_unique").on(
      table.tenantId,
      table.sourceSystem,
      table.sourceEventId,
    ),
  ],
);

export const relationships = pgTable(
  "relationships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    sourceEntityId: uuid("source_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    relationshipType: text("relationship_type").notNull(),
    targetEntityId: uuid("target_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    confidence: real("confidence"),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validTo: timestamp("valid_to", { withTimezone: true }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    sourceEventId: uuid("source_event_id").references(() => events.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata")
      .notNull()
      .default({})
      .$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("relationships_edge_unique").on(
      table.tenantId,
      table.sourceEntityId,
      table.relationshipType,
      table.targetEntityId,
    ),
    index("relationships_target_idx").on(table.targetEntityId),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id").references(() => entities.id, {
      onDelete: "set null",
    }),
    sourceSystem: text("source_system").notNull(),
    sourceId: text("source_id").notNull(),
    title: text("title"),
    body: text("body"),
    url: text("url"),
    metadata: jsonb("metadata")
      .notNull()
      .default({})
      .$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("documents_tenant_source_unique").on(
      table.tenantId,
      table.sourceSystem,
      table.sourceId,
    ),
  ],
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    metadata: jsonb("metadata")
      .notNull()
      .default({})
      .$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("document_chunks_doc_index_unique").on(
      table.documentId,
      table.chunkIndex,
    ),
  ],
);

export const evidence = pgTable("evidence", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  sourceSystem: text("source_system").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  entityId: uuid("entity_id").references(() => entities.id, {
    onDelete: "set null",
  }),
  title: text("title"),
  snippet: text("snippet"),
  url: text("url"),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const queries = pgTable("queries", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  queryText: text("query_text").notNull(),
  answerText: text("answer_text"),
  model: text("model"),
  latencyMs: integer("latency_ms"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const queryEvidence = pgTable(
  "query_evidence",
  {
    queryId: uuid("query_id")
      .notNull()
      .references(() => queries.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "cascade" }),
    rank: integer("rank"),
    score: real("score"),
  },
  (table) => [primaryKey({ columns: [table.queryId, table.evidenceId] })],
);

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, {
    onDelete: "set null",
  }),
  githubDeliveryId: text("github_delivery_id").notNull().unique(),
  eventName: text("event_name").notNull(),
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  status: text("status").notNull(),
  error: text("error"),
});

export const syncJobs = pgTable("sync_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  githubInstallationId: uuid("github_installation_id")
    .notNull()
    .references(() => githubInstallations.id, { onDelete: "cascade" }),
  repositoryId: uuid("repository_id").references(() => repositories.id, {
    onDelete: "set null",
  }),
  objectType: text("object_type"),
  status: text("status").notNull(),
  cursor: text("cursor"),
  processedCount: integer("processed_count").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
