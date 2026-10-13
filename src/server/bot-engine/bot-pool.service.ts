import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Bot } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { DatabaseService } from '../database/database.service';
import { EngineHelpersService } from './engine-helpers.service';
import { ModuleHandlerRegistry } from './module-handler-registry';
import { findModule } from './module-registry';

/**
 * Bot row in the `bots` table.
 * @interface BotRow
 * @property {number} id - Studio bot identifier.
 * @property {string} name - Display name chosen by the operator.
 * @property {string} token - Telegram bot API token.
 * @property {string} username - Bot @username from getMe.
 * @property {number} is_active - 1 when the bot should be running.
 */
interface BotRow {
  id: number;
  name: string;
  token: string;
  username: string | null;
  first_name: string | null;
  is_active: number;
}

/**
 * Runtime state of a bot managed by the pool.
 * @interface BotRuntime
 * @property {Bot} bot - Live grammY instance.
 * @property {'starting'|'active'|'failed'|'stopped'} status - Poller health.
 */
interface BotRuntime {
  bot: Bot;
  status: 'starting' | 'active' | 'failed' | 'stopped';
}

/**
 * Multi-bot runtime pool. Loads every active bot on application bootstrap,
 * attaches engine middleware plus all enabled module handlers, and keeps
 * long polling alive with graceful shutdown on SIGTERM/SIGINT.
 */
@Injectable()
export class BotPoolService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BotPoolService.name);
  private readonly runtimes = new Map<number, BotRuntime>();
  private readonly volume = new Map<number, number>();
  private readonly discoveredChats = new Set<string>();
  private readonly volumeFlushTimer: ReturnType<typeof setInterval>;

  /**
   * @param {DatabaseService} db - SQLite access service.
   * @param {EngineHelpersService} helpers - Shared audience operations.
   * @param {ModuleHandlerRegistry} handlerRegistry - Registered module handlers.
   */
  constructor(
    private readonly db: DatabaseService,
    private readonly helpers: EngineHelpersService,
    private readonly handlerRegistry: ModuleHandlerRegistry,
  ) {
    // Persist in-memory message volume counters to bot_settings every 30s.
    this.volumeFlushTimer = setInterval(() => this.flushVolume(), 30_000);
  }

  /**
   * Starts every active bot after all modules have registered handlers.
   * @returns {Promise<void>} Resolves once all pollers have been launched.
   */
  async onApplicationBootstrap(): Promise<void> {
    const bots = this.db.query<BotRow>('SELECT * FROM bots WHERE is_active = 1');
    for (const bot of bots) {
      await this.startBot(bot);
    }
    this.logger.log(`Bot pool started with ${bots.length} active bot(s)`);
  }

  /**
   * Stops every poller and flushes volume counters on shutdown.
   * @returns {Promise<void>} Resolves once all bots stopped cleanly.
   */
  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.volumeFlushTimer);
    this.flushVolume();
    await Promise.allSettled(
      [...this.runtimes.values()].map((runtime) => runtime.bot.stop()),
    );
    this.logger.log('Bot pool shut down');
  }

  /**
   * Builds and launches a bot instance with engine + module middleware.
   * @param {BotRow} row - Database row of the bot.
   * @returns {Promise<void>} Resolves once the poller launched (not stopped).
   */
  private async startBot(row: BotRow): Promise<void> {
    try {
      this.stopExisting(row.id);
      const bot = new Bot(row.token);
      bot.api.config.use(autoRetry());
      bot.catch((error) => {
        this.logger.error(`Bot ${row.id} update error: ${error.message}`);
      });
      this.attachEngineMiddleware(bot, row.id);
      await this.attachModules(bot, row.id);
      await bot.init();

      this.runtimes.set(row.id, { bot, status: 'starting' });
      void bot
        .start({
          onStart: () => {
            const runtime = this.runtimes.get(row.id);
            if (runtime) runtime.status = 'active';
            this.logger.log(`Bot @${bot.botInfo?.username} polling started`);
          },
        })
        .catch((error: Error) => {
          const runtime = this.runtimes.get(row.id);
          if (runtime) runtime.status = 'failed';
          this.logger.error(`Bot ${row.id} polling failed: ${error.message}`);
        });
    } catch (error) {
      this.runtimes.set(row.id, {
        bot: new Bot(row.token),
        status: 'failed',
      });
      this.logger.error(
        `Bot ${row.id} failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Stops a running bot instance if present.
   * @param {number} botId - Studio bot identifier.
   * @returns {void}
   */
  private stopExisting(botId: number): void {
    const existing = this.runtimes.get(botId);
    if (existing) {
      void existing.bot.stop();
      this.runtimes.delete(botId);
    }
  }

  /**
   * Attaches engine-level middleware: audience upsert, volume counting,
   * group bookkeeping, and blocked-user filtering for private chats.
   * @param {Bot} bot - Target grammY instance.
   * @param {number} botId - Studio bot identifier.
   * @returns {void}
   */
  private attachEngineMiddleware(bot: Bot, botId: number): void {
    bot.use(async (ctx, next) => {
      if (ctx.from) {
        this.helpers.upsertUser(botId, ctx.from);
      }
      if (ctx.msg) {
        this.volume.set(botId, (this.volume.get(botId) ?? 0) + 1);
      }
      // Learn every group/supergroup/channel the bot operates in, including
      // chats it already belonged to before this boot (my_chat_member only
      // fires on membership changes). The Connections address book picks
      // these rows up through its auto-sync.
      const chat = ctx.chat;
      if (chat && (chat.type === 'group' || chat.type === 'supergroup' || chat.type === 'channel')) {
        const key = `${botId}:${chat.id}`;
        if (!this.discoveredChats.has(key)) {
          this.discoveredChats.add(key);
          this.db.run(
            `INSERT INTO bot_groups (bot_id, chat_id, title, type, member_count, is_active, created_at)
             VALUES (?, ?, ?, ?, 0, 1, ?)
             ON CONFLICT(bot_id, chat_id) DO UPDATE SET
               title = excluded.title, type = excluded.type, is_active = 1`,
            botId,
            chat.id,
            chat.title || String(chat.id),
            chat.type,
            new Date().toISOString(),
          );
        }
      }
      // Private chats from banned users are dropped entirely.
      if (ctx.chat?.type === 'private' && ctx.from && this.helpers.isBlocked(botId, ctx.from.id)) {
        return;
      }
      await next();
    });

    bot.on('my_chat_member', (ctx) => {
      const chat = ctx.myChatMember.chat;
      const active = ['member', 'administrator', 'creator'].includes(
        ctx.myChatMember.new_chat_member.status,
      );
      this.db.run(
        `INSERT INTO bot_groups (bot_id, chat_id, title, type, member_count, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(bot_id, chat_id) DO UPDATE SET title = excluded.title, is_active = excluded.is_active`,
        botId,
        chat.id,
        chat.title ?? String(chat.id),
        chat.type,
        0,
        active ? 1 : 0,
        new Date().toISOString(),
      );
    });
  }

  /**
   * Attaches every enabled module's handler to the bot.
   * @param {Bot} bot - Target grammY instance.
   * @param {number} botId - Studio bot identifier.
   * @returns {Promise<void>} Resolves once all handlers registered.
   */
  private async attachModules(bot: Bot, botId: number): Promise<void> {
    const rows = this.db.query<{ module_key: string; is_enabled: number; config_json: string | null }>(
      'SELECT module_key, is_enabled, config_json FROM bot_modules WHERE bot_id = ?',
      botId,
    );
    for (const row of rows) {
      if (!row.is_enabled) continue;
      const handler = this.handlerRegistry.get(row.module_key);
      const definition = findModule(row.module_key);
      if (!handler || !definition) continue;
      const stored = row.config_json ? (JSON.parse(row.config_json) as Record<string, unknown>) : {};
      const config = { ...definition.defaultConfig, ...stored };
      try {
        await handler.register({ bot, botId, config });
      } catch (error) {
        this.logger.error(
          `Module ${row.module_key} failed to attach on bot ${botId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Stops a bot and marks its runtime inactive.
   * @param {number} botId - Studio bot identifier.
   * @returns {Promise<void>} Resolves once polling stopped.
   */
  async stopBot(botId: number): Promise<void> {
    const runtime = this.runtimes.get(botId);
    if (runtime) {
      await runtime.bot.stop();
      runtime.status = 'stopped';
    }
  }

  /**
   * Fully rebuilds a bot (used after module or token changes).
   * @param {number} botId - Studio bot identifier.
   * @returns {Promise<void>} Resolves once the restart completed.
   */
  async restartBot(botId: number): Promise<void> {
    const row = this.db.get<BotRow>('SELECT * FROM bots WHERE id = ?', botId);
    if (!row) return;
    if (row.is_active) {
      await this.startBot(row);
    } else {
      this.stopExisting(botId);
    }
  }

  /**
   * Stops a bot and removes its runtime entry (used on bot deletion).
   * @param {number} botId - Studio bot identifier.
   * @returns {void}
   */
  destroyBot(botId: number): void {
    this.stopExisting(botId);
  }

  /**
   * Returns the live grammY instance for API calls (menu buttons, scans).
   * @param {number} botId - Studio bot identifier.
   * @returns {Bot | undefined} Instance when the bot is loaded.
   */
  getBot(botId: number): Bot | undefined {
    return this.runtimes.get(botId)?.bot;
  }

  /**
   * Reports the runtime health of a bot for the dashboard status dot.
   * @param {number} botId - Studio bot identifier.
   * @returns {'active'|'starting'|'failed'|'stopped'|'inactive'} Health state.
   */
  getStatus(botId: number, isActive: boolean): 'active' | 'starting' | 'failed' | 'stopped' | 'inactive' {
    if (!isActive) return 'inactive';
    return this.runtimes.get(botId)?.status ?? 'inactive';
  }

  /**
   * Reads the persisted daily volume for a bot (UTC day bucket).
   * @param {number} botId - Studio bot identifier.
   * @returns {number} Messages recorded for the current UTC day.
   */
  getDailyVolume(botId: number): number {
    const key = `msg_volume_${new Date().toISOString().slice(0, 10)}`;
    const row = this.db.get<{ value: string }>(
      'SELECT value FROM bot_settings WHERE bot_id = ? AND key = ?',
      botId,
      key,
    );
    return (row ? Number(row.value) : 0) + (this.volume.get(botId) ?? 0);
  }

  /**
   * Flushes in-memory volume counters into `bot_settings`.
   * @returns {void}
   */
  private flushVolume(): void {
    if (this.volume.size === 0) return;
    const key = `msg_volume_${new Date().toISOString().slice(0, 10)}`;
    const statement = `INSERT INTO bot_settings (bot_id, key, value) VALUES (?, ?, ?)
      ON CONFLICT(bot_id, key) DO UPDATE SET value = CAST(CAST(bot_settings.value AS INTEGER) + ? AS TEXT)`;
    for (const [botId, pending] of this.volume) {
      this.db.run(statement, botId, key, String(pending), String(pending));
    }
    this.volume.clear();
  }
}
