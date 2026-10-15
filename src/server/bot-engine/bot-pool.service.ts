import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Bot } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { PrismaService } from '../database/prisma.service';
import { ChatConnectionModel } from '../models/chat-connection.model';
import { EngineHelpersService } from './engine-helpers.service';
import { ModuleHandlerRegistry } from './module-handler-registry';
import { PaymentEventsService } from './payment-events.service';
import { findModule } from './module-registry';

/**
 * Bot row shape.
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
 */
interface BotRuntime {
  bot: Bot;
  status: 'starting' | 'active' | 'failed' | 'stopped' | 'retrying';
  retryCount: number;
  lastError?: string;
  errorReason?: 'token_revoked' | 'conflict' | 'network' | 'unknown';
}

/**
 * Every Telegram update type the engine subscribes to. Telegram's default
 * delivery silently omits `chat_member`, `message_reaction(_count)`, and
 * `chat_join_request` unless explicitly requested — without this list the
 * reactions module, join tracking (anti-raid, passive fed bans), and join
 * request flows never receive their updates.
 */
const ALLOWED_UPDATE_TYPES = [
  'message',
  'edited_message',
  'channel_post',
  'edited_channel_post',
  'business_connection',
  'business_message',
  'edited_business_message',
  'deleted_business_messages',
  'message_reaction',
  'message_reaction_count',
  'inline_query',
  'chosen_inline_result',
  'callback_query',
  'shipping_query',
  'pre_checkout_query',
  'poll',
  'poll_answer',
  'my_chat_member',
  'chat_member',
  'chat_join_request',
] as const;

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
   * @param {PrismaService} prisma - Prisma ORM access service.
   * @param {ChatConnectionModel} chatConnectionModel - Model for chat connections and groups.
   * @param {EngineHelpersService} helpers - Shared audience operations.
   * @param {ModuleHandlerRegistry} handlerRegistry - Registered module handlers.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatConnectionModel: ChatConnectionModel,
    private readonly helpers: EngineHelpersService,
    private readonly handlerRegistry: ModuleHandlerRegistry,
    private readonly paymentEvents: PaymentEventsService,
  ) {
    // Persist in-memory message volume counters to bot_settings every 30s.
    this.volumeFlushTimer = setInterval(() => void this.flushVolume(), 30_000);
  }

  /**
   * Starts every active bot after all modules have registered handlers.
   * @returns {Promise<void>} Resolves once all pollers have been launched.
   */
  async onApplicationBootstrap(): Promise<void> {
    const bots = await this.prisma.bot.findMany({
      where: { isActive: 1 },
      orderBy: { id: 'asc' },
    });
    for (const bot of bots) {
      await this.startBot({
        id: bot.id,
        name: bot.name,
        token: bot.token,
        username: bot.username,
        first_name: bot.firstName,
        is_active: bot.isActive,
      });
    }
    this.logger.log(`Bot pool started with ${bots.length} active bot(s)`);
  }

  /**
   * Stops every poller and flushes volume counters on shutdown.
   * @returns {Promise<void>} Resolves once all bots stopped cleanly.
   */
  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.volumeFlushTimer);
    await this.flushVolume();
    await Promise.allSettled([...this.runtimes.values()].map((runtime) => runtime.bot.stop()));
    this.logger.log('Bot pool shut down');
  }

  /**
   * Classifies an error into actionable operational categories.
   */
  private parseErrorReason(msg: string): 'token_revoked' | 'conflict' | 'network' | 'unknown' {
    const lower = msg.toLowerCase();
    if (lower.includes('401') || lower.includes('unauthorized')) return 'token_revoked';
    if (lower.includes('409') || lower.includes('conflict')) return 'conflict';
    if (
      lower.includes('etimedout') ||
      lower.includes('econnrefused') ||
      lower.includes('fetch failed') ||
      lower.includes('network')
    ) {
      return 'network';
    }
    return 'unknown';
  }

  /**
   * Builds and launches a bot instance with engine + module middleware.
   * @param {BotRow} row - Database row of the bot.
   * @param {number} attempt - Current restart attempt (0 = initial).
   * @returns {Promise<void>} Resolves once the poller launched (not stopped).
   */
  private async startBot(row: BotRow, attempt = 0): Promise<void> {
    try {
      this.stopExisting(row.id);
      const bot = new Bot(row.token);
      bot.api.config.use(autoRetry());
      bot.catch((error) => {
        this.logger.error(`Bot ${row.id} update error: ${error.message}`);
      });
      this.attachEngineMiddleware(bot, row.id);
      await this.attachModules(bot, row.id);
      this.attachStarsPaymentHandlers(bot, row.id);
      await bot.init();

      this.runtimes.set(row.id, {
        bot,
        status: 'starting',
        retryCount: attempt,
      });

      // Register the group command menu (reference parity) for bots running any
      // in-group module; idempotent and best-effort.
      void this.registerGroupCommands(bot, row.id);

      void bot
        .start({
          allowed_updates: [...ALLOWED_UPDATE_TYPES],
          onStart: () => {
            const runtime = this.runtimes.get(row.id);
            if (runtime) {
              runtime.status = 'active';
              runtime.retryCount = 0;
              runtime.lastError = undefined;
              runtime.errorReason = undefined;
            }
            this.logger.log(`Bot @${bot.botInfo?.username} polling started`);
          },
        })
        .catch((error: Error) => {
          this.handleBotCrash(row, error, attempt);
        });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.handleBotCrash(row, err, attempt);
    }
  }

  /**
   * Supervised error recovery with exponential backoff and 401/409 diagnostic classification.
   */
  private handleBotCrash(row: BotRow, error: Error, attempt: number): void {
    const reason = this.parseErrorReason(error.message);
    const retries = attempt + 1;
    const runtime = this.runtimes.get(row.id) ?? {
      bot: new Bot(row.token),
      status: 'failed',
      retryCount: retries,
    };

    runtime.lastError = error.message;
    runtime.errorReason = reason;
    runtime.retryCount = retries;
    this.runtimes.set(row.id, runtime);

    this.logger.error(`Bot ${row.id} failure (${reason}): ${error.message} (attempt ${retries})`);

    // 401: Token is permanently invalid or revoked. Do not attempt restart loop.
    if (reason === 'token_revoked') {
      runtime.status = 'failed';
      this.logger.warn(`Bot ${row.id} token revoked/invalid. Auto-restart aborted.`);
      return;
    }

    // Recoverable errors (network, 409 conflict, transient): retry up to 3 times
    if (retries <= 3) {
      runtime.status = 'retrying';
      const delayMs = Math.pow(2, retries) * 1500; // 3s, 6s, 12s
      this.logger.log(
        `Bot ${row.id} will attempt auto-restart in ${delayMs / 1000}s (retry ${retries}/3)`,
      );

      setTimeout(async () => {
        const current = this.runtimes.get(row.id);
        if (current && current.status === 'stopped') return;

        const freshBot = await this.prisma.bot.findUnique({ where: { id: row.id } });
        if (freshBot && freshBot.isActive === 1) {
          await this.startBot(
            {
              id: freshBot.id,
              name: freshBot.name,
              token: freshBot.token,
              username: freshBot.username,
              first_name: freshBot.firstName,
              is_active: freshBot.isActive,
            },
            retries,
          );
        }
      }, delayMs);
    } else {
      runtime.status = 'failed';
      this.logger.error(
        `Bot ${row.id} reached maximum auto-restart attempts (3). Marked as failed.`,
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
        void this.helpers.upsertUser(botId, ctx.from);
      }
      if (ctx.msg) {
        this.volume.set(botId, (this.volume.get(botId) ?? 0) + 1);
      }
      // Learn every group/supergroup/channel the bot operates in.
      const chat = ctx.chat;
      if (
        chat &&
        (chat.type === 'group' || chat.type === 'supergroup' || chat.type === 'channel')
      ) {
        const key = `${botId}:${chat.id}`;
        if (!this.discoveredChats.has(key)) {
          this.discoveredChats.add(key);
          void this.chatConnectionModel.upsertGroup({
            botId,
            chatId: chat.id,
            title: chat.title || String(chat.id),
            type: chat.type,
            isActive: 1,
          });
        }
      }
      // Private chats from banned users are dropped entirely.
      if (
        ctx.chat?.type === 'private' &&
        ctx.from &&
        (await this.helpers.isBlocked(botId, ctx.from.id))
      ) {
        return;
      }
      await next();
    });

    bot.on('my_chat_member', (ctx) => {
      const chat = ctx.myChatMember.chat;
      const active = ['member', 'administrator', 'creator'].includes(
        ctx.myChatMember.new_chat_member.status,
      );
      void this.chatConnectionModel.upsertGroup({
        botId,
        chatId: chat.id,
        title: chat.title ?? String(chat.id),
        type: chat.type,
        isActive: active ? 1 : 0,
      });
    });
  }

  /**
   * Attaches the global Telegram Stars payment handlers (pre-checkout
   * validation + successful-payment routing). Fulfilment is delegated to
   * feature modules through the {@link PaymentEventsService} bus.
   * @param {Bot} bot - Target grammY instance.
   * @param {number} botId - Studio bot identifier.
   * @returns {void}
   */
  private attachStarsPaymentHandlers(bot: Bot, botId: number): void {
    bot.on('pre_checkout_query', async (ctx) => {
      const payload = ctx.preCheckoutQuery.invoice_payload;
      let ok = true;
      let errorMessage: string | undefined;
      if (payload.startsWith('order:')) {
        const orderId = Number(payload.slice('order:'.length));
        const order = await this.prisma.miniAppOrder.findFirst({
          where: { id: orderId, botId, status: 'pending_payment' },
        });
        if (!order) {
          ok = false;
          errorMessage = 'This order is no longer pending. Please restart the checkout.';
        }
      } else if (!payload.startsWith('vip:')) {
        ok = false;
        errorMessage = 'Unknown payment payload.';
      }
      if (ok) {
        await ctx.answerPreCheckoutQuery(true);
      } else {
        await ctx.answerPreCheckoutQuery(false, errorMessage ?? 'Payment cannot be processed.');
      }
    });

    bot.on('message:successful_payment', (ctx) => {
      const payment = ctx.message.successful_payment;
      this.paymentEvents.emitPayment({
        botId,
        telegramId: ctx.from?.id ?? 0,
        invoicePayload: payment.invoice_payload,
        telegramPaymentChargeId: payment.telegram_payment_charge_id,
        totalAmount: payment.total_amount,
        currency: payment.currency,
      });
    });
  }

  /**
   * Attaches every enabled module's handler to the bot.
   * @param {Bot} bot - Target grammY instance.
   * @param {number} botId - Studio bot identifier.
   * @returns {Promise<void>} Resolves once all handlers registered.
   */
  private async attachModules(bot: Bot, botId: number): Promise<void> {
    const rows = await this.prisma.botModule.findMany({
      where: { botId, isEnabled: 1 },
    });
    for (const row of rows) {
      const handler = this.handlerRegistry.get(row.moduleKey);
      const definition = findModule(row.moduleKey);
      if (!handler || !definition) continue;
      const stored = row.configJson ? (JSON.parse(row.configJson) as Record<string, unknown>) : {};
      const config = { ...definition.defaultConfig, ...stored };
      try {
        await handler.register({ bot, botId, config });
      } catch (error) {
        this.logger.error(
          `Module ${row.moduleKey} failed to attach on bot ${botId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Publishes the bot's group-chat command list via setMyCommands, derived
   * from the enabled reference-parity modules. Fire-and-forget: token errors are
   * surfaced by the poller itself.
   *
   * @param {Bot} bot - Live grammY instance.
   * @param {number} botId - Studio bot id.
   * @returns {Promise<void>} Resolves once attempted.
   */
  private async registerGroupCommands(bot: Bot, botId: number): Promise<void> {
    try {
      const rows = await this.prisma.botModule.findMany({
        where: { botId, isEnabled: 1 },
        select: { moduleKey: true },
      });
      const enabled = new Set(rows.map((row) => row.moduleKey));

      const commands: Array<{ command: string; description: string }> = [];
      if (enabled.has('group-moderation')) {
        commands.push(
          { command: 'ban', description: 'Ban a member' },
          { command: 'mute', description: 'Mute a member' },
          { command: 'kick', description: 'Kick a member' },
          { command: 'warn', description: 'Warn a member' },
          { command: 'warns', description: 'List warnings' },
          { command: 'purge', description: 'Purge messages (reply)' },
          { command: 'approve', description: 'Approve a member' },
        );
      }
      if (enabled.has('group-tools')) {
        commands.push(
          { command: 'report', description: 'Report a message to admins' },
          { command: 'adminlist', description: 'List group admins' },
          { command: 'rules', description: 'Show the rules' },
          { command: 'id', description: 'Show ids' },
        );
      }
      if (enabled.has('locks')) {
        commands.push(
          { command: 'lock', description: 'Lock content types' },
          { command: 'locks', description: 'Show active locks' },
        );
      }
      if (enabled.has('antiraid')) {
        commands.push({ command: 'antiraid', description: 'Toggle raid mode' });
      }
      if (enabled.has('language')) {
        commands.push({ command: 'setlang', description: 'Set bot reply language' });
      }
      if (commands.length === 0) return;

      await bot.api.setMyCommands(commands, { scope: { type: 'all_group_chats' } });
    } catch {
      // Command registration is cosmetic; poller errors surface elsewhere.
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
    const row = await this.prisma.bot.findUnique({ where: { id: botId } });
    if (!row) return;
    if (row.isActive === 1) {
      await this.startBot({
        id: row.id,
        name: row.name,
        token: row.token,
        username: row.username,
        first_name: row.firstName,
        is_active: row.isActive,
      });
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
   * @returns {'active'|'starting'|'failed'|'stopped'|'inactive'|'retrying'} Health state.
   */
  getStatus(
    botId: number,
    isActive: boolean,
  ): 'active' | 'starting' | 'failed' | 'stopped' | 'inactive' | 'retrying' {
    if (!isActive) return 'inactive';
    return this.runtimes.get(botId)?.status ?? 'inactive';
  }

  /**
   * Returns extended runtime diagnostic state for the bot.
   */
  getRuntimeInfo(botId: number): {
    status: 'active' | 'starting' | 'failed' | 'stopped' | 'inactive' | 'retrying';
    retryCount: number;
    lastError?: string;
    errorReason?: 'token_revoked' | 'conflict' | 'network' | 'unknown';
  } {
    const runtime = this.runtimes.get(botId);
    return {
      status: runtime?.status ?? 'stopped',
      retryCount: runtime?.retryCount ?? 0,
      lastError: runtime?.lastError,
      errorReason: runtime?.errorReason,
    };
  }

  /**
   * Reads the in-memory volume for a bot.
   * @param {number} botId - Studio bot identifier.
   * @returns {number} Messages recorded for the current UTC day.
   */
  getDailyVolume(botId: number): number {
    return this.volume.get(botId) ?? 0;
  }

  /**
   * Flushes in-memory volume counters into `bot_settings`.
   * @returns {Promise<void>}
   */
  private async flushVolume(): Promise<void> {
    if (this.volume.size === 0) return;
    const key = `msg_volume_${new Date().toISOString().slice(0, 10)}`;

    for (const [botId, pending] of this.volume) {
      const existing = await this.prisma.botSetting.findUnique({
        where: { botId_key: { botId, key } },
      });
      const current = existing ? Number(existing.value) || 0 : 0;
      const total = current + pending;

      await this.prisma.botSetting.upsert({
        where: { botId_key: { botId, key } },
        create: { botId, key, value: String(total) },
        update: { value: String(total) },
      });
    }
    this.volume.clear();
  }
}
