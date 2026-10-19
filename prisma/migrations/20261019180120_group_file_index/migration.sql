-- CreateTable
CREATE TABLE "group_file_index" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bot_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "message_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "file_name" TEXT,
    "caption" TEXT,
    "mime_type" TEXT,
    "file_size" INTEGER,
    "file_id" TEXT,
    "sender_id" BIGINT,
    "sender_name" TEXT,
    "sent_at" TEXT,
    "search_text" TEXT NOT NULL,
    "created_at" TEXT,
    CONSTRAINT "group_file_index_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "group_file_index_bot_id_chat_id_idx" ON "group_file_index"("bot_id", "chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_file_index_bot_id_chat_id_message_id_key" ON "group_file_index"("bot_id", "chat_id", "message_id");
