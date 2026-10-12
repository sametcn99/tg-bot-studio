/**
 * SQLite schema migrations for the Studio database.
 *
 * Every statement is idempotent (`CREATE TABLE IF NOT EXISTS`) and matches the
 * platform DDL specification. All bot-scoped tables are isolated by `bot_id`.
 * @module database/migrations
 */

/**
 * Ordered list of schema DDL statements executed on every application boot.
 * @type {readonly string[]}
 */
export const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS bots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT,
    updated_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS bot_modules (
    bot_id INTEGER NOT NULL,
    module_key TEXT NOT NULL,
    is_enabled INTEGER DEFAULT 0,
    config_json TEXT,
    PRIMARY KEY (bot_id, module_key)
  )`,

  `CREATE TABLE IF NOT EXISTS mini_apps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    template_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    icon_url TEXT,
    config_json TEXT,
    theme_json TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT,
    updated_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS mini_app_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id INTEGER NOT NULL,
    app_id INTEGER NOT NULL,
    telegram_id INTEGER NOT NULL,
    total_amount REAL NOT NULL,
    currency TEXT NOT NULL,
    items_json TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS bot_settings (
    bot_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (bot_id, key)
  )`,

  `CREATE TABLE IF NOT EXISTS bot_users (
    bot_id INTEGER NOT NULL,
    telegram_id INTEGER NOT NULL,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    language_code TEXT DEFAULT 'en',
    points INTEGER DEFAULT 0,
    referrer_id INTEGER,
    tags_json TEXT,
    first_seen_at TEXT,
    last_seen_at TEXT,
    PRIMARY KEY (bot_id, telegram_id)
  )`,

  `CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    url TEXT NOT NULL,
    type TEXT NOT NULL,
    order_index INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    click_count INTEGER DEFAULT 0,
    created_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS broadcasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id INTEGER NOT NULL,
    target_type TEXT NOT NULL,
    message_text TEXT NOT NULL,
    media_url TEXT,
    buttons_json TEXT,
    total_recipients INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    status TEXT NOT NULL,
    created_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS support_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id INTEGER NOT NULL,
    telegram_id INTEGER NOT NULL,
    user_message_id INTEGER,
    admin_chat_id INTEGER,
    forum_topic_id INTEGER,
    direction TEXT NOT NULL,
    sender_name TEXT,
    message_text TEXT,
    media_type TEXT,
    created_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS drip_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    steps_json TEXT NOT NULL,
    is_active INTEGER DEFAULT 1
  )`,

  `CREATE TABLE IF NOT EXISTS drip_subscribers (
    bot_id INTEGER NOT NULL,
    campaign_id INTEGER NOT NULL,
    telegram_id INTEGER NOT NULL,
    current_step INTEGER DEFAULT 0,
    next_run_at TEXT,
    PRIMARY KEY (campaign_id, telegram_id)
  )`,

  `CREATE TABLE IF NOT EXISTS giveaways (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    required_channels_json TEXT,
    winners_count INTEGER DEFAULT 1,
    prize_details TEXT,
    ends_at TEXT,
    status TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS scheduled_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id INTEGER NOT NULL,
    target_chat_id INTEGER NOT NULL,
    message_text TEXT NOT NULL,
    media_url TEXT,
    buttons_json TEXT,
    scheduled_at TEXT NOT NULL,
    status TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS blocked_users (
    bot_id INTEGER NOT NULL,
    telegram_id INTEGER NOT NULL,
    username TEXT,
    first_name TEXT,
    reason TEXT,
    blocked_at TEXT,
    PRIMARY KEY (bot_id, telegram_id)
  )`,

  `CREATE TABLE IF NOT EXISTS bot_groups (
    bot_id INTEGER NOT NULL,
    chat_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    member_count INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT,
    PRIMARY KEY (bot_id, chat_id)
  )`,

  `CREATE TABLE IF NOT EXISTS chat_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id INTEGER NOT NULL,
    chat_id TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    username TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT,
    UNIQUE (bot_id, chat_id)
  )`,

  `CREATE TABLE IF NOT EXISTS autoresponders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id INTEGER NOT NULL,
    command TEXT NOT NULL,
    response_text TEXT NOT NULL,
    media_url TEXT,
    buttons_json TEXT,
    is_active INTEGER DEFAULT 1
  )`,

  `CREATE TABLE IF NOT EXISTS vip_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id INTEGER NOT NULL,
    telegram_id INTEGER NOT NULL,
    channel_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    is_active INTEGER DEFAULT 1
  )`,

  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    ip TEXT NOT NULL,
    user_agent TEXT,
    browser TEXT NOT NULL,
    os TEXT NOT NULL,
    device_type TEXT NOT NULL,
    created_at TEXT,
    last_active_at TEXT,
    is_revoked INTEGER DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS security_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    details TEXT,
    created_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  // 2026-10: the "Directory & Chat Folder Hub" (links) module became the
  // consolidated "Start Menu" module — remap stored toggles and configs.
  `UPDATE bot_modules SET module_key = 'start-menu' WHERE module_key = 'links'`,
];
