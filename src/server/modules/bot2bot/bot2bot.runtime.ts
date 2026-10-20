import { Injectable } from '@nestjs/common';
import { InlineKeyboard, type Context } from 'grammy';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { AdminGateService } from '../../bot-engine/admin-gate.service';
import { ChatSettingsService } from '../../bot-engine/chat-settings.service';
import { BotI18nService } from '../../bot-engine/bot-i18n.service';
import { isChatTargeted } from '../../common/utils/chat-targets.util';

/** Pending bot-issued admin actions awaiting review (in memory). */
interface PendingBotAction {
  botId: string;
  chatId: number;
  /** The command that triggered the action, for display. */
  label: string;
  /** Deferred execution, invoked on approval. */
  execute: () => Promise<void>;
}

/**
 * Runtime for the Bot-to-Bot Commands module: gates whether other bots may
 * use this bot's group commands (off / admin-bots / all) and routes
 * bot-issued admin actions through an inline Approve/Deny review unless
 * reviews are skipped for trusted bots (the reference bot's bot2bot safety model).
 */
@Injectable()
export class Bot2BotRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'bot2bot';

  /** Pending reviewed actions keyed by review nonce. */
  private readonly pending = new Map<string, PendingBotAction>();

  /**
   * @param {AdminGateService} adminGate - Telegram permission gate.
   * @param {ChatSettingsService} chatSettings - Per-chat config layer.
   * @param {BotI18nService} i18n - Bot-reply localization.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly adminGate: AdminGateService,
    private readonly chatSettings: ChatSettingsService,
    private readonly i18n: BotI18nService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches the bot2bot configuration commands and review buttons.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot, botId } = ctx;

    bot.command('bot2bot', (c) => this.handleMode(c, botId));
    bot.command('bot2botskipreview', (c) => this.handleSkipReview(c, botId));

    bot.callbackQuery(/^b2b:(ok|no):([a-z0-9]+)$/, async (c) => {
      const decision = c.match[1];
      const nonce = String(c.match[2]);
      const action = this.pending.get(nonce);
      if (!action || !c.from) {
        await c.answerCallbackQuery().catch(() => undefined);
        return;
      }
      const isAdmin = await this.adminGate.isAdmin(c.api, action.chatId, c.from.id);
      if (!isAdmin) {
        await c.answerCallbackQuery({ text: 'Admins only' }).catch(() => undefined);
        return;
      }
      this.pending.delete(nonce);
      if (decision === 'ok') {
        await action.execute();
      }
      await c
        .editMessageText(`${decision === 'ok' ? '✅' : '⛔'} ${action.label}`)
        .catch(() => undefined);
      await c.answerCallbackQuery().catch(() => undefined);
    });

    void bot;
  }

  /**
   * Checks whether a bot sender may use this bot's commands in a chat.
   *
   * @param {Context} c - grammY command context from the bot sender.
   * @param {number} botId - Studio bot id.
   * @returns {Promise<boolean>} True when the bot sender passes the gate.
   */
  async allowsBotSender(c: Context, botId: string): Promise<boolean> {
    if (!c.from?.is_bot || !c.chat) return true;
    const config = await this.chatSettings.getEffectiveConfig(botId, c.chat.id, this.moduleKey);
    if (!isChatTargeted(config.targetChats, c.chat.id)) return false;
    const mode = String(config.mode ?? 'off');
    if (mode === 'off') return false;
    if (mode === 'all') return true;
    // 'admin': only bots that administrate the chat may act.
    return this.adminGate.isAdmin(c.api, c.chat.id, c.from.id);
  }

  /**
   * Routes a bot-issued admin action through review when required.
   *
   * @param {Context} c - grammY command context from the bot sender.
   * @param {number} botId - Studio bot id.
   * @param {string} label - Human-readable action label.
   * @param {() => Promise<void>} execute - Deferred action execution.
   * @returns {Promise<boolean>} True when the action was queued for review
   * (caller must stop); false when it may execute directly.
   */
  async reviewIfNeeded(
    c: Context,
    botId: string,
    label: string,
    execute: () => Promise<void>,
  ): Promise<boolean> {
    if (!c.from?.is_bot || !c.chat) return false;
    void botId;
    const config = await this.chatSettings.getEffectiveConfig(botId, c.chat.id, this.moduleKey);
    if (config.skipReview === true) return false;

    const nonce = crypto.randomUUID().slice(0, 10);
    this.pending.set(nonce, { botId, chatId: c.chat.id, label, execute });
    const lang = await this.i18n.getChatLanguage(botId, c.chat.id);
    await c.api
      .sendMessage(c.chat.id, `🤖 ${label}\n${this.i18n.t(lang, 'common.missingPermission')}?`, {
        reply_markup: new InlineKeyboard()
          .text('✅ Approve', `b2b:ok:${nonce}`)
          .text('⛔ Deny', `b2b:no:${nonce}`),
      })
      .catch(() => undefined);
    return true;
  }

  /**
   * Handles /bot2bot off|admin|all (admin, change_info).
   */
  private async handleMode(c: Context, botId: string): Promise<void> {
    const chatId = await this.requireSettings(c, botId);
    if (chatId === null) return;
    const mode = String(typeof c.match === 'string' ? c.match : '')
      .trim()
      .toLowerCase();
    if (!['off', 'admin', 'all'].includes(mode)) {
      await c.reply('off | admin | all').catch(() => undefined);
      return;
    }
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      mode,
    });
    await c.reply('✅').catch(() => undefined);
  }

  /**
   * Handles /bot2botskipreview on|off (admin, change_info).
   */
  private async handleSkipReview(c: Context, botId: string): Promise<void> {
    const chatId = await this.requireSettings(c, botId);
    if (chatId === null) return;
    const enable = ['on', 'yes', 'true'].includes(
      String(typeof c.match === 'string' ? c.match : '')
        .trim()
        .toLowerCase(),
    );
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      skipReview: enable,
    });
    await c.reply('✅').catch(() => undefined);
  }

  /**
   * Guard for the configuration commands: group + change_info + explicit target.
   */
  private async requireSettings(c: Context, botId: string): Promise<number | null> {
    if (c.chat?.type !== 'supergroup' && c.chat?.type !== 'group') return null;
    if (!c.from) return null;
    const chatId = c.chat.id;
    if (!(await this.adminGate.hasCapability(c.api, chatId, c.from.id, 'change_info'))) {
      return null;
    }
    return chatId;
  }
}
