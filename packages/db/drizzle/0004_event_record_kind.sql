ALTER TABLE "events" ADD COLUMN "record_kind" text DEFAULT 'snapshot' NOT NULL;
--> statement-breakpoint
UPDATE "events"
SET "record_kind" = 'occurrence'
WHERE "source_event_id" LIKE 'github:commit:%'
   OR "source_event_id" LIKE 'github:issue_comment:%'
   OR "source_event_id" LIKE 'github:pull_request_review:%'
   OR "source_event_id" ~ '^github:issue:[0-9]+:'
   OR "source_event_id" ~ '^github:pull_request:[0-9]+:';
--> statement-breakpoint
CREATE INDEX "events_tenant_kind_time_idx" ON "events" ("tenant_id", "record_kind", "event_time");
