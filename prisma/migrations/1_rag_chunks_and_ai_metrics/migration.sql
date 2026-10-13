-- Semantic RAG chunks + AI request metrics.

-- CreateTable
CREATE TABLE "ai_knowledge_chunks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bot_id" INTEGER NOT NULL,
    "doc_id" INTEGER NOT NULL,
    "idx" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "vector_json" TEXT,
    "created_at" TEXT,
    CONSTRAINT "ai_knowledge_chunks_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_knowledge_chunks_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "ai_knowledge_docs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineIndexes
CREATE INDEX "ai_knowledge_chunks_bot_id_idx" ON "ai_knowledge_chunks"("bot_id");
CREATE INDEX "ai_knowledge_chunks_doc_id_idx" ON "ai_knowledge_chunks"("doc_id");

-- AlterTable: AI request metrics on chat history
ALTER TABLE "ai_chat_history" ADD COLUMN "prompt_tokens" INTEGER;
ALTER TABLE "ai_chat_history" ADD COLUMN "completion_tokens" INTEGER;
ALTER TABLE "ai_chat_history" ADD COLUMN "latency_ms" INTEGER;
ALTER TABLE "ai_chat_history" ADD COLUMN "is_error" BOOLEAN NOT NULL DEFAULT false;
