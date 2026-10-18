-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ai_chat_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bot_id" TEXT NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "latency_ms" INTEGER,
    "is_error" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "ai_chat_history_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ai_chat_history" ("bot_id", "completion_tokens", "content", "created_at", "id", "is_error", "latency_ms", "prompt_tokens", "role", "telegram_id") SELECT "bot_id", "completion_tokens", "content", "created_at", "id", "is_error", "latency_ms", "prompt_tokens", "role", "telegram_id" FROM "ai_chat_history";
DROP TABLE "ai_chat_history";
ALTER TABLE "new_ai_chat_history" RENAME TO "ai_chat_history";
CREATE INDEX "ai_chat_history_bot_id_telegram_id_idx" ON "ai_chat_history"("bot_id", "telegram_id");
CREATE TABLE "new_ai_knowledge_chunks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bot_id" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
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
CREATE TABLE "new_ai_knowledge_docs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bot_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "ai_knowledge_docs_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ai_knowledge_docs" ("bot_id", "content", "created_at", "id", "tags", "title") SELECT "bot_id", "content", "created_at", "id", "tags", "title" FROM "ai_knowledge_docs";
DROP TABLE "ai_knowledge_docs";
ALTER TABLE "new_ai_knowledge_docs" RENAME TO "ai_knowledge_docs";
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
    CONSTRAINT "autoresponders_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_autoresponders" ("admin_only", "bot_id", "buttons_json", "chat_id", "command", "id", "is_active", "last_repeat_at", "match_mode", "media_url", "repeat_seconds", "response_text", "scope") SELECT "admin_only", "bot_id", "buttons_json", "chat_id", "command", "id", "is_active", "last_repeat_at", "match_mode", "media_url", "repeat_seconds", "response_text", "scope" FROM "autoresponders";
DROP TABLE "autoresponders";
ALTER TABLE "new_autoresponders" RENAME TO "autoresponders";
CREATE TABLE "new_blocked_users" (
    "bot_id" TEXT NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "username" TEXT,
    "first_name" TEXT,
    "reason" TEXT,
    "blocked_at" TEXT,

    PRIMARY KEY ("bot_id", "telegram_id"),
    CONSTRAINT "blocked_users_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_blocked_users" ("blocked_at", "bot_id", "first_name", "reason", "telegram_id", "username") SELECT "blocked_at", "bot_id", "first_name", "reason", "telegram_id", "username" FROM "blocked_users";
DROP TABLE "blocked_users";
ALTER TABLE "new_blocked_users" RENAME TO "blocked_users";
CREATE TABLE "new_bot_groups" (
    "bot_id" TEXT NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "member_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" INTEGER NOT NULL DEFAULT 1,
    "created_at" TEXT,

    PRIMARY KEY ("bot_id", "chat_id"),
    CONSTRAINT "bot_groups_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_bot_groups" ("bot_id", "chat_id", "created_at", "is_active", "member_count", "title", "type") SELECT "bot_id", "chat_id", "created_at", "is_active", "member_count", "title", "type" FROM "bot_groups";
DROP TABLE "bot_groups";
ALTER TABLE "new_bot_groups" RENAME TO "bot_groups";
CREATE TABLE "new_bot_modules" (
    "bot_id" TEXT NOT NULL,
    "module_key" TEXT NOT NULL,
    "is_enabled" INTEGER NOT NULL DEFAULT 0,
    "config_json" TEXT,

    PRIMARY KEY ("bot_id", "module_key"),
    CONSTRAINT "bot_modules_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_bot_modules" ("bot_id", "config_json", "is_enabled", "module_key") SELECT "bot_id", "config_json", "is_enabled", "module_key" FROM "bot_modules";
DROP TABLE "bot_modules";
ALTER TABLE "new_bot_modules" RENAME TO "bot_modules";
CREATE TABLE "new_bot_settings" (
    "bot_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    PRIMARY KEY ("bot_id", "key"),
    CONSTRAINT "bot_settings_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_bot_settings" ("bot_id", "key", "value") SELECT "bot_id", "key", "value" FROM "bot_settings";
DROP TABLE "bot_settings";
ALTER TABLE "new_bot_settings" RENAME TO "bot_settings";
CREATE TABLE "new_bot_templates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "bundle_json" TEXT NOT NULL,
    "source_bot_name" TEXT,
    "created_at" TEXT
);
INSERT INTO "new_bot_templates" ("bundle_json", "created_at", "description", "id", "name", "source_bot_name") SELECT "bundle_json", "created_at", "description", "id", "name", "source_bot_name" FROM "bot_templates";
DROP TABLE "bot_templates";
ALTER TABLE "new_bot_templates" RENAME TO "bot_templates";
CREATE TABLE "new_bot_users" (
    "bot_id" TEXT NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "username" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "language_code" TEXT DEFAULT 'en',
    "points" INTEGER NOT NULL DEFAULT 0,
    "referrer_id" BIGINT,
    "tags_json" TEXT,
    "first_seen_at" TEXT,
    "last_seen_at" TEXT,

    PRIMARY KEY ("bot_id", "telegram_id"),
    CONSTRAINT "bot_users_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_bot_users" ("bot_id", "first_name", "first_seen_at", "language_code", "last_name", "last_seen_at", "points", "referrer_id", "tags_json", "telegram_id", "username") SELECT "bot_id", "first_name", "first_seen_at", "language_code", "last_name", "last_seen_at", "points", "referrer_id", "tags_json", "telegram_id", "username" FROM "bot_users";
DROP TABLE "bot_users";
ALTER TABLE "new_bot_users" RENAME TO "bot_users";
CREATE TABLE "new_bots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "username" TEXT,
    "first_name" TEXT,
    "is_active" INTEGER NOT NULL DEFAULT 1,
    "created_at" TEXT,
    "updated_at" TEXT
);
INSERT INTO "new_bots" ("created_at", "first_name", "id", "is_active", "name", "token", "updated_at", "username") SELECT "created_at", "first_name", "id", "is_active", "name", "token", "updated_at", "username" FROM "bots";
DROP TABLE "bots";
ALTER TABLE "new_bots" RENAME TO "bots";
CREATE UNIQUE INDEX "bots_token_key" ON "bots"("token");
CREATE TABLE "new_broadcasts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bot_id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "message_text" TEXT NOT NULL,
    "media_url" TEXT,
    "buttons_json" TEXT,
    "target_filter_json" TEXT,
    "total_recipients" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "sent_cursor" BIGINT,
    "experiment_id" TEXT,
    "variant_label" TEXT,
    "phase" TEXT,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT,
    CONSTRAINT "broadcasts_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_broadcasts" ("bot_id", "buttons_json", "clicks", "created_at", "experiment_id", "failed_count", "id", "media_url", "message_text", "phase", "sent_cursor", "status", "success_count", "target_filter_json", "target_type", "total_recipients", "variant_label") SELECT "bot_id", "buttons_json", "clicks", "created_at", "experiment_id", "failed_count", "id", "media_url", "message_text", "phase", "sent_cursor", "status", "success_count", "target_filter_json", "target_type", "total_recipients", "variant_label" FROM "broadcasts";
DROP TABLE "broadcasts";
ALTER TABLE "new_broadcasts" RENAME TO "broadcasts";
CREATE INDEX "broadcasts_bot_id_experiment_id_idx" ON "broadcasts"("bot_id", "experiment_id");
CREATE INDEX "broadcasts_bot_id_status_idx" ON "broadcasts"("bot_id", "status");
CREATE TABLE "new_chat_activity" (
    "bot_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "day" TEXT NOT NULL,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "reply_count" INTEGER NOT NULL DEFAULT 0,
    "media_count" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("bot_id", "chat_id", "telegram_id", "day"),
    CONSTRAINT "chat_activity_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_chat_activity" ("bot_id", "chat_id", "day", "media_count", "message_count", "reply_count", "telegram_id") SELECT "bot_id", "chat_id", "day", "media_count", "message_count", "reply_count", "telegram_id" FROM "chat_activity";
DROP TABLE "chat_activity";
ALTER TABLE "new_chat_activity" RENAME TO "chat_activity";
CREATE TABLE "new_chat_approvals" (
    "bot_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "reason" TEXT,
    "approved_at" TEXT,

    PRIMARY KEY ("bot_id", "chat_id", "telegram_id"),
    CONSTRAINT "chat_approvals_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_chat_approvals" ("approved_at", "bot_id", "chat_id", "reason", "telegram_id") SELECT "approved_at", "bot_id", "chat_id", "reason", "telegram_id" FROM "chat_approvals";
DROP TABLE "chat_approvals";
ALTER TABLE "new_chat_approvals" RENAME TO "chat_approvals";
CREATE TABLE "new_chat_connections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bot_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "username" TEXT,
    "is_active" INTEGER NOT NULL DEFAULT 1,
    "created_at" TEXT,
    CONSTRAINT "chat_connections_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_chat_connections" ("bot_id", "chat_id", "created_at", "id", "is_active", "title", "type", "username") SELECT "bot_id", "chat_id", "created_at", "id", "is_active", "title", "type", "username" FROM "chat_connections";
DROP TABLE "chat_connections";
ALTER TABLE "new_chat_connections" RENAME TO "chat_connections";
CREATE UNIQUE INDEX "chat_connections_bot_id_chat_id_key" ON "chat_connections"("bot_id", "chat_id");
CREATE TABLE "new_chat_member_state" (
    "bot_id" TEXT NOT NULL,
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
INSERT INTO "new_chat_member_state" ("bot_id", "captcha_verified", "chat_id", "data_json", "muted_until", "strikes", "telegram_id", "updated_at") SELECT "bot_id", "captcha_verified", "chat_id", "data_json", "muted_until", "strikes", "telegram_id", "updated_at" FROM "chat_member_state";
DROP TABLE "chat_member_state";
ALTER TABLE "new_chat_member_state" RENAME TO "chat_member_state";
CREATE TABLE "new_chat_module_settings" (
    "bot_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "module_key" TEXT NOT NULL,
    "config_json" TEXT NOT NULL,

    PRIMARY KEY ("bot_id", "chat_id", "module_key"),
    CONSTRAINT "chat_module_settings_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_chat_module_settings" ("bot_id", "chat_id", "config_json", "module_key") SELECT "bot_id", "chat_id", "config_json", "module_key" FROM "chat_module_settings";
DROP TABLE "chat_module_settings";
ALTER TABLE "new_chat_module_settings" RENAME TO "chat_module_settings";
CREATE TABLE "new_chat_warns" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bot_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TEXT,
    CONSTRAINT "chat_warns_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_chat_warns" ("bot_id", "chat_id", "created_at", "id", "reason", "telegram_id") SELECT "bot_id", "chat_id", "created_at", "id", "reason", "telegram_id" FROM "chat_warns";
DROP TABLE "chat_warns";
ALTER TABLE "new_chat_warns" RENAME TO "chat_warns";
CREATE INDEX "chat_warns_bot_id_chat_id_telegram_id_idx" ON "chat_warns"("bot_id", "chat_id", "telegram_id");
CREATE TABLE "new_drip_campaigns" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bot_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "steps_json" TEXT NOT NULL,
    "is_active" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "drip_campaigns_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_drip_campaigns" ("bot_id", "id", "is_active", "name", "steps_json") SELECT "bot_id", "id", "is_active", "name", "steps_json" FROM "drip_campaigns";
DROP TABLE "drip_campaigns";
ALTER TABLE "new_drip_campaigns" RENAME TO "drip_campaigns";
CREATE TABLE "new_drip_subscribers" (
    "bot_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "next_run_at" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("campaign_id", "telegram_id"),
    CONSTRAINT "drip_subscribers_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "drip_subscribers_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "drip_campaigns" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_drip_subscribers" ("attempts", "bot_id", "campaign_id", "current_step", "next_run_at", "telegram_id") SELECT "attempts", "bot_id", "campaign_id", "current_step", "next_run_at", "telegram_id" FROM "drip_subscribers";
DROP TABLE "drip_subscribers";
ALTER TABLE "new_drip_subscribers" RENAME TO "drip_subscribers";
CREATE INDEX "drip_subscribers_next_run_at_idx" ON "drip_subscribers"("next_run_at");
CREATE TABLE "new_fed_chats" (
    "fed_id" TEXT NOT NULL,
    "bot_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "quiet" INTEGER NOT NULL DEFAULT 0,
    "joined_at" TEXT,

    PRIMARY KEY ("fed_id", "bot_id", "chat_id"),
    CONSTRAINT "fed_chats_fed_id_fkey" FOREIGN KEY ("fed_id") REFERENCES "feds" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fed_chats_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_fed_chats" ("bot_id", "chat_id", "fed_id", "joined_at", "quiet") SELECT "bot_id", "chat_id", "fed_id", "joined_at", "quiet" FROM "fed_chats";
DROP TABLE "fed_chats";
ALTER TABLE "new_fed_chats" RENAME TO "fed_chats";
CREATE TABLE "new_feds" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "owner_telegram_id" BIGINT NOT NULL,
    "owner_bot_id" TEXT NOT NULL,
    "log_chat_id" BIGINT,
    "fed_reason_required" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT
);
INSERT INTO "new_feds" ("created_at", "fed_reason_required", "id", "log_chat_id", "name", "owner_bot_id", "owner_telegram_id") SELECT "created_at", "fed_reason_required", "id", "log_chat_id", "name", "owner_bot_id", "owner_telegram_id" FROM "feds";
DROP TABLE "feds";
ALTER TABLE "new_feds" RENAME TO "feds";
CREATE TABLE "new_flow_states" (
    "bot_id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
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
INSERT INTO "new_flow_states" ("bot_id", "flow_id", "node_id", "resume_at", "telegram_id", "updated_at", "vars_json", "wait_input") SELECT "bot_id", "flow_id", "node_id", "resume_at", "telegram_id", "updated_at", "vars_json", "wait_input" FROM "flow_states";
DROP TABLE "flow_states";
ALTER TABLE "new_flow_states" RENAME TO "flow_states";
CREATE INDEX "flow_states_bot_id_telegram_id_idx" ON "flow_states"("bot_id", "telegram_id");
CREATE INDEX "flow_states_resume_at_idx" ON "flow_states"("resume_at");
CREATE TABLE "new_flows" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bot_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger_type" TEXT NOT NULL DEFAULT 'command',
    "trigger_value" TEXT NOT NULL DEFAULT '',
    "graph_json" TEXT NOT NULL,
    "is_active" INTEGER NOT NULL DEFAULT 1,
    "created_at" TEXT,
    "updated_at" TEXT,
    CONSTRAINT "flows_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_flows" ("bot_id", "created_at", "graph_json", "id", "is_active", "name", "trigger_type", "trigger_value", "updated_at") SELECT "bot_id", "created_at", "graph_json", "id", "is_active", "name", "trigger_type", "trigger_value", "updated_at" FROM "flows";
DROP TABLE "flows";
ALTER TABLE "new_flows" RENAME TO "flows";
CREATE INDEX "flows_bot_id_idx" ON "flows"("bot_id");
CREATE TABLE "new_giveaways" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bot_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "required_channels_json" TEXT,
    "winners_count" INTEGER NOT NULL DEFAULT 1,
    "prize_details" TEXT,
    "ends_at" TEXT,
    "status" TEXT NOT NULL,
    CONSTRAINT "giveaways_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_giveaways" ("bot_id", "ends_at", "id", "prize_details", "required_channels_json", "status", "title", "winners_count") SELECT "bot_id", "ends_at", "id", "prize_details", "required_channels_json", "status", "title", "winners_count" FROM "giveaways";
DROP TABLE "giveaways";
ALTER TABLE "new_giveaways" RENAME TO "giveaways";
CREATE TABLE "new_health_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bot_id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "reason" TEXT,
    "message" TEXT NOT NULL,
    "notified" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT,
    CONSTRAINT "health_events_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_health_events" ("bot_id", "created_at", "id", "level", "message", "notified", "reason") SELECT "bot_id", "created_at", "id", "level", "message", "notified", "reason" FROM "health_events";
DROP TABLE "health_events";
ALTER TABLE "new_health_events" RENAME TO "health_events";
CREATE INDEX "health_events_bot_id_created_at_idx" ON "health_events"("bot_id", "created_at");
CREATE TABLE "new_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bot_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "is_active" INTEGER NOT NULL DEFAULT 1,
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT,
    CONSTRAINT "links_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_links" ("bot_id", "click_count", "created_at", "description", "id", "is_active", "order_index", "title", "type", "url") SELECT "bot_id", "click_count", "created_at", "description", "id", "is_active", "order_index", "title", "type", "url" FROM "links";
DROP TABLE "links";
ALTER TABLE "new_links" RENAME TO "links";
CREATE INDEX "links_bot_id_title_idx" ON "links"("bot_id", "title");
CREATE TABLE "new_media_assets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bot_id" TEXT NOT NULL,
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
INSERT INTO "new_media_assets" ("bot_id", "created_at", "file_size", "id", "kind", "mime_type", "name", "source", "tags", "value") SELECT "bot_id", "created_at", "file_size", "id", "kind", "mime_type", "name", "source", "tags", "value" FROM "media_assets";
DROP TABLE "media_assets";
ALTER TABLE "new_media_assets" RENAME TO "media_assets";
CREATE INDEX "media_assets_bot_id_idx" ON "media_assets"("bot_id");
CREATE TABLE "new_mini_app_orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bot_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "total_amount" REAL NOT NULL,
    "currency" TEXT NOT NULL,
    "items_json" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TEXT,
    CONSTRAINT "mini_app_orders_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mini_app_orders_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "mini_apps" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_mini_app_orders" ("app_id", "bot_id", "created_at", "currency", "id", "items_json", "status", "telegram_id", "total_amount") SELECT "app_id", "bot_id", "created_at", "currency", "id", "items_json", "status", "telegram_id", "total_amount" FROM "mini_app_orders";
DROP TABLE "mini_app_orders";
ALTER TABLE "new_mini_app_orders" RENAME TO "mini_app_orders";
CREATE TABLE "new_mini_apps" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bot_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "template_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "icon_url" TEXT,
    "config_json" TEXT,
    "theme_json" TEXT,
    "is_active" INTEGER NOT NULL DEFAULT 1,
    "created_at" TEXT,
    "updated_at" TEXT,
    CONSTRAINT "mini_apps_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_mini_apps" ("bot_id", "config_json", "created_at", "description", "icon_url", "id", "is_active", "name", "slug", "template_type", "theme_json", "title", "updated_at") SELECT "bot_id", "config_json", "created_at", "description", "icon_url", "id", "is_active", "name", "slug", "template_type", "theme_json", "title", "updated_at" FROM "mini_apps";
DROP TABLE "mini_apps";
ALTER TABLE "new_mini_apps" RENAME TO "mini_apps";
CREATE UNIQUE INDEX "mini_apps_slug_key" ON "mini_apps"("slug");
CREATE TABLE "new_scheduled_posts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bot_id" TEXT NOT NULL,
    "target_chat_id" TEXT NOT NULL,
    "message_text" TEXT NOT NULL,
    "media_url" TEXT,
    "buttons_json" TEXT,
    "scheduled_at" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    CONSTRAINT "scheduled_posts_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_scheduled_posts" ("bot_id", "buttons_json", "id", "media_url", "message_text", "scheduled_at", "status", "target_chat_id") SELECT "bot_id", "buttons_json", "id", "media_url", "message_text", "scheduled_at", "status", "target_chat_id" FROM "scheduled_posts";
DROP TABLE "scheduled_posts";
ALTER TABLE "new_scheduled_posts" RENAME TO "scheduled_posts";
CREATE INDEX "scheduled_posts_status_scheduled_at_idx" ON "scheduled_posts"("status", "scheduled_at");
CREATE TABLE "new_score_schedules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bot_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chat_ids_json" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'weekly',
    "frequency" TEXT NOT NULL DEFAULT 'weekly',
    "time_of_day" TEXT DEFAULT '18:00',
    "day_of_week" INTEGER DEFAULT 1,
    "run_at" TEXT NOT NULL,
    "top_limit" INTEGER NOT NULL DEFAULT 10,
    "header_text" TEXT,
    "row_template" TEXT,
    "footer_text" TEXT,
    "parse_mode" TEXT DEFAULT 'HTML',
    "medals" INTEGER NOT NULL DEFAULT 1,
    "disable_notification" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_run_at" TEXT,
    "last_result" TEXT,
    "created_at" TEXT,
    CONSTRAINT "score_schedules_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_score_schedules" ("bot_id", "chat_ids_json", "created_at", "day_of_week", "disable_notification", "footer_text", "frequency", "header_text", "id", "last_result", "last_run_at", "medals", "name", "parse_mode", "period", "row_template", "run_at", "status", "time_of_day", "top_limit") SELECT "bot_id", "chat_ids_json", "created_at", "day_of_week", "disable_notification", "footer_text", "frequency", "header_text", "id", "last_result", "last_run_at", "medals", "name", "parse_mode", "period", "row_template", "run_at", "status", "time_of_day", "top_limit" FROM "score_schedules";
DROP TABLE "score_schedules";
ALTER TABLE "new_score_schedules" RENAME TO "score_schedules";
CREATE TABLE "new_security_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "event" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "details" TEXT,
    "created_at" TEXT
);
INSERT INTO "new_security_logs" ("created_at", "details", "event", "id", "ip", "user_agent") SELECT "created_at", "details", "event", "id", "ip", "user_agent" FROM "security_logs";
DROP TABLE "security_logs";
ALTER TABLE "new_security_logs" RENAME TO "security_logs";
CREATE TABLE "new_support_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bot_id" TEXT NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "user_message_id" INTEGER,
    "admin_chat_id" BIGINT,
    "forum_topic_id" INTEGER,
    "direction" TEXT NOT NULL,
    "sender_name" TEXT,
    "message_text" TEXT,
    "media_type" TEXT,
    "created_at" TEXT,
    CONSTRAINT "support_messages_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_support_messages" ("admin_chat_id", "bot_id", "created_at", "direction", "forum_topic_id", "id", "media_type", "message_text", "sender_name", "telegram_id", "user_message_id") SELECT "admin_chat_id", "bot_id", "created_at", "direction", "forum_topic_id", "id", "media_type", "message_text", "sender_name", "telegram_id", "user_message_id" FROM "support_messages";
DROP TABLE "support_messages";
ALTER TABLE "new_support_messages" RENAME TO "support_messages";
CREATE INDEX "support_messages_bot_id_idx" ON "support_messages"("bot_id");
CREATE TABLE "new_vip_subscriptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bot_id" TEXT NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "channel_id" BIGINT NOT NULL,
    "expires_at" TEXT NOT NULL,
    "is_active" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "vip_subscriptions_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_vip_subscriptions" ("bot_id", "channel_id", "expires_at", "id", "is_active", "telegram_id") SELECT "bot_id", "channel_id", "expires_at", "id", "is_active", "telegram_id" FROM "vip_subscriptions";
DROP TABLE "vip_subscriptions";
ALTER TABLE "new_vip_subscriptions" RENAME TO "vip_subscriptions";
CREATE INDEX "vip_subscriptions_is_active_expires_at_idx" ON "vip_subscriptions"("is_active", "expires_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

