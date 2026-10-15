-- CreateTable
CREATE TABLE "feds" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "owner_telegram_id" BIGINT NOT NULL,
    "owner_bot_id" INTEGER NOT NULL,
    "log_chat_id" BIGINT,
    "fed_reason_required" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT
);

-- CreateTable
CREATE TABLE "fed_bans" (
    "fed_id" TEXT NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "banned_by" BIGINT NOT NULL,
    "created_at" TEXT,

    PRIMARY KEY ("fed_id", "telegram_id"),
    CONSTRAINT "fed_bans_fed_id_fkey" FOREIGN KEY ("fed_id") REFERENCES "feds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "fed_admins" (
    "fed_id" TEXT NOT NULL,
    "telegram_id" BIGINT NOT NULL,

    PRIMARY KEY ("fed_id", "telegram_id"),
    CONSTRAINT "fed_admins_fed_id_fkey" FOREIGN KEY ("fed_id") REFERENCES "feds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "fed_chats" (
    "fed_id" TEXT NOT NULL,
    "bot_id" INTEGER NOT NULL,
    "chat_id" TEXT NOT NULL,
    "quiet" INTEGER NOT NULL DEFAULT 0,
    "joined_at" TEXT,

    PRIMARY KEY ("fed_id", "bot_id", "chat_id"),
    CONSTRAINT "fed_chats_fed_id_fkey" FOREIGN KEY ("fed_id") REFERENCES "feds" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fed_chats_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "fed_subs" (
    "fed_id" TEXT NOT NULL,
    "subscribed_fed_id" TEXT NOT NULL,

    PRIMARY KEY ("fed_id", "subscribed_fed_id"),
    CONSTRAINT "fed_subs_fed_id_fkey" FOREIGN KEY ("fed_id") REFERENCES "feds" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fed_subs_subscribed_fed_id_fkey" FOREIGN KEY ("subscribed_fed_id") REFERENCES "feds" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
