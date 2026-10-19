import { Injectable, Logger } from '@nestjs/common';
import { InlineKeyboard, type Context } from 'grammy';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { AutoresponderService, type AutoresponderRow } from './autoresponder.service';
import { BotModel } from '../../bots/bot.model';
import { AdminGateService } from '../../bot-engine/admin-gate.service';
import { BotI18nService } from '../../bot-engine/bot-i18n.service';
import { renderTemplate, type TemplateContext } from '../../common/utils/template.util';
import { normalizeText } from '../../common/utils/telegram-text.util';

/**
 * Button descriptor for autoresponder replies.
 * @interface ReplyButton
 * @property {string} text - Inline button label.
 * @property {string} url - Inline button target URL.
 */
interface ReplyButton {
  text: string;
  url: string;
}

/**
 * Runtime for the Custom Commands & Auto-Responder module (v2, reference
 * filters/notes parity): rules now work in groups too, scoped globally
 * (chatId null) or per chat, with keyword/command/hashtag/prefix/exact
 * matching modes, admin-only visibility, and #hashtag note triggers.
 */
@Injectable()
export class AutoresponderRuntime extends BotModuleHandler {
  private readonly logger = new Logger(AutoresponderRuntime.name);
  /** Registry key of the module. */
  readonly moduleKey = 'autoresponder';

  /**
   * @param {AutoresponderService} service - Rule CRUD service.
   * @param {BotModel} botModel - Bot domain model.
   * @param {AdminGateService} adminGate - Telegram permission gate.
   * @param {BotI18nService} i18n - Bot-reply localization.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly service: AutoresponderService,
    private readonly botModel: BotModel,
    private readonly adminGate: AdminGateService,
    private readonly i18n: BotI18nService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches command and keyword matching middleware to the bot.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot } = ctx;

    bot.on(['message:text', 'channel_post:text'], async (update, next) => {
      try {
        await this.handleTextMessage(ctx, update);
      } catch (err) {
        this.logger.warn(
          `Autoresponder message handling failed for bot ${ctx.botId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        await next();
      }
    });
  }

  /**
   * Runs keyword/command rule matching for one text message.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @param {Context} update - grammY context.
   * @returns {Promise<void>} Resolves once handled.
   */
  private async handleTextMessage(ctx: ModuleRuntimeContext, update: Context): Promise<void> {
    const { bot } = ctx;
    const chatType = update.chat?.type;
    const isPrivate = chatType === 'private';
    const isGroup = chatType === 'supergroup' || chatType === 'group';
    const isChannel = chatType === 'channel';
    if (!isPrivate && !isGroup && !isChannel) return;
    const text = (update.msg?.text ?? '').trim();
    if (!text) return;
    const from = update.from;
    if (from && from.id === bot.botInfo?.id) return;
    if (from && from.is_bot && isGroup) return;

    const chatId = String(update.chat!.id);
    const templateCtx: TemplateContext = {
      first_name: from?.first_name ?? update.chat?.title ?? '',
      last_name: from?.last_name ?? '',
      username: from?.username ?? update.chat?.username ?? '',
      user_id: from?.id ?? 0,
      mention: from?.username
        ? `@${from.username}`
        : from
          ? `<a href="tg://user?id=${from.id}">${from.first_name}</a>`
          : (update.chat?.title ?? ''),
      group_name: update.chat?.title,
      bot_name: bot.botInfo?.first_name ?? '',
      date: new Date().toISOString().slice(0, 10),
      time: new Date().toISOString().slice(11, 16),
    };

    // Default /start message (skipped when the Start Menu module owns /start).
    if (isPrivate && text.startsWith('/start')) {
      const startMessage = String(ctx.config.startMessage ?? '');
      if (startMessage && !(await this.startMenuOwnsStart(ctx.botId))) {
        await update.reply(renderTemplate(startMessage, templateCtx), {
          parse_mode: 'HTML',
        });
      }
      return;
    }

    const rules = (await this.service.list(ctx.botId)).filter((rule) => rule.is_active);
    const matched = await this.findMatch(
      update,
      rules,
      text,
      chatId,
      isPrivate,
      isGroup,
      isChannel,
      ctx.botId,
    );
    if (!matched) return;

    // {admin} fillings: admin-only rules stay silent for regular users in groups.
    if (matched.admin_only === 1 && isGroup && from) {
      const isAdmin = await this.adminGate.isAdmin(update.api, Number(chatId), from.id);
      if (!isAdmin) return;
    }

    await this.sendRule(update, matched, templateCtx);
  }

  /**
   * Finds the first matching rule for a message across all match modes.
   *
   * @param {Context} update - grammY context.
   * @param {AutoresponderRow[]} rules - Active rule rows.
   * @param {string} text - Raw message text.
   * @param {string} chatId - Chat scope id.
   * @param {boolean} isPrivate - Whether the chat is private.
   * @param {boolean} isGroup - Whether the chat is a group/supergroup.
   * @param {boolean} isChannel - Whether the chat is a channel.
   * @param {number} botId - Studio bot id.
   * @returns {Promise<AutoresponderRow | undefined>} Matched rule.
   */
  private async findMatch(
    update: Context,
    rules: AutoresponderRow[],
    text: string,
    chatId: string,
    isPrivate: boolean,
    isGroup: boolean,
    isChannel: boolean,
    botId: string,
  ): Promise<AutoresponderRow | undefined> {
    void botId;
    const scoped = rules.filter((rule) =>
      this.inScope(rule, chatId, isPrivate, isGroup, isChannel),
    );
    const lower = text.toLowerCase();
    const normalized = normalizeText(text);

    const firstWord = lower.split(/\s+/)[0];
    const [rawCmd, targetBot] = firstWord.split('@');
    const botUsername = update.me?.username?.toLowerCase();
    const isTargetedAtUs = !targetBot || !botUsername || targetBot === botUsername;

    return (
      // 1. Exact /command rules.
      (isTargetedAtUs
        ? scoped.find(
            (rule) =>
              rule.command.startsWith('/') &&
              !rule.command.includes(' ') &&
              rule.command.toLowerCase() === rawCmd,
          )
        : undefined) ??
      // 2. Hashtag notes: "#trigger" anywhere in the text.
      scoped.find((rule) => {
        const mode = rule.match_mode ?? 'keyword';
        const trigger = rule.command.toLowerCase();
        return (
          mode === 'hashtag' &&
          (lower.split(/\s+/).includes(`#${trigger}`) || rule.command.startsWith('/'))
        );
      }) ??
      // 3. prefix: triggers.
      scoped.find((rule) => {
        const mode = rule.match_mode ?? 'keyword';
        return mode === 'prefix' && normalized.startsWith(normalizeText(rule.command));
      }) ??
      // 4. exact: triggers.
      scoped.find((rule) => {
        const mode = rule.match_mode ?? 'keyword';
        return mode === 'exact' && normalized === normalizeText(rule.command);
      }) ??
      // 5. Plain keyword substring rules (backwards compatible).
      scoped.find((rule) => {
        const mode = rule.match_mode ?? 'keyword';
        return !rule.command.startsWith('/') && mode === 'keyword'
          ? normalized.includes(normalizeText(rule.command))
          : rule.command.startsWith('/') && rule.command.includes(' ')
            ? lower.startsWith(rule.command.toLowerCase())
            : false;
      })
    );
  }

  /**
   * Checks a rule's chat scope: all, private, group, or channel; global (chatId
   * null or empty) or pinned to a single chat.
   */
  private inScope(
    rule: AutoresponderRow,
    chatId: string,
    isPrivate: boolean,
    isGroup: boolean,
    isChannel: boolean,
  ): boolean {
    const ruleChatId = rule.chat_id ?? (rule as unknown as { chatId?: string }).chatId;
    if (ruleChatId && String(ruleChatId).trim() && String(ruleChatId).trim() !== 'all') {
      if (String(ruleChatId).trim() !== chatId) return false;
    }
    const scope = (rule.scope ?? 'all').toLowerCase();
    if (scope === 'all' || scope === 'both') return true;
    if (isPrivate && scope === 'private') return true;
    if (isGroup && (scope === 'group' || scope === 'groups')) return true;
    if (isChannel && (scope === 'channel' || scope === 'channels')) return true;
    return false;
  }

  /**
   * Sends a matched rule with media and inline buttons.
   * @param {Context} update - grammY context of the triggering message.
   * @param {AutoresponderRow} rule - Matched rule row.
   * @param {TemplateContext} templateCtx - Placeholder values.
   * @returns {Promise<void>} Resolves once delivered.
   */
  private async sendRule(
    update: Context,
    rule: AutoresponderRow,
    templateCtx: TemplateContext,
  ): Promise<void> {
    const body = renderTemplate(rule.response_text, templateCtx);
    const buttons: ReplyButton[] = rule.buttons_json
      ? (JSON.parse(rule.buttons_json) as ReplyButton[])
      : [];
    const keyboard = new InlineKeyboard();
    for (const button of buttons) {
      keyboard.url(button.text, button.url).row();
    }
    const options: Record<string, unknown> = {
      parse_mode: 'HTML',
      ...(buttons.length > 0 ? { reply_markup: keyboard } : {}),
    };
    if (rule.media_url) {
      await update
        .replyWithPhoto(rule.media_url, { caption: body, ...options })
        .catch(() => update.reply(body, options));
      return;
    }
    await update.reply(body, options);
  }

  /**
   * Checks whether the Start Menu module is enabled (it owns the /start reply).
   * @param {number} botId - Owning bot id.
   * @returns {Promise<boolean>} True when the Start Menu module is active on the bot.
   */
  private async startMenuOwnsStart(botId: string): Promise<boolean> {
    const row = await this.botModel.getModule(botId, 'start-menu');
    return Boolean(row?.isEnabled);
  }
}
