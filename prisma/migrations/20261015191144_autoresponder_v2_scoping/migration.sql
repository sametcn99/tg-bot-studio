-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_autoresponders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bot_id" INTEGER NOT NULL,
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
    CONSTRAINT "autoresponders_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_autoresponders" ("bot_id", "buttons_json", "command", "id", "is_active", "media_url", "response_text") SELECT "bot_id", "buttons_json", "command", "id", "is_active", "media_url", "response_text" FROM "autoresponders";
DROP TABLE "autoresponders";
ALTER TABLE "new_autoresponders" RENAME TO "autoresponders";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
