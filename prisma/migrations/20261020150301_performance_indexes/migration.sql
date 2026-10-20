-- CreateIndex
CREATE INDEX "ai_chat_history_bot_id_created_at_idx" ON "ai_chat_history"("bot_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_knowledge_docs_bot_id_idx" ON "ai_knowledge_docs"("bot_id");

-- CreateIndex
CREATE INDEX "autoresponders_bot_id_idx" ON "autoresponders"("bot_id");

-- CreateIndex
CREATE INDEX "bot_users_bot_id_last_seen_at_idx" ON "bot_users"("bot_id", "last_seen_at");

-- CreateIndex
CREATE INDEX "bot_users_bot_id_points_idx" ON "bot_users"("bot_id", "points");

-- CreateIndex
CREATE INDEX "chat_activity_bot_id_chat_id_day_idx" ON "chat_activity"("bot_id", "chat_id", "day");

-- CreateIndex
CREATE INDEX "chat_activity_day_idx" ON "chat_activity"("day");

-- CreateIndex
CREATE INDEX "drip_campaigns_bot_id_idx" ON "drip_campaigns"("bot_id");

-- CreateIndex
CREATE INDEX "drip_subscribers_bot_id_telegram_id_idx" ON "drip_subscribers"("bot_id", "telegram_id");

-- CreateIndex
CREATE INDEX "fed_chats_bot_id_chat_id_idx" ON "fed_chats"("bot_id", "chat_id");

-- CreateIndex
CREATE INDEX "giveaways_bot_id_idx" ON "giveaways"("bot_id");

-- CreateIndex
CREATE INDEX "giveaways_status_ends_at_idx" ON "giveaways"("status", "ends_at");

-- CreateIndex
CREATE INDEX "mini_app_orders_bot_id_app_id_idx" ON "mini_app_orders"("bot_id", "app_id");

-- CreateIndex
CREATE INDEX "mini_app_orders_bot_id_telegram_id_created_at_idx" ON "mini_app_orders"("bot_id", "telegram_id", "created_at");

-- CreateIndex
CREATE INDEX "mini_apps_bot_id_idx" ON "mini_apps"("bot_id");

-- CreateIndex
CREATE INDEX "scheduled_posts_bot_id_idx" ON "scheduled_posts"("bot_id");

-- CreateIndex
CREATE INDEX "score_schedules_status_run_at_idx" ON "score_schedules"("status", "run_at");

-- CreateIndex
CREATE INDEX "score_schedules_bot_id_idx" ON "score_schedules"("bot_id");

-- CreateIndex
CREATE INDEX "support_messages_bot_id_telegram_id_created_at_idx" ON "support_messages"("bot_id", "telegram_id", "created_at");

-- CreateIndex
CREATE INDEX "support_messages_bot_id_created_at_idx" ON "support_messages"("bot_id", "created_at");

-- CreateIndex
CREATE INDEX "vip_subscriptions_bot_id_idx" ON "vip_subscriptions"("bot_id");
