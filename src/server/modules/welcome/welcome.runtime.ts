import { Injectable, Logger } from '@nestjs/common';
import { InlineKeyboard, InputFile, type Api, type Bot, type Context } from 'grammy';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { AdminGateService } from '../../bot-engine/admin-gate.service';
import { ChatSettingsService } from '../../bot-engine/chat-settings.service';
import { renderTemplate } from '../../common/utils/template.util';
import { escapeHtml } from '../../common/utils/telegram-text.util';
import { isChatTargeted } from '../../common/utils/chat-targets.util';

/**
 * Parsed inline button config: one Telegram button shape per entry — URL,
 * callback, Web App, or copy-text (the visual builder's four types).
 */
interface ButtonSpec {
  text: string;
  url?: string;
  callbackData?: string;
  webAppUrl?: string;
  copyText?: string;
}

/** Decoded `data:` URL payload of an uploaded media file. */
interface UploadedMedia {
  buffer: Buffer;
  mime: string;
  fileName: string;
}

/** Telegram member subset consumed by template rendering. */
interface MemberLike {
  first_name?: string;
  last_name?: string;
  username?: string;
  id: number;
  is_bot?: boolean;
}

/** Status fields of a `chat_member` update payload. */
interface ChatMemberStatus {
  status: string;
  is_member?: boolean;
}

/**
 * Window within which duplicate join/leave signals for one user are ignored.
 * Telegram can deliver the same arrival as both a service message and a
 * `chat_member` status update; whichever arrives first wins.
 */
const DEDUP_WINDOW_MS = 15_000;

/**
 * Runtime for the Group Welcome & Goodbye module (v2): placeholder
 * templates with media + inline buttons, auto-delete widened to 15s–1h,
 * cleanwelcome (replace previous greeting), goodbye messages, service
 * message cleanup, and reference-style management commands. Arrivals and
 * departures are detected from BOTH join/leave service messages and
 * `chat_member` status updates, so greetings still fire in groups that
 * hide service messages.
 */
@Injectable()
export class WelcomeRuntime extends BotModuleHandler {
  private readonly logger = new Logger(WelcomeRuntime.name);
  /** Registry key of the module. */
  readonly moduleKey = 'welcome';

  /** Last greeting message id per (bot, chat) for cleanwelcome. */
  private readonly lastGreeting = new Map<string, number>();

  /** Recently handled (bot, chat, kind, user) events for dedup. */
  private readonly handledEvents = new Map<string, number>();

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

    bot.on('message:new_chat_members', async (update, next) => {
      try {
        if (update.chat?.type !== 'supergroup' && update.chat?.type !== 'group') return;
        const chatId = update.chat.id;
        const members = update.msg.new_chat_members ?? [];
        const config = await this.chatSettings.getEffectiveConfig(botId, chatId, this.moduleKey);
        if (!isChatTargeted(config.targetChats, chatId)) return;

        if (config.welcomeEnabled === true) {
          for (const member of members) {
            if (member.is_bot) continue;
            if (!this.claimEvent(botId, chatId, 'join', member.id)) continue;
            await this.greetMember(
              bot,
              botId,
              update.api,
              chatId,
              member,
              update.chat.title,
              config,
            );
          }
        }

        if (config.deleteServiceMessages === true) {
          await update.deleteMessage().catch(() => undefined);
        }
      } catch (err) {
        this.logger.warn(`Welcome greeting error for bot ${botId}: ${this.describeError(err)}`);
      } finally {
        await next();
      }
    });

    bot.on('message:left_chat_member', async (update, next) => {
      try {
        if (update.chat?.type !== 'supergroup' && update.chat?.type !== 'group') return;
        const chatId = update.chat.id;
        const member = update.msg.left_chat_member;
        const config = await this.chatSettings.getEffectiveConfig(botId, chatId, this.moduleKey);
        if (!isChatTargeted(config.targetChats, chatId)) return;

        if (config.goodbyeEnabled === true && member && !member.is_bot) {
          if (this.claimEvent(botId, chatId, 'leave', member.id)) {
            await this.farewellMember(
              update.api,
              chatId,
              member,
              update.chat.title,
              bot.botInfo?.first_name ?? '',
              config,
            );
          }
        }

        if (config.deleteLeaveMessages === true) {
          await update.deleteMessage().catch(() => undefined);
        }
      } catch (err) {
        this.logger.warn(`Goodbye message error for bot ${botId}: ${this.describeError(err)}`);
      } finally {
        await next();
      }
    });

    // Groups that hide join/leave service messages only signal membership
    // changes through chat_member status updates.
    bot.on('chat_member', async (update, next) => {
      try {
        if (update.chat?.type !== 'supergroup' && update.chat?.type !== 'group') return;
        const change = update.chatMember;
        if (!change) return;
        const previous: ChatMemberStatus = change.old_chat_member;
        const current: ChatMemberStatus = change.new_chat_member;
        const user = change.new_chat_member.user;
        if (user.is_bot) return;

        const arrived =
          (previous.status === 'left' || previous.status === 'kicked') &&
          (current.status === 'member' ||
            current.status === 'administrator' ||
            (current.status === 'restricted' && current.is_member === true));
        // Kicks and bans never produce a left_chat_member service message;
        // restricted with is_member=false is a restriction-based removal.
        const departed =
          current.status === 'left' ||
          current.status === 'kicked' ||
          (current.status === 'restricted' && current.is_member === false);
        if (!arrived && !departed) return;

        const chatId = update.chat.id;
        const config = await this.chatSettings.getEffectiveConfig(botId, chatId, this.moduleKey);
        if (!isChatTargeted(config.targetChats, chatId)) return;

        if (arrived) {
          if (config.welcomeEnabled !== true) return;
          if (!this.claimEvent(botId, chatId, 'join', user.id)) return;
          await this.greetMember(bot, botId, update.api, chatId, user, update.chat.title, config);
        } else {
          if (config.goodbyeEnabled !== true) return;
          if (!this.claimEvent(botId, chatId, 'leave', user.id)) return;
          await this.farewellMember(
            update.api,
            chatId,
            user,
            update.chat.title,
            bot.botInfo?.first_name ?? '',
            config,
          );
        }
      } catch (err) {
        this.logger.warn(`chat_member greeting error for bot ${botId}: ${this.describeError(err)}`);
      } finally {
        await next();
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
   * Marks one (bot, chat, kind, user) event as handled. Returns false when
   * the same event was already claimed within the dedup window, so a join
   * delivered as both a service message and a chat_member update greets once.
   *
   * @param {string} botId - Studio bot id.
   * @param {number} chatId - Telegram chat id.
   * @param {'join' | 'leave'} kind - Event kind.
   * @param {number} userId - Telegram user id.
   * @returns {boolean} True when this call is the first claim.
   */
  private claimEvent(
    botId: string,
    chatId: number,
    kind: 'join' | 'leave',
    userId: number,
  ): boolean {
    const now = Date.now();
    for (const [key, claimedAt] of this.handledEvents) {
      if (now - claimedAt > DEDUP_WINDOW_MS * 2) this.handledEvents.delete(key);
    }
    const key = `${botId}:${chatId}:${kind}:${userId}`;
    const previous = this.handledEvents.get(key);
    if (previous !== undefined && now - previous < DEDUP_WINDOW_MS) return false;
    this.handledEvents.set(key, now);
    return true;
  }

  /**
   * Renders and sends one member's greeting (cleanwelcome + auto-delete
   * included).
   *
   * @param {Bot} bot - Live bot instance (auto-delete scheduling).
   * @param {string} botId - Studio bot id (cleanwelcome keying).
   * @param {Api} api - Telegram API adapter.
   * @param {number} chatId - Target chat id.
   * @param {MemberLike} member - Joined member.
   * @param {string | undefined} chatTitle - Group title.
   * @param {Record<string, unknown>} config - Effective module config.
   * @returns {Promise<void>} Resolves once the greeting attempt finished.
   */
  private async greetMember(
    bot: Bot,
    botId: string,
    api: Api,
    chatId: number,
    member: MemberLike,
    chatTitle: string | undefined,
    config: Record<string, unknown>,
  ): Promise<void> {
    const template = String(config.template ?? 'Welcome {mention} to {group_name}!');
    const text = renderTemplate(
      template,
      this.templateParams(member, chatTitle, bot.botInfo?.first_name ?? ''),
    );

    // Cleanwelcome: drop the previous greeting so only one stays visible.
    if (config.cleanWelcome === true) {
      const previous = this.lastGreeting.get(`${botId}:${chatId}`);
      if (previous) {
        await api.deleteMessage(chatId, previous).catch(() => undefined);
      }
    }

    const sent = await this.sendGreeting(api, chatId, text, config);
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

  /**
   * Renders and sends one member's goodbye message.
   *
   * @param {Api} api - Telegram API adapter.
   * @param {number} chatId - Target chat id.
   * @param {MemberLike} member - Departing member.
   * @param {string | undefined} chatTitle - Group title.
   * @param {string} botName - Bot display name.
   * @param {Record<string, unknown>} config - Effective module config.
   * @returns {Promise<void>} Resolves once the goodbye attempt finished.
   */
  private async farewellMember(
    api: Api,
    chatId: number,
    member: MemberLike,
    chatTitle: string | undefined,
    botName: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    const template = String(config.goodbyeText ?? 'Nice knowing you, {first_name}!');
    const text = renderTemplate(template, this.templateParams(member, chatTitle, botName));
    await this.sendGreeting(api, chatId, text, {
      ...config,
      mediaUrl: config.goodbyeMediaUrl,
    });
  }

  /**
   * Builds escaped template parameters for a member. Every user-controlled
   * value is HTML-escaped: the rendered text is sent with parse_mode=HTML and
   * a hostile display name must not inject markup into group messages.
   *
   * @param {MemberLike} member - Telegram member (first_name/last_name/username/id).
   * @param {string | undefined} chatTitle - Group title.
   * @param {string} botName - Bot display name.
   * @returns {Record<string, string | number>} Placeholder values.
   */
  private templateParams(
    member: MemberLike,
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
   * Sends a greeting with optional media and inline buttons. Media arrives
   * as an uploaded `data:` URL (bytes sent via InputFile, no public host
   * needed), an http(s) URL, or a Telegram file_id. Failures are logged, and
   * an HTML send rejected by Telegram's entity parser (raw `<` or `&` in the
   * template) falls back to plain text so the greeting is never silently
   * dropped.
   *
   * @param {Api} api - Telegram API adapter.
   * @param {number} chatId - Target chat id.
   * @param {string} text - Rendered message (HTML).
   * @param {Record<string, unknown>} config - Effective module config.
   * @returns {Promise<{message_id: number} | null>} Sent message, or null.
   */
  private async sendGreeting(
    api: Api,
    chatId: number,
    text: string,
    config: Record<string, unknown>,
  ): Promise<{ message_id: number } | null> {
    const buttons = this.parseButtons(config.buttonsJson);
    const markup = buttons ? this.toKeyboard(buttons) : undefined;
    const caption = { caption: text, parse_mode: 'HTML' as const, reply_markup: markup };
    const media = typeof config.mediaUrl === 'string' ? config.mediaUrl.trim() : '';

    if (media) {
      const sent = await this.sendMedia(api, chatId, media, caption);
      if (sent) return sent;
      // Media unusable: fall through and deliver the text greeting.
    }

    const sent = await api
      .sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: markup })
      .catch((err: unknown) => {
        this.logger.warn(
          `Welcome message send failed in chat ${chatId}: ${this.describeError(err)}`,
        );
        return null;
      });
    if (sent) return sent;

    const plain = this.stripHtml(text);
    if (plain === text) return null;
    return api.sendMessage(chatId, plain, { reply_markup: markup }).catch((err: unknown) => {
      this.logger.warn(
        `Welcome plain-text fallback failed in chat ${chatId}: ${this.describeError(err)}`,
      );
      return null;
    });
  }

  /**
   * Delivers greeting media in whichever form it was configured: uploaded
   * bytes (data: URL) as an InputFile, an http(s) URL by link kind, or an
   * opaque Telegram file_id (photo first, video as retry).
   *
   * @param {Api} api - Telegram API adapter.
   * @param {number} chatId - Target chat id.
   * @param {string} media - data: URL, http(s) URL, or file_id.
   * @param {Record<string, unknown>} caption - Caption/parse_mode/reply_markup options.
   * @returns {Promise<{message_id: number} | null>} Sent media message, or null.
   */
  private async sendMedia(
    api: Api,
    chatId: number,
    media: string,
    caption: Record<string, unknown>,
  ): Promise<{ message_id: number } | null> {
    if (media.startsWith('data:')) {
      const uploaded = this.parseDataUrl(media);
      if (!uploaded) {
        this.logger.warn(`Welcome media data URL could not be parsed in chat ${chatId}`);
        return null;
      }
      return this.sendFileMedia(
        api,
        chatId,
        new InputFile(uploaded.buffer, uploaded.fileName),
        uploaded.mime,
        caption,
      );
    }

    if (/^https?:\/\//i.test(media)) {
      const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(media);
      const isAnimation = /\.gif(\?|$)/i.test(media);
      if (isAnimation) {
        return await api.sendAnimation(chatId, media, caption).catch((err: unknown) => {
          this.logger.warn(
            `Welcome animation send failed in chat ${chatId}: ${this.describeError(err)}`,
          );
          return null;
        });
      }
      if (isVideo) {
        return await api.sendVideo(chatId, media, caption).catch((err: unknown) => {
          this.logger.warn(
            `Welcome video send failed in chat ${chatId}: ${this.describeError(err)}`,
          );
          return null;
        });
      }
      return await api.sendPhoto(chatId, media, caption).catch((err: unknown) => {
        this.logger.warn(`Welcome photo send failed in chat ${chatId}: ${this.describeError(err)}`);
        return null;
      });
    }

    // Opaque Telegram file_id: its media type is not visible, so try photo
    // first and retry as video when Telegram rejects it.
    const asPhoto = await api.sendPhoto(chatId, media, caption).catch(() => null);
    if (asPhoto) return asPhoto;
    return await api.sendVideo(chatId, media, caption).catch((err: unknown) => {
      this.logger.warn(
        `Welcome file_id media send failed in chat ${chatId}: ${this.describeError(err)}`,
      );
      return null;
    });
  }

  /**
   * Sends uploaded bytes as animation (GIF), video, or photo by MIME type.
   *
   * @param {Api} api - Telegram API adapter.
   * @param {number} chatId - Target chat id.
   * @param {InputFile} file - Upload payload.
   * @param {string} mime - Media MIME type.
   * @param {Record<string, unknown>} caption - Caption/parse_mode/reply_markup options.
   * @returns {Promise<{message_id: number} | null>} Sent media message, or null.
   */
  private async sendFileMedia(
    api: Api,
    chatId: number,
    file: InputFile,
    mime: string,
    caption: Record<string, unknown>,
  ): Promise<{ message_id: number } | null> {
    const isVideo = mime.startsWith('video/');
    const isAnimation = mime === 'image/gif';
    const attempt = isAnimation
      ? api.sendAnimation(chatId, file, caption)
      : isVideo
        ? api.sendVideo(chatId, file, caption)
        : api.sendPhoto(chatId, file, caption);
    return attempt.catch((err: unknown) => {
      this.logger.warn(
        `Welcome uploaded media send failed in chat ${chatId}: ${this.describeError(err)}`,
      );
      return null;
    });
  }

  /**
   * Decodes a `data:<mime>;base64,<payload>` URL into sendable bytes.
   *
   * @param {string} dataUrl - Data URL stored by the media upload field.
   * @returns {UploadedMedia | null} Decoded media, or null when malformed.
   */
  private parseDataUrl(dataUrl: string): UploadedMedia | null {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
    if (!match) return null;
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0) return null;
    const mime = match[1].toLowerCase();
    const extension = mime.split('/')[1]?.split('+')[0] ?? 'bin';
    const kind = mime.startsWith('video/') ? 'video' : mime === 'image/gif' ? 'animation' : 'photo';
    return { buffer, mime, fileName: `${kind}.${extension}` };
  }

  /**
   * Strips HTML markup for the plain-text fallback, preserving link text
   * (mention anchors degrade to the display name).
   *
   * @param {string} text - Rendered HTML message.
   * @returns {string} Message without markup.
   */
  private stripHtml(text: string): string {
    return text.replace(/<a\s+[^>]*>\s*([\s\S]*?)\s*<\/a>/gi, '$1').replace(/<[^>]+>/g, '');
  }

  /**
   * Normalizes an unknown error into a loggable message.
   *
   * @param {unknown} err - Thrown value.
   * @returns {string} Human-readable error description.
   */
  private describeError(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  /**
   * Parses a buttons JSON spec (tolerant): accepts every shape the visual
   * button builder emits — `{text, url}`, `{text, callback_data}`,
   * `{text, web_app: {url}}`, and `{text, copy_text: {text}}`.
   *
   * @param {unknown} raw - Stored buttons JSON string.
   * @returns {ButtonSpec[] | null} Parsed buttons, or null when none usable.
   */
  private parseButtons(raw: unknown): ButtonSpec[] | null {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      const buttons: ButtonSpec[] = [];
      for (const item of parsed) {
        if (!item || typeof item.text !== 'string') continue;
        const button: ButtonSpec = { text: String(item.text) };
        if (typeof item.url === 'string') button.url = String(item.url);
        if (typeof item.callback_data === 'string')
          button.callbackData = String(item.callback_data);
        if (item.web_app && typeof item.web_app.url === 'string') {
          button.webAppUrl = String(item.web_app.url);
        }
        if (item.copy_text && typeof item.copy_text.text === 'string') {
          button.copyText = String(item.copy_text.text);
        }
        if (
          button.url === undefined &&
          button.callbackData === undefined &&
          button.webAppUrl === undefined &&
          button.copyText === undefined
        ) {
          continue;
        }
        buttons.push(button);
      }
      return buttons.length > 0 ? buttons : null;
    } catch {
      return null;
    }
  }

  /**
   * Wraps button specs one per row (matching the autoresponder convention).
   *
   * @param {ButtonSpec[]} buttons - Parsed button specs.
   * @returns {InlineKeyboard} Keyboard with one button per row.
   */
  private toKeyboard(buttons: ButtonSpec[]): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    for (const button of buttons) {
      if (button.url !== undefined) keyboard.url(button.text, button.url);
      else if (button.callbackData !== undefined) keyboard.text(button.text, button.callbackData);
      else if (button.webAppUrl !== undefined) keyboard.webApp(button.text, button.webAppUrl);
      else if (button.copyText !== undefined) keyboard.copyText(button.text, button.copyText);
      keyboard.row();
    }
    return keyboard;
  }

  /**
   * Guard: group + change_info permission.
   */
  private async guard(c: Context, botId: string): Promise<number | null> {
    void botId;
    if (c.chat?.type !== 'supergroup' && c.chat?.type !== 'group') return null;
    if (!c.from) return null;
    if (!(await this.adminGate.hasCapability(c.api, c.chat.id, c.from.id, 'change_info'))) {
      return null;
    }
    return c.chat.id;
  }

  /**
   * Handles /setwelcome and /setgoodbye (text, or caption for replied media).
   */
  private async handleSet(c: Context, botId: string, field: string): Promise<void> {
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
    c: Context,
    botId: string,
    field: string,
    resetField: string,
  ): Promise<void> {
    const chatId = await this.guard(c, botId);
    if (chatId === null) return;
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    delete override[resetField];
    if (Object.keys(override).length === 0) {
      await this.chatSettings.clearOverride(botId, chatId, this.moduleKey);
    } else {
      await this.chatSettings.setOverride(botId, chatId, this.moduleKey, override);
    }
    await c.reply('✅').catch(() => undefined);
  }

  /**
   * Handles /welcome and /goodbye — view (noformat) or toggle on/off.
   */
  private async handleView(
    c: Context,
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
    await this.sendGreeting(c.api, c.chat!.id, text || '—', {});
  }
}
