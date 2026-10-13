import { Injectable } from '@nestjs/common';
import { InlineKeyboard, type Context } from 'grammy';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { AutoresponderService, type AutoresponderRow } from './autoresponder.service';
import { BotModel } from '../../models/bot.model';
import { renderTemplate, type TemplateContext } from '../../common/utils/template.util';

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
 * Runtime for the Custom Commands & Auto-Responder module. Matches `/command`
 * rules exactly and keyword rules by substring, replying with templated text,
 * optional media, and inline buttons.
 */
@Injectable()
export class AutoresponderRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'autoresponder';

  /**
   * @param {AutoresponderService} service - Rule CRUD service.
   * @param {BotModel} botModel - Bot domain model.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly service: AutoresponderService,
    private readonly botModel: BotModel,
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

    bot.on('message:text', async (update) => {
      if (update.chat?.type !== 'private') return;
      const text = update.msg.text.trim();
      const from = update.from;
      if (!from) return;

      const templateCtx: TemplateContext = {
        first_name: from.first_name,
        last_name: from.last_name,
        username: from.username,
        user_id: from.id,
        mention: from.username
          ? `@${from.username}`
          : `<a href="tg://user?id=${from.id}">${from.first_name}</a>`,
        bot_name: bot.botInfo?.first_name ?? '',
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toISOString().slice(11, 16),
      };

      // Default /start message (skipped when the Start Menu module owns /start).
      if (text.startsWith('/start')) {
        const startMessage = String(ctx.config.startMessage ?? '');
        if (startMessage && !(await this.startMenuOwnsStart(ctx.botId))) {
          await update.reply(renderTemplate(startMessage, templateCtx), {
            parse_mode: 'HTML',
          });
        }
        return;
      }

      const rules = (await this.service.list(ctx.botId)).filter((rule) => rule.is_active);
      const commandText = text.split(/[\s@]/)[0].toLowerCase();
      const matched =
        rules.find(
          (rule) => rule.command.startsWith('/') && rule.command.toLowerCase() === commandText,
        ) ??
        rules.find(
          (rule) =>
            !rule.command.startsWith('/') &&
            text.toLowerCase().includes(rule.command.toLowerCase()),
        );
      if (!matched) return;

      await this.sendRule(update, matched, templateCtx);
    });
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
  private async startMenuOwnsStart(botId: number): Promise<boolean> {
    const row = await this.botModel.getModule(botId, 'start-menu');
    return Boolean(row?.isEnabled);
  }
}
