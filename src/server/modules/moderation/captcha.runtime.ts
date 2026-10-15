import { Injectable } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { PrismaService } from '../../database/prisma.service';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { ChatSettingsService } from '../../bot-engine/chat-settings.service';
import { RestrictionsService } from '../../bot-engine/restrictions.service';
import { AdminLogService } from '../../bot-engine/admin-log.service';
import { BotI18nService } from '../../bot-engine/bot-i18n.service';

/**
 * Pending captcha state kept in memory per (bot, chat, user).
 * @interface PendingCaptcha
 * @property {string} nonce - Random token bound to the inline button.
 * @property {number} answer - Expected math answer (math modes).
 * @property {number} captchaMessageId - Id of the challenge message.
 * @property {number} chatId - Group the challenge belongs to.
 * @property {number} userId - Member being challenged.
 * @property {boolean} joinRequest - True when tied to a join request.
 */
interface PendingCaptcha {
  nonce: string;
  answer: number;
  captchaMessageId: number;
  chatId: number;
  userId: number;
  joinRequest: boolean;
}

/**
 * Runtime for the Captcha Gatekeeper module (v2): button, in-group math, and
 * PM math modes; "solve once per group" persistence via ChatMemberState;
 * configurable kick timers, mute-release timers, rules acceptance text, and
 * join-request integration (challenge in PM → auto-approve).
 */
@Injectable()
export class CaptchaRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'captcha';

  private readonly pending = new Map<string, PendingCaptcha>();

  /** Kick timers bound to pending captchas. */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * @param {PrismaService} prisma - Prisma ORM access service.
   * @param {ChatSettingsService} chatSettings - Per-chat config layer.
   * @param {RestrictionsService} restrictions - Shared action executor.
   * @param {AdminLogService} adminLog - Admin action log bus.
   * @param {BotI18nService} i18n - Bot-reply localization.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatSettings: ChatSettingsService,
    private readonly restrictions: RestrictionsService,
    private readonly adminLog: AdminLogService,
    private readonly i18n: BotI18nService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches captcha challenge middleware to the bot.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot, botId } = ctx;

    bot.on('message:new_chat_members', async (update) => {
      if (update.chat?.type !== 'supergroup' && update.chat?.type !== 'group') return;
      for (const member of update.msg.new_chat_members ?? []) {
        if (member.is_bot) continue;
        await this.challenge(ctx, update.chat.id, member, false);
      }
    });

    // Join requests: challenge in PM, auto-approve on success.
    bot.on('chat_join_request', async (update) => {
      const chat = update.chatJoinRequest.chat;
      const chatType = chat.type as string;
      if (chatType !== 'supergroup' && chatType !== 'group') return;
      const config = await this.chatSettings.getEffectiveConfig(botId, chat.id, this.moduleKey);
      if (config.joinRequestIntegration !== true) return;
      await this.challenge(ctx, chat.id, update.chatJoinRequest.from, true);
    });

    bot.on('callback_query:data', async (update) => {
      if (!update.callbackQuery.data.startsWith('captcha:')) return;
      const [, userIdRaw, nonce] = update.callbackQuery.data.split(':');
      const chatId = Number(update.callbackQuery.message?.chat.id ?? 0);
      const key = `${botId}:${chatId}:${userIdRaw}`;
      const pending = this.pending.get(key);
      if (!pending || pending.nonce !== nonce) {
        await update
          .answerCallbackQuery({ text: 'This challenge is no longer valid.' })
          .catch(() => undefined);
        return;
      }
      await this.verify(ctx, key, update.callbackQuery.from.first_name);
      await update.answerCallbackQuery({ text: '✅' }).catch(() => undefined);
    });

    // Math-mode answer handling (in-group text or PM).
    bot.on('message:text', async (update) => {
      const chatType = update.chat?.type;
      const isGroup = chatType === 'supergroup' || chatType === 'group';
      const isPrivate = chatType === 'private';
      if (!isGroup && !isPrivate) return;
      if (!update.from || update.from.id === bot.botInfo?.id) return;

      // In groups only the challenged member's numeric reply counts.
      const groupKey = isGroup ? `${botId}:${update.chat!.id}:${update.from.id}` : null;
      const pmCandidates = [...this.pending.entries()].filter(
        ([key, value]) => key.endsWith(`:${update.from!.id}`) && value.captchaMessageId === -1,
      );
      const key = groupKey && this.pending.has(groupKey) ? groupKey : pmCandidates[0]?.[0];
      if (!key) return;
      const pending = this.pending.get(key)!;
      if (pending.answer === 0) return;
      if (Number(update.msg.text.trim()) !== pending.answer) return;

      await this.verify(ctx, key, update.from.first_name);
      if (isPrivate && !pending.joinRequest) {
        await update.reply('✅').catch(() => undefined);
      }
    });

    // /kick resets the solved flag so the member re-solves on next join.
    bot.command('kick', async (update) => {
      const target = update.msg?.reply_to_message?.from;
      if (!target) return;
      await this.prisma.chatMemberState
        .update({
          where: {
            botId_chatId_telegramId: {
              botId,
              chatId: String(update.chat.id),
              telegramId: target.id,
            },
          },
          data: { captchaVerified: 0 },
        })
        .catch(() => undefined);
    });
  }

  /**
   * Starts a captcha challenge for a member (skipping already-verified
   * members and muting them until solved, reference-style).
   *
   * @param {ModuleRuntimeContext} ctx - Runtime context.
   * @param {number} chatId - Group chat id.
   * @param {import('grammy/types').User} member - Joining member.
   * @param {boolean} joinRequest - Whether this came via a join request.
   * @returns {Promise<void>} Resolves once the challenge is out.
   */
  private async challenge(
    ctx: ModuleRuntimeContext,
    chatId: number,
    member: import('grammy/types').User,
    joinRequest: boolean,
  ): Promise<void> {
    const { bot, botId } = ctx;
    const key = `${botId}:${chatId}:${member.id}`;

    const config = await this.chatSettings.getEffectiveConfig(botId, chatId, this.moduleKey);
    const mode = String(config.mode ?? 'button');
    const timeoutSeconds = Number(config.timeoutSeconds ?? 120);
    const kickOnFail = config.kickOnFail !== false;
    const successText = String(config.successText ?? 'Verification successful.');
    const lang = await this.i18n.getChatLanguage(botId, chatId);

    // Solved once per group: skip repeat joiners (persisted).
    const state = await this.prisma.chatMemberState
      .findUnique({
        where: {
          botId_chatId_telegramId: { botId, chatId: String(chatId), telegramId: member.id },
        },
      })
      .catch(() => null);
    if (state?.captchaVerified === 1) return;

    const nonce = crypto.randomUUID().slice(0, 8);
    let answer = 0;
    let sent: { message_id: number } | null;

    // reference-style challenge: mute until verified.
    if (!joinRequest) {
      await this.restrictions.mute(bot.api, chatId, member.id);
    }

    if (mode === 'pm-math') {
      const a = 2 + Math.floor(Math.random() * 8);
      const b = 1 + Math.floor(Math.random() * 9);
      answer = a + b;
      // captchaMessageId -1 marks a PM challenge (no group message to clean).
      sent = await bot.api
        .sendMessage(
          member.id,
          `${this.i18n.t(lang, 'captcha.welcomeCaptcha', { user: member.first_name })}\n${a} + ${b} = ?`,
        )
        .catch(() => null);
      if (!sent) {
        // User never started the bot: fall back to a group button challenge.
        const keyboard = new InlineKeyboard().text('Verify', `captcha:${member.id}:${nonce}`);
        sent = await bot.api
          .sendMessage(
            chatId,
            this.i18n.t(lang, 'captcha.welcomeCaptcha', { user: member.first_name }),
            {
              reply_markup: keyboard,
            },
          )
          .catch(() => null);
        answer = 0;
      }
    } else if (mode === 'math') {
      const a = 2 + Math.floor(Math.random() * 8);
      const b = 1 + Math.floor(Math.random() * 9);
      answer = a + b;
      sent = await bot.api
        .sendMessage(
          chatId,
          `${this.i18n.t(lang, 'captcha.welcomeCaptcha', { user: member.first_name })} ${a} + ${b} = ? (${timeoutSeconds}s)`,
        )
        .catch(() => null);
    } else {
      const keyboard = new InlineKeyboard().text(
        String(config.buttonText ?? 'Verify'),
        `captcha:${member.id}:${nonce}`,
      );
      sent = await bot.api
        .sendMessage(
          chatId,
          this.i18n.t(lang, 'captcha.welcomeCaptcha', { user: member.first_name }),
          {
            reply_markup: keyboard,
          },
        )
        .catch(() => null);
    }

    if (!sent) return;
    this.pending.set(key, {
      nonce,
      answer,
      captchaMessageId: sent.message_id,
      chatId,
      userId: member.id,
      joinRequest,
    });
    this.scheduleExpiry(ctx, key, chatId, member.id, timeoutSeconds, kickOnFail, successText);
  }

  /**
   * Marks a challenge solved: unmutes (or approves the join request),
   * persists the verified flag, cleans up timers and messages.
   */
  private async verify(ctx: ModuleRuntimeContext, key: string, firstName: string): Promise<void> {
    const { bot, botId } = ctx;
    const pending = this.pending.get(key);
    if (!pending) return;
    this.pending.delete(key);
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);

    const config = await this.chatSettings.getEffectiveConfig(
      botId,
      pending.chatId,
      this.moduleKey,
    );
    const successText = String(config.successText ?? 'Verification successful.');

    await this.prisma.chatMemberState
      .upsert({
        where: {
          botId_chatId_telegramId: {
            botId,
            chatId: String(pending.chatId),
            telegramId: pending.userId,
          },
        },
        create: {
          botId,
          chatId: String(pending.chatId),
          telegramId: pending.userId,
          captchaVerified: 1,
          updatedAt: new Date().toISOString(),
        },
        update: { captchaVerified: 1 },
      })
      .catch(() => undefined);

    if (pending.joinRequest) {
      await bot.api.approveChatJoinRequest(pending.chatId, pending.userId).catch(() => undefined);
    } else {
      await this.restrictions.unmute(bot.api, pending.chatId, pending.userId);
      if (pending.captchaMessageId > 0) {
        await bot.api
          .deleteMessage(pending.chatId, pending.captchaMessageId)
          .catch(() => undefined);
      }
      await bot.api.sendMessage(pending.chatId, successText).catch(() => undefined);
    }

    this.adminLog.emit({
      botId,
      chatId: pending.chatId,
      category: 'user',
      text: `${firstName} passed the captcha`,
    });
  }

  /**
   * Schedules what happens when a challenge expires: kick (ban+unban) or
   * auto-unmute (captchamutetime), reference-style.
   */
  private scheduleExpiry(
    ctx: ModuleRuntimeContext,
    key: string,
    chatId: number,
    userId: number,
    timeoutSeconds: number,
    kickOnFail: boolean,
    successText: string,
  ): void {
    void successText;
    const timer = setTimeout(() => {
      const pending = this.pending.get(key);
      this.pending.delete(key);
      this.timers.delete(key);
      if (!pending) return;

      const expiry = (async () => {
        if (kickOnFail) {
          await this.restrictions.kick(ctx.bot.api, chatId, userId);
          if (pending.captchaMessageId > 0) {
            await ctx.bot.api
              .deleteMessage(chatId, pending.captchaMessageId)
              .catch(() => undefined);
          }
          this.adminLog.emit({
            botId: ctx.botId,
            chatId,
            category: 'automated',
            text: `Captcha expired → kicked ${userId}`,
          });
          return;
        }
        // No kick: release the mute after the configured window.
        await this.restrictions.unmute(ctx.bot.api, chatId, userId);
      })();
      void expiry.catch(() => undefined);
    }, timeoutSeconds * 1000);
    this.timers.set(key, timer);
  }
}
