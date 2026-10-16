-- AlterTable
ALTER TABLE "broadcasts" ADD COLUMN "sent_cursor" BIGINT;
ALTER TABLE "broadcasts" ADD COLUMN "target_filter_json" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_drip_subscribers" (
    "bot_id" INTEGER NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "next_run_at" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("campaign_id", "telegram_id"),
    CONSTRAINT "drip_subscribers_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "drip_subscribers_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "drip_campaigns" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_drip_subscribers" ("bot_id", "campaign_id", "current_step", "next_run_at", "telegram_id") SELECT "bot_id", "campaign_id", "current_step", "next_run_at", "telegram_id" FROM "drip_subscribers";
DROP TABLE "drip_subscribers";
ALTER TABLE "new_drip_subscribers" RENAME TO "drip_subscribers";
CREATE INDEX "drip_subscribers_next_run_at_idx" ON "drip_subscribers"("next_run_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ai_chat_history_bot_id_telegram_id_idx" ON "ai_chat_history"("bot_id", "telegram_id");

-- CreateIndex
CREATE INDEX "broadcasts_bot_id_status_idx" ON "broadcasts"("bot_id", "status");

-- CreateIndex
CREATE INDEX "flow_states_bot_id_telegram_id_idx" ON "flow_states"("bot_id", "telegram_id");

-- CreateIndex
CREATE INDEX "flow_states_resume_at_idx" ON "flow_states"("resume_at");

-- CreateIndex
CREATE INDEX "links_bot_id_title_idx" ON "links"("bot_id", "title");

-- CreateIndex
CREATE INDEX "scheduled_posts_status_scheduled_at_idx" ON "scheduled_posts"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "sessions_last_active_at_idx" ON "sessions"("last_active_at");

-- CreateIndex
CREATE INDEX "support_messages_bot_id_idx" ON "support_messages"("bot_id");

-- CreateIndex
CREATE INDEX "vip_subscriptions_is_active_expires_at_idx" ON "vip_subscriptions"("is_active", "expires_at");

