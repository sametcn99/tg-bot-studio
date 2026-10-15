/*
  Warnings:

  - Made the column `created_at` on table `ai_knowledge_chunks` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateTable
CREATE TABLE "chat_module_settings" (
    "bot_id" INTEGER NOT NULL,
    "chat_id" TEXT NOT NULL,
    "module_key" TEXT NOT NULL,
    "config_json" TEXT NOT NULL,

    PRIMARY KEY ("bot_id", "chat_id", "module_key"),
    CONSTRAINT "chat_module_settings_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chat_member_state" (
    "bot_id" INTEGER NOT NULL,
    "chat_id" TEXT NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "strikes" INTEGER NOT NULL DEFAULT 0,
    "captcha_verified" INTEGER NOT NULL DEFAULT 0,
    "muted_until" TEXT,
    "data_json" TEXT,
    "updated_at" TEXT,

    PRIMARY KEY ("bot_id", "chat_id", "telegram_id"),
    CONSTRAINT "chat_member_state_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chat_warns" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bot_id" INTEGER NOT NULL,
    "chat_id" TEXT NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TEXT,
    CONSTRAINT "chat_warns_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chat_approvals" (
    "bot_id" INTEGER NOT NULL,
    "chat_id" TEXT NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "reason" TEXT,
    "approved_at" TEXT,

    PRIMARY KEY ("bot_id", "chat_id", "telegram_id"),
    CONSTRAINT "chat_approvals_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ai_knowledge_chunks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bot_id" INTEGER NOT NULL,
    "doc_id" INTEGER NOT NULL,
    "idx" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "vector_json" TEXT,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "ai_knowledge_chunks_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_knowledge_chunks_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "ai_knowledge_docs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ai_knowledge_chunks" ("bot_id", "content", "created_at", "doc_id", "id", "idx", "vector_json") SELECT "bot_id", "content", "created_at", "doc_id", "id", "idx", "vector_json" FROM "ai_knowledge_chunks";
DROP TABLE "ai_knowledge_chunks";
ALTER TABLE "new_ai_knowledge_chunks" RENAME TO "ai_knowledge_chunks";
CREATE INDEX "ai_knowledge_chunks_bot_id_idx" ON "ai_knowledge_chunks"("bot_id");
CREATE INDEX "ai_knowledge_chunks_doc_id_idx" ON "ai_knowledge_chunks"("doc_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "chat_warns_bot_id_chat_id_telegram_id_idx" ON "chat_warns"("bot_id", "chat_id", "telegram_id");
