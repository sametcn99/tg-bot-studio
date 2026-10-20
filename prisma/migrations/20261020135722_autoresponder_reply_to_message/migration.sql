-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_autoresponders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bot_id" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "response_text" TEXT NOT NULL,
    "media_url" TEXT,
    "buttons_json" TEXT,
    "is_active" INTEGER NOT NULL DEFAULT 1,
    "chat_id" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'private',
    "match_mode" TEXT NOT NULL DEFAULT 'keyword',
    "admin_only" INTEGER NOT NULL DEFAULT 0,
    "repeat_seconds" INTEGER NOT NULL DEFAULT 0,
    "last_repeat_at" TEXT,
    "reply_to_message" INTEGER NOT NULL DEFAULT 0,
    "delete_previous_response" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "autoresponders_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_autoresponders" ("admin_only", "bot_id", "buttons_json", "chat_id", "command", "delete_previous_response", "id", "is_active", "last_repeat_at", "match_mode", "media_url", "repeat_seconds", "response_text", "scope") SELECT "admin_only", "bot_id", "buttons_json", "chat_id", "command", "delete_previous_response", "id", "is_active", "last_repeat_at", "match_mode", "media_url", "repeat_seconds", "response_text", "scope" FROM "autoresponders";
DROP TABLE "autoresponders";
ALTER TABLE "new_autoresponders" RENAME TO "autoresponders";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
