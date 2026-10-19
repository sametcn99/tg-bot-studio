-- CreateTable
CREATE TABLE "scan_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bot_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "label" TEXT,
    "username" TEXT,
    "firstName" TEXT,
    "session_enc" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_used_at" TEXT,
    "created_at" TEXT,
    "updated_at" TEXT,
    CONSTRAINT "scan_accounts_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "scan_accounts_bot_id_idx" ON "scan_accounts"("bot_id");

-- CreateIndex
CREATE UNIQUE INDEX "scan_accounts_bot_id_phone_key" ON "scan_accounts"("bot_id", "phone");
