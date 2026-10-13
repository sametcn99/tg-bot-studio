import { Injectable } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';

/**
 * Pending captcha state kept in memory per (bot, chat, user).
 * @interface PendingCaptcha
 * @property {string} nonce - Random token bound to the inline button.
 * @property {number} answer - Expected math answer (math mode).
 * @property {number} captchaMessageId - Id of the challenge message.
 */
interface PendingCaptcha {
  nonce: string;
  answer: number;
  captchaMessageId: number;
}

/**
 * Runtime for the Captcha Gatekeeper module. New group members must pass a
 * button or math challenge within the configured window or be kicked
 * (ban + unban), providing anti-raid protection.
 */
@Injectable()
export class CaptchaRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'captcha';

  private readonly pending = new Map<string, PendingCaptcha>();

  /**
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(registry: ModuleHandlerRegistry) {
    super();
    registry.register(this);
  }

  /**
   * Attaches captcha challenge middleware to the bot.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot } = ctx;
    const mode = String(ctx.config.mode ?? 'button');
    const timeoutSeconds = Number(ctx.config.timeoutSeconds ?? 120);
    const kickOnFail = ctx.config.kickOnFail !== false;
    const successText = String(ctx.config.successText ?? 'Verification successful.');

    bot.on('message:new_chat_members', async (update) => {
      for (const member of update.msg.new_chat_members ?? []) {
        if (member.is_bot) continue;
        const key = `${ctx.botId}:${update.chat.id}:${member.id}`;
        const nonce = crypto.randomUUID().slice(0, 8);

        if (mode === 'math') {
          const a = 2 + Math.floor(Math.random() * 8);
          const b = 1 + Math.floor(Math.random() * 9);
          const sent = await update.reply(
            `Welcome ${member.first_name}. To verify you are human, reply with the result of ${a} + ${b} within ${timeoutSeconds} seconds.`,
          );
          this.pending.set(key, {
            nonce,
            answer: a + b,
            captchaMessageId: sent.message_id,
          });
        } else {
          const keyboard = new InlineKeyboard().text('Verify', `captcha:${member.id}:${nonce}`);
          const sent = await update.reply(
            `Welcome ${member.first_name}. Tap the button below within ${timeoutSeconds} seconds to verify you are human.`,
            { reply_markup: keyboard },
          );
          this.pending.set(key, {
            nonce,
            answer: 0,
            captchaMessageId: sent.message_id,
          });
        }

        this.scheduleKick(ctx, key, update.chat.id, member.id, timeoutSeconds, kickOnFail);
      }
    });

    bot.on('callback_query:data', async (update) => {
      if (!update.callbackQuery.data.startsWith('captcha:')) return;
      if (!update.callbackQuery.message) return;
      const [, userIdRaw, nonce] = update.callbackQuery.data.split(':');
      const chatId = update.callbackQuery.message.chat.id;
      const key = `${ctx.botId}:${chatId}:${userIdRaw}`;
      const pending = this.pending.get(key);
      if (!pending || pending.nonce !== nonce) {
        await update.answerCallbackQuery({ text: 'This challenge is no longer valid.' });
        return;
      }
      this.pending.delete(key);
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
      await update.answerCallbackQuery({ text: 'Verified' });
      await bot.api.deleteMessage(chatId, pending.captchaMessageId).catch(() => undefined);
      await bot.api.sendMessage(chatId, successText);
    });

    // Math-mode answer handling.
    bot.on('message:text', (update) => {
      if (update.chat?.type !== 'supergroup' && update.chat?.type !== 'group') return;
      if (!update.from) return;
      const key = `${ctx.botId}:${update.chat.id}:${update.from.id}`;
      const pending = this.pending.get(key);
      if (!pending || pending.answer === 0) return;
      if (Number(update.msg.text.trim()) === pending.answer) {
        this.pending.delete(key);
        clearTimeout(this.timers.get(key));
        this.timers.delete(key);
        void bot.api.deleteMessage(update.chat.id, pending.captchaMessageId).catch(() => undefined);
        void update.reply(successText);
      }
    });
  }

  /** Kick timers bound to pending captchas. */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Schedules the kick of an unverified member.
   * @param {ModuleRuntimeContext} ctx - Runtime context.
   * @param {string} key - Pending captcha map key.
   * @param {number} chatId - Group chat id.
   * @param {number} userId - Member Telegram id.
   * @param {number} timeoutSeconds - Grace period.
   * @param {boolean} kickOnFail - Whether to kick on timeout.
   * @returns {void}
   */
  private scheduleKick(
    ctx: ModuleRuntimeContext,
    key: string,
    chatId: number,
    userId: number,
    timeoutSeconds: number,
    kickOnFail: boolean,
  ): void {
    const timer = setTimeout(() => {
      const pending = this.pending.get(key);
      this.pending.delete(key);
      this.timers.delete(key);
      if (!pending || !kickOnFail) return;
      void ctx.bot.api
        .banChatMember(chatId, userId, { until_date: 0 })
        .then(() => ctx.bot.api.unbanChatMember(chatId, userId, { only_if_banned: true }))
        .catch(() => undefined);
    }, timeoutSeconds * 1000);
    this.timers.set(key, timer);
  }
}
