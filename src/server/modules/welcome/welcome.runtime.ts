import { Injectable } from '@nestjs/common';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { AdminGateService } from '../../bot-engine/admin-gate.service';
import { ChatSettingsService } from '../../bot-engine/chat-settings.service';
import { renderTemplate } from '../../common/utils/template.util';
import { escapeHtml } from '../../common/utils/telegram-text.util';
import { isChatTargeted } from '../../common/utils/chat-targets.util';

/** Parsed inline button rows config: `[{text, url}]`. */
interface ButtonSpec {
  text: string;
  url: string;
}

/**
 * Runtime for the Group Welcome & Goodbye module (v2): placeholder
 * templates with media + inline buttons, auto-delete widened to 15s–1h,
 * cleanwelcome (replace previous greeting), goodbye messages, service
 * message cleanup, and reference-style management commands.
 */
@Injectable()
export class WelcomeRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'welcome';

  /** Last greeting message id per (bot, chat) for cleanwelcome. */
  private readonly lastGreeting = new Map<string, number>();

  /**
   * @param {AdminGateService} adminGate - Telegram permission gate.
   * @param {ChatSettingsService} chatSettings - Per-chat config layer.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly adminGate: AdminGateService,
    private readonly chatSettings: ChatSettingsService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches greeting middleware and welcome management commands.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot, botId } = ctx;

    bot.on('message:new_chat_members', async (update) => {
      if (update.chat?.type !== 'supergroup' && update.chat?.type !== 'group') return;
      const chatId = update.chat.id;
      const members = update.msg.new_chat_members ?? [];
      const config = await this.chatSettings.getEffectiveConfig(botId, chatId, this.moduleKey);
      if (!isChatTargeted(config.targetChats, chatId)) return;
      const template = String(config.template ?? 'Welcome {mention} to {group_name}!');

      for (const member of members) {
        if (member.is_bot) continue;
        const text = renderTemplate(
          template,
          this.templateParams(member, update.chat.title, bot.botInfo?.first_name ?? ''),
        );

        // Cleanwelcome: drop the previous greeting so only one stays visible.
        if (config.cleanWelcome === true) {
          const previous = this.lastGreeting.get(`${botId}:${chatId}`);
          if (previous) {
            await bot.api.deleteMessage(chatId, previous).catch(() => undefined);
          }
        }

        const sent = await this.sendGreeting(update, chatId, text, config);
        if (sent) {
          this.lastGreeting.set(`${botId}:${chatId}`, sent.message_id);
          const autoDelete = Number(config.autoDeleteSeconds ?? 0);
          if (autoDelete >= 15 && autoDelete <= 3_600) {
            setTimeout(() => {
              void bot.api.deleteMessage(chatId, sent.message_id).catch(() => undefined);
            }, autoDelete * 1000);
          }
        }
      }

      if (config.deleteServiceMessages !== false) {
        await update.deleteMessage().catch(() => undefined);
      }
    });

    bot.on('message:left_chat_member', async (update) => {
      if (update.chat?.type !== 'supergroup' && update.chat?.type !== 'group') return;
      const chatId = update.chat.id;
      const member = update.msg.left_chat_member;
      const config = await this.chatSettings.getEffectiveConfig(botId, chatId, this.moduleKey);
      if (!isChatTargeted(config.targetChats, chatId)) return;

      if (config.goodbyeEnabled === true && member && !member.is_bot) {
        const template = String(config.goodbyeText ?? 'Nice knowing you, {first_name}!');
        const text = renderTemplate(
          template,
          this.templateParams(member, update.chat.title, bot.botInfo?.first_name ?? ''),
        );
        await this.sendGreeting(update, chatId, text, {
          ...config,
          mediaUrl: config.goodbyeMediaUrl,
        });
      }

      if (config.deleteLeaveMessages === true) {
        await update.deleteMessage().catch(() => undefined);
      }
    });

    // Management commands (reference parity).
    bot.command('setwelcome', (c) => this.handleSet(c, botId, 'template'));
    bot.command('resetwelcome', (c) => this.handleReset(c, botId, 'template', 'template'));
    bot.command('welcome', (c) => this.handleView(c, botId, 'template', 'welcomeEnabled'));
    bot.command('setgoodbye', (c) => this.handleSet(c, botId, 'goodbyeText'));
    bot.command('resetgoodbye', (c) => this.handleReset(c, botId, 'goodbyeText', 'goodbyeText'));
    bot.command('goodbye', (c) => this.handleView(c, botId, 'goodbyeText', 'goodbyeEnabled'));
  }

  /**
   * Builds escaped template parameters for a member. Every user-controlled
   * value is HTML-escaped: the rendered text is sent with parse_mode=HTML and
   * a hostile display name must not inject markup into group messages.
   *
   * @param {object} member - Telegram member (first_name/last_name/username/id).
   * @param {string | undefined} chatTitle - Group title.
   * @param {string} botName - Bot display name.
   * @returns {Record<string, string | number>} Placeholder values.
   */
  private templateParams(
    member: {
      first_name?: string;
      last_name?: string;
      username?: string;
      id: number;
    },
    chatTitle: string | undefined,
    botName: string,
  ): Record<string, string | number> {
    return {
      first_name: escapeHtml(member.first_name ?? ''),
      last_name: escapeHtml(member.last_name ?? ''),
      fullname: escapeHtml([member.first_name, member.last_name].filter(Boolean).join(' ')),
      username: escapeHtml(member.username ?? ''),
      user_id: member.id,
      mention: member.username
        ? escapeHtml(`@${member.username}`)
        : `<a href="tg://user?id=${member.id}">${escapeHtml(member.first_name ?? String(member.id))}</a>`,
      group_name: escapeHtml(chatTitle ?? 'the group'),
      bot_name: escapeHtml(botName),
      date: new Date().toISOString().slice(0, 10),
      time: new Date().toISOString().slice(11, 16),
    };
  }

  /**
   * Sends a greeting with optional media and inline buttons.
   *
   * @param {import('grammy').Context} update - grammY context.
   * @param {number} chatId - Target chat id.
   * @param {string} text - Rendered message (HTML).
   * @param {Record<string, unknown>} config - Effective module config.
   * @returns {Promise<{message_id: number} | null>} Sent message, or null.
   */
  private async sendGreeting(
    update: import('grammy').Context,
    chatId: number,
    text: string,
    config: Record<string, unknown>,
  ): Promise<{ message_id: number } | null> {
    const buttons = this.parseButtons(config.buttonsJson);
    const markup = buttons ? { inline_keyboard: this.toKeyboard(buttons) } : undefined;
    const mediaUrl = typeof config.mediaUrl === 'string' ? config.mediaUrl.trim() : '';

    if (mediaUrl) {
      const video = /\.(mp4|mov|webm)(\?|$)/i.test(mediaUrl);
      const sent = video
        ? await update.api
            .sendVideo(chatId, mediaUrl, {
              caption: text,
              parse_mode: 'HTML',
              reply_markup: markup,
            })
            .catch(() => null)
        : await update.api
            .sendPhoto(chatId, mediaUrl, {
              caption: text,
              parse_mode: 'HTML',
              reply_markup: markup,
            })
            .catch(() => null);
      if (sent) return sent;
    }
    return update.api
      .sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: markup })
      .catch(() => null);
  }

  /**
   * Parses a buttons JSON spec (tolerant).
   */
  private parseButtons(raw: unknown): ButtonSpec[] | null {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      const buttons = parsed
        .filter((item) => item && typeof item.text === 'string' && typeof item.url === 'string')
        .map((item) => ({ text: String(item.text), url: String(item.url) }));
      return buttons.length > 0 ? buttons : null;
    } catch {
      return null;
    }
  }

  /**
   * Wraps button specs one per row (matching the autoresponder convention).
   */
  private toKeyboard(buttons: ButtonSpec[]): Array<Array<{ text: string; url: string }>> {
    return buttons.map((button) => [button]);
  }

  /**
   * Guard: group + change_info + explicit target chat.
   */
  private async guard(c: import('grammy').Context, botId: string): Promise<number | null> {
    if (c.chat?.type !== 'supergroup' && c.chat?.type !== 'group') return null;
    if (!c.from) return null;
    if (!(await this.chatSettings.isTargeted(botId, c.chat.id, this.moduleKey))) return null;
    if (!(await this.adminGate.hasCapability(c.api, c.chat.id, c.from.id, 'change_info'))) {
      return null;
    }
    return c.chat.id;
  }

  /**
   * Handles /setwelcome and /setgoodbye (text, or caption for replied media).
   */
  private async handleSet(
    c: import('grammy').Context,
    botId: string,
    field: string,
  ): Promise<void> {
    const chatId = await this.guard(c, botId);
    if (chatId === null) return;
    const text = String(typeof c.match === 'string' ? c.match : '').trim();
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    const enabledField = field === 'template' ? 'welcomeEnabled' : 'goodbyeEnabled';
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      [field]: text || undefined,
      [enabledField]: true,
    });
    await c.reply('✅').catch(() => undefined);
  }

  /**
   * Handles /resetwelcome and /resetgoodbye.
   */
  private async handleReset(
    c: import('grammy').Context,
    botId: string,
    field: string,
    resetField: string,
  ): Promise<void> {
    const chatId = await this.guard(c, botId);
    if (chatId === null) return;
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    delete override[resetField];
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, override);
    await c.reply('✅').catch(() => undefined);
  }

  /**
   * Handles /welcome and /goodbye — view (noformat) or toggle on/off.
   */
  private async handleView(
    c: import('grammy').Context,
    botId: string,
    field: string,
    enabledField: string,
  ): Promise<void> {
    void botId;
    const chatId = await this.guard(c, botId);
    if (chatId === null) return;
    const args = String(typeof c.match === 'string' ? c.match : '')
      .trim()
      .toLowerCase();
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    const config = await this.chatSettings.getEffectiveConfig(botId, chatId, this.moduleKey);

    if (args === 'on' || args === 'off') {
      await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
        ...override,
        [enabledField]: args === 'on',
      });
      await c.reply('✅').catch(() => undefined);
      return;
    }

    const text = String(config[field] ?? '');
    if (args === 'noformat') {
      await c.reply(text || '—').catch(() => undefined);
      return;
    }
    await this.sendGreeting(c, c.chat!.id, text || '—', {});
  }
}
