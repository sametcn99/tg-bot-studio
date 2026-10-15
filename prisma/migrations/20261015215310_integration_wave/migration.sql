-- CreateTable
CREATE TABLE "media_assets" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bot_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'url',
    "value" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'photo',
    "mime_type" TEXT,
    "file_size" INTEGER,
    "tags" TEXT,
    "created_at" TEXT,
    CONSTRAINT "media_assets_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "flows" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bot_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "trigger_type" TEXT NOT NULL DEFAULT 'command',
    "trigger_value" TEXT NOT NULL DEFAULT '',
    "graph_json" TEXT NOT NULL,
    "is_active" INTEGER NOT NULL DEFAULT 1,
    "created_at" TEXT,
    "updated_at" TEXT,
    CONSTRAINT "flows_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "flow_states" (
    "bot_id" INTEGER NOT NULL,
    "flow_id" INTEGER NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "node_id" TEXT NOT NULL,
    "wait_input" INTEGER NOT NULL DEFAULT 0,
    "vars_json" TEXT,
    "resume_at" TEXT,
    "updated_at" TEXT,

    PRIMARY KEY ("flow_id", "telegram_id"),
    CONSTRAINT "flow_states_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "flow_states_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "health_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bot_id" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "reason" TEXT,
    "message" TEXT NOT NULL,
    "notified" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT,
    CONSTRAINT "health_events_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "bot_templates" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "bundle_json" TEXT NOT NULL,
    "source_bot_name" TEXT,
    "created_at" TEXT
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_broadcasts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bot_id" INTEGER NOT NULL,
    "target_type" TEXT NOT NULL,
    "message_text" TEXT NOT NULL,
    "media_url" TEXT,
    "buttons_json" TEXT,
    "total_recipients" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "experiment_id" TEXT,
    "variant_label" TEXT,
    "phase" TEXT,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT,
    CONSTRAINT "broadcasts_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_broadcasts" ("bot_id", "buttons_json", "created_at", "failed_count", "id", "media_url", "message_text", "status", "success_count", "target_type", "total_recipients") SELECT "bot_id", "buttons_json", "created_at", "failed_count", "id", "media_url", "message_text", "status", "success_count", "target_type", "total_recipients" FROM "broadcasts";
DROP TABLE "broadcasts";
ALTER TABLE "new_broadcasts" RENAME TO "broadcasts";
CREATE INDEX "broadcasts_bot_id_experiment_id_idx" ON "broadcasts"("bot_id", "experiment_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "media_assets_bot_id_idx" ON "media_assets"("bot_id");

-- CreateIndex
CREATE INDEX "flows_bot_id_idx" ON "flows"("bot_id");

-- CreateIndex
CREATE INDEX "health_events_bot_id_created_at_idx" ON "health_events"("bot_id", "created_at");
