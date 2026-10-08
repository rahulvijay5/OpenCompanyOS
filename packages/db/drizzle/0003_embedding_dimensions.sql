DROP INDEX IF EXISTS "document_chunks_embedding_hnsw";
--> statement-breakpoint
ALTER TABLE "document_chunks" DROP COLUMN "embedding";
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "embedding" vector(768);
--> statement-breakpoint
CREATE INDEX "document_chunks_embedding_hnsw" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);
