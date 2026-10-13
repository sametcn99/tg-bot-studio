-- CreateTable
CREATE TABLE "bots" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "username" TEXT,
    "first_name" TEXT,
    "is_active" INTEGER NOT NULL DEFAULT 1,
    "created_at" TEXT,
    "updated_at" TEXT
);

-- CreateTable
CREATE TABLE "bot_modules" (
    "bot_id" INTEGER NOT NULL,
    "module_key" TEXT NOT NULL,
    "is_enabled" INTEGER NOT NULL DEFAULT 0,
    "config_json" TEXT,

    PRIMARY KEY ("bot_id", "module_key"),
    CONSTRAINT "bot_modules_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "mini_apps" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bot_id" INTEGER NOT NULL,
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

-- CreateTable
CREATE TABLE "mini_app_orders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bot_id" INTEGER NOT NULL,
    "app_id" INTEGER NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "total_amount" REAL NOT NULL,
    "currency" TEXT NOT NULL,
    "items_json" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TEXT,
    CONSTRAINT "mini_app_orders_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mini_app_orders_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "mini_apps" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "bot_settings" (
    "bot_id" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    PRIMARY KEY ("bot_id", "key"),
    CONSTRAINT "bot_settings_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "bot_users" (
    "bot_id" INTEGER NOT NULL,
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

-- CreateTable
CREATE TABLE "links" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bot_id" INTEGER NOT NULL,
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

-- CreateTable
CREATE TABLE "broadcasts" (
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
    "created_at" TEXT,
    CONSTRAINT "broadcasts_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bot_id" INTEGER NOT NULL,
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

-- CreateTable
CREATE TABLE "drip_campaigns" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bot_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "steps_json" TEXT NOT NULL,
    "is_active" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "drip_campaigns_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "drip_subscribers" (
    "bot_id" INTEGER NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "next_run_at" TEXT,

    PRIMARY KEY ("campaign_id", "telegram_id"),
    CONSTRAINT "drip_subscribers_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "drip_subscribers_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "drip_campaigns" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "giveaways" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bot_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "required_channels_json" TEXT,
    "winners_count" INTEGER NOT NULL DEFAULT 1,
    "prize_details" TEXT,
    "ends_at" TEXT,
    "status" TEXT NOT NULL,
    CONSTRAINT "giveaways_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "scheduled_posts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bot_id" INTEGER NOT NULL,
    "target_chat_id" TEXT NOT NULL,
    "message_text" TEXT NOT NULL,
    "media_url" TEXT,
    "buttons_json" TEXT,
    "scheduled_at" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    CONSTRAINT "scheduled_posts_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "blocked_users" (
    "bot_id" INTEGER NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "username" TEXT,
    "first_name" TEXT,
    "reason" TEXT,
    "blocked_at" TEXT,

    PRIMARY KEY ("bot_id", "telegram_id"),
    CONSTRAINT "blocked_users_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "bot_groups" (
    "bot_id" INTEGER NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "member_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" INTEGER NOT NULL DEFAULT 1,
    "created_at" TEXT,

    PRIMARY KEY ("bot_id", "chat_id"),
    CONSTRAINT "bot_groups_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chat_connections" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bot_id" INTEGER NOT NULL,
    "chat_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "username" TEXT,
    "is_active" INTEGER NOT NULL DEFAULT 1,
    "created_at" TEXT,
    CONSTRAINT "chat_connections_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "autoresponders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bot_id" INTEGER NOT NULL,
    "command" TEXT NOT NULL,
    "response_text" TEXT NOT NULL,
    "media_url" TEXT,
    "buttons_json" TEXT,
    "is_active" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "autoresponders_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "vip_subscriptions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bot_id" INTEGER NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "channel_id" BIGINT NOT NULL,
    "expires_at" TEXT NOT NULL,
    "is_active" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "vip_subscriptions_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ip" TEXT NOT NULL,
    "user_agent" TEXT,
    "browser" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "device_type" TEXT NOT NULL,
    "created_at" TEXT,
    "last_active_at" TEXT,
    "is_revoked" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "security_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "event" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "details" TEXT,
    "created_at" TEXT
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "chat_activity" (
    "bot_id" INTEGER NOT NULL,
    "chat_id" TEXT NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "day" TEXT NOT NULL,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "reply_count" INTEGER NOT NULL DEFAULT 0,
    "media_count" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("bot_id", "chat_id", "telegram_id", "day"),
    CONSTRAINT "chat_activity_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "score_schedules" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bot_id" INTEGER NOT NULL,
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

-- CreateTable
CREATE TABLE "ai_chat_history" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bot_id" INTEGER NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "ai_chat_history_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ai_knowledge_docs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bot_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "ai_knowledge_docs_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "bots_token_key" ON "bots"("token");

-- CreateIndex
CREATE UNIQUE INDEX "mini_apps_slug_key" ON "mini_apps"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "chat_connections_bot_id_chat_id_key" ON "chat_connections"("bot_id", "chat_id");

