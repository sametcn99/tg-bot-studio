import { Injectable } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { PrismaService } from '../../database/prisma.service';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { BotI18nService } from '../../bot-engine/bot-i18n.service';

/**
 * Runtime for the Privacy module (reference /privacy parity): a PM command that
 * shows users everything this bot stores about them and offers a
 * one-click "delete my data" flow (profile, warns, AI history, support
 * relay copies, activity buckets, and captcha/approval state).
 */
@Injectable()
export class PrivacyRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'privacy';

  /**
   * @param {PrismaService} prisma - Prisma ORM access service.
   * @param {BotI18nService} i18n - Bot-reply localization.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: BotI18nService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches the /privacy PM command and its callback buttons.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot, botId } = ctx;

    bot.command('privacy', async (c) => {
      if (c.chat?.type !== 'private' || !c.from) return;
      const lang = (await this.i18n.getChatLanguage(botId, c.from.id)) ?? 'en';
      const summary = await this.collectSummary(botId, c.from.id);
      if (!summary) {
        await c.reply(this.i18n.t(lang, 'privacy.noData')).catch(() => undefined);
        return;
      }
      await c
        .reply(`${this.i18n.t(lang, 'privacy.intro')}\n\n${summary}`, {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard()
            .text('🗑 Delete my data', `privacy:delete:${c.from.id}`)
            .text('✅ Keep it', `privacy:keep:${c.from.id}`),
        })
        .catch(() => undefined);
    });

    bot.callbackQuery(/^privacy:(delete|keep):(\d+)$/, async (c) => {
      const action = c.match[1];
      const userId = Number(c.match[2]);
      if (!c.from || c.from.id !== userId) {
        await c.answerCallbackQuery().catch(() => undefined);
        return;
      }
      const lang = await this.i18n.getChatLanguage(botId, userId);
      if (action === 'keep') {
        await c.answerCallbackQuery().catch(() => undefined);
        return;
      }
      await this.deleteUserData(botId, userId);
      await c
        .editMessageText(this.i18n.t(lang, 'privacy.deleted'), { parse_mode: 'HTML' })
        .catch(() => undefined);
      await c.answerCallbackQuery().catch(() => undefined);
    });

    void bot;
  }

  /**
   * Collects a human-readable summary of stored data for a user.
   *
   * @param {number} botId - Studio bot id.
   * @param {number} telegramId - Telegram user id.
   * @returns {Promise<string | null>} HTML summary, or null when nothing stored.
   */
  private async collectSummary(botId: number, telegramId: number): Promise<string | null> {
    const [profile, warns, aiHistory, support, activity, memberState] = await Promise.all([
      this.prisma.botUser.findUnique({
        where: { botId_telegramId: { botId, telegramId: BigInt(telegramId) } },
      }),
      this.prisma.chatWarn.count({ where: { botId, telegramId: BigInt(telegramId) } }),
      this.prisma.aiChatHistory.count({ where: { botId, telegramId: BigInt(telegramId) } }),
      this.prisma.supportMessage.count({ where: { botId, telegramId: BigInt(telegramId) } }),
      this.prisma.chatActivity.count({
        where: { botId, telegramId: BigInt(telegramId) },
      }),
      this.prisma.chatMemberState.count({ where: { botId, telegramId: BigInt(telegramId) } }),
    ]);

    if (
      !profile &&
      warns === 0 &&
      aiHistory === 0 &&
      support === 0 &&
      activity === 0 &&
      memberState === 0
    ) {
      return null;
    }

    const lines = [
      profile
        ? `• <b>Profile</b>: @${profile.username ?? '—'}, points ${profile.points}, first seen ${profile.firstSeenAt ?? '—'}`
        : null,
      warns > 0 ? `• <b>Warnings</b>: ${warns}` : null,
      aiHistory > 0 ? `• <b>AI chat history</b>: ${aiHistory} message(s)` : null,
      support > 0 ? `• <b>Support messages</b>: ${support}` : null,
      activity > 0 ? `• <b>Activity records</b>: ${activity}` : null,
      memberState > 0 ? `• <b>Group state</b> (captcha/verification): ${memberState}` : null,
    ].filter(Boolean);
    return lines.join('\n');
  }

  /**
   * Deletes (or anonymizes where deletion breaks accounting) all data of a
   * user across this bot.
   */
  private async deleteUserData(botId: number, telegramId: number): Promise<void> {
    const scope = { botId, telegramId: BigInt(telegramId) };
    await this.prisma.$transaction([
      this.prisma.botUser.deleteMany({ where: scope }),
      this.prisma.chatWarn.deleteMany({ where: scope }),
      this.prisma.aiChatHistory.deleteMany({ where: scope }),
      this.prisma.supportMessage.deleteMany({ where: scope }),
      this.prisma.chatActivity.deleteMany({ where: scope }),
      this.prisma.chatMemberState.deleteMany({ where: scope }),
      this.prisma.chatApproval.deleteMany({ where: scope }),
      this.prisma.dripSubscriber.deleteMany({ where: scope }),
    ]);
  }
}
