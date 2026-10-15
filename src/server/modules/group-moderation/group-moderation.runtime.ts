import { Injectable } from '@nestjs/common';
import type { Context } from 'grammy';
import { PrismaService } from '../../database/prisma.service';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { AdminGateService, type AdminCapability } from '../../bot-engine/admin-gate.service';
import { AdminLogService } from '../../bot-engine/admin-log.service';
import { BotI18nService, type BotLanguage } from '../../bot-engine/bot-i18n.service';
import { ChatSettingsService } from '../../bot-engine/chat-settings.service';
import { RestrictionsService } from '../../bot-engine/restrictions.service';
import { splitDurationArg, formatDuration } from '../../common/utils/duration.util';
import { escapeHtml, resolveTarget, userMentionHtml } from '../../common/utils/telegram-text.util';

/** Hard cap for a single /purge sweep (mirrors the reference bot's practical ceiling). */
const PURGE_HARD_CAP = 500;

/** Parsed restriction command invocation. */
interface RestrictionInvocation {
  /** Target user id (numeric arg, or replied author). */
  userId: number | null;
  /** Username (without @) when the target arg was @-prefixed. */
  username?: string;
  /** Optional duration in seconds for timed variants. */
  durationSeconds: number | null;
  /** Remaining reason text. */
  reason: string;
  /** Author of the replied-to message, when present. */
  replyUserId: number | null;
}

/**
 * Runtime for the reference-parity Group Moderation Commands module: manual
 * ban/mute/kick/warn/purge commands, silent + delete variants, approvals,
 * and warn-mode settings — all permission-checked against native Telegram
 * admin rights and localized per chat.
 */
@Injectable()
export class GroupModerationRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'group-moderation';

  /** Purges-in-progress keyed by chat id (purgefrom anchor message). */
  private readonly purgeAnchors = new Map<number, number>();

  /**
   * @param {PrismaService} prisma - Prisma ORM access service.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   * @param {AdminGateService} adminGate - Telegram permission gate.
   * @param {RestrictionsService} restrictions - Shared action executor.
   * @param {AdminLogService} adminLog - Admin action log bus.
   * @param {BotI18nService} i18n - Bot-reply localization.
   * @param {ChatSettingsService} chatSettings - Per-chat config layer.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminGate: AdminGateService,
    private readonly restrictions: RestrictionsService,
    private readonly adminLog: AdminLogService,
    private readonly i18n: BotI18nService,
    private readonly chatSettings: ChatSettingsService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches every in-group moderation command to the bot.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot, botId } = ctx;

    // --- Ban family -------------------------------------------------------
    bot.command('ban', (c) => this.handleRestriction(c, botId, 'ban'));
    bot.command('tban', (c) => this.handleRestriction(c, botId, 'tban'));
    bot.command('dban', (c) => this.handleRestriction(c, botId, 'ban', { delete: true }));
    bot.command('sban', (c) => this.handleRestriction(c, botId, 'ban', { silent: true }));
    bot.command('unban', (c) => this.handleUnban(c, botId));

    // --- Mute family ------------------------------------------------------
    bot.command('mute', (c) => this.handleRestriction(c, botId, 'mute'));
    bot.command('tmute', (c) => this.handleRestriction(c, botId, 'tmute'));
    bot.command('dmute', (c) => this.handleRestriction(c, botId, 'mute', { delete: true }));
    bot.command('smute', (c) => this.handleRestriction(c, botId, 'mute', { silent: true }));
    bot.command('unmute', (c) => this.handleUnmute(c, botId));

    // --- Kick family ------------------------------------------------------
    bot.command('kick', (c) => this.handleRestriction(c, botId, 'kick'));
    bot.command('dkick', (c) => this.handleRestriction(c, botId, 'kick', { delete: true }));
    bot.command('skick', (c) => this.handleRestriction(c, botId, 'kick', { silent: true }));
    bot.command('kickme', (c) => this.handleKickme(c, botId));

    // --- Warnings ---------------------------------------------------------
    bot.command('warn', (c) => this.handleWarn(c, botId, {}));
    bot.command('dwarn', (c) => this.handleWarn(c, botId, { delete: true }));
    bot.command('swarn', (c) => this.handleWarn(c, botId, { silent: true }));
    bot.command('rmwarn', (c) => this.handleRemoveWarn(c, botId, false));
    bot.command('resetwarn', (c) => this.handleRemoveWarn(c, botId, true));
    bot.command('warns', (c) => this.handleListWarns(c, botId));
    bot.command('setwarnlimit', (c) => this.handleSetWarnLimit(c, botId));
    bot.command('setwarnmode', (c) => this.handleSetWarnMode(c, botId));
    bot.command('warntime', (c) => this.handleWarnTime(c, botId));

    // --- Purges -----------------------------------------------------------
    bot.command('del', (c) => this.handleDeleteSingle(c, botId));
    bot.command('purge', (c) => this.handlePurge(c, botId, false));
    bot.command('spurge', (c) => this.handlePurge(c, botId, true));
    bot.command('purgefrom', (c) => this.handlePurgeFrom(c, botId));
    bot.command('purgeto', (c) => this.handlePurgeTo(c, botId));

    // --- Approvals --------------------------------------------------------
    bot.command('approve', (c) => this.handleApprove(c, botId));
    bot.command('unapprove', (c) => this.handleUnapprove(c, botId));
    bot.command('approval', (c) => this.handleApprovalStatus(c, botId));
    bot.command('approved', (c) => this.handleApprovedList(c, botId));
    bot.command('unapproveall', (c) => this.handleUnapproveAll(c, botId));

    // --- Housekeeping -----------------------------------------------------
    bot.command('silentactions', (c) => this.handleSilentActions(c, botId));
    bot.command('adminerror', (c) => this.handleAdminError(c, botId));
    bot.command('admincache', (c) => this.handleAdminCache(c, botId));

    // "Remove warn" button on warning messages (reference parity).
    bot.callbackQuery(/^gm:rmwarn:(-?\d+):(\d+)$/, (c) =>
      this.handleRemoveWarnButton(c, botId, Number(c.match[1]), Number(c.match[2])),
    );
  }

  /**
   * Ensures the update runs in a group chat and returns its language.
   *
   * @param {Context} c - grammY command context.
   * @param {number} botId - Studio bot id.
   * @returns {Promise<{ chatId: number; lang: BotLanguage } | null>} Null when
   * the command arrived outside a group or from an authorless update.
   */
  private async groupContext(
    c: Context,
    botId: number,
  ): Promise<{ chatId: number; lang: BotLanguage } | null> {
    if (c.chat?.type !== 'supergroup' && c.chat?.type !== 'group') return null;
    if (!c.from) return null;
    // Bot-to-bot gate: other bots may only use commands per the chat's
    // bot2bot mode (off / admin / all).
    if (c.from.is_bot) {
      const b2b = await this.chatSettings.getEffectiveConfig(botId, c.chat.id, 'bot2bot');
      const mode = String(b2b.mode ?? 'off');
      if (mode === 'off') return null;
      if (mode === 'admin' && !(await this.adminGate.isAdmin(c.api, c.chat.id, c.from.id))) {
        return null;
      }
    }
    const lang = await this.i18n.getChatLanguage(botId, c.chat.id);
    return { chatId: c.chat.id, lang };
  }

  /**
   * Permission guard: verifies the caller holds a capability, replying a
   * localized error (suppressed when adminerror is off).
   *
   * @param {Context} c - grammY command context.
   * @param {number} botId - Studio bot id.
   * @param {number} chatId - Group chat id.
   * @param {'en' | 'tr'} lang - Chat language.
   * @param {AdminCapability} capability - Required capability.
   * @returns {Promise<boolean>} True when the caller may proceed.
   */
  private async requireCapability(
    c: Context,
    botId: number,
    chatId: number,
    lang: BotLanguage,
    capability: AdminCapability,
  ): Promise<boolean> {
    const allowed = await this.adminGate.hasCapability(c.api, chatId, c.from!.id, capability);
    if (allowed) return true;
    const config = await this.chatSettings.getEffectiveConfig(botId, chatId, this.moduleKey);
    if (config.adminError !== false) {
      const isAdmin = await this.adminGate.isAdmin(c.api, chatId, c.from!.id);
      await c
        .reply(this.i18n.t(lang, isAdmin ? 'common.missingPermission' : 'common.adminOnly'))
        .catch(() => undefined);
    }
    return false;
  }

  /**
   * Parses a restriction command's arguments (target, duration, reason).
   *
   * @param {Context} c - grammY command context.
   * @param {boolean} needsDuration - True for timed variants.
   * @returns {RestrictionInvocation} Parsed invocation parts.
   */
  private parseInvocation(c: Context, needsDuration: boolean): RestrictionInvocation {
    const replyUser = c.msg?.reply_to_message?.from;
    const args = typeof c.match === 'string' ? c.match.trim() : '';
    const { userId, username, rest } = resolveTarget(args, replyUser);
    const { seconds, rest: reason } = needsDuration
      ? splitDurationArg(rest)
      : { seconds: null, rest };
    return {
      userId: userId ?? null,
      username,
      durationSeconds: seconds,
      reason,
      replyUserId: replyUser?.id ?? null,
    };
  }

  /**
   * Resolves the numeric user id for an invocation (@username resolved via
   * getChat; numeric ids and replies pass through).
   *
   * @param {Context} c - grammY command context.
   * @param {RestrictionInvocation} invocation - Parsed invocation.
   * @returns {Promise<number | null>} Numeric id, or null when unresolvable.
   */
  private async resolveUserId(
    c: Context,
    invocation: RestrictionInvocation,
  ): Promise<number | null> {
    if (invocation.userId) return invocation.userId;
    if (invocation.username) {
      const chat = await c.api.getChat(`@${invocation.username}`).catch(() => null);
      if (chat && chat.type === 'private') return Number(chat.id);
    }
    return invocation.replyUserId;
  }

  /**
   * Builds an HTML mention for a possibly-unknown target user.
   *
   * @param {Context} c - grammY command context.
   * @param {number} userId - Numeric target id.
   * @returns {Promise<string>} HTML-safe mention text.
   */
  private async describeUser(c: Context, userId: number): Promise<string> {
    const replied = c.msg?.reply_to_message?.from;
    if (replied && replied.id === userId) {
      return userMentionHtml(replied);
    }
    const member = await c.api.getChatMember(c.chat!.id, userId).catch(() => null);
    if (member) return userMentionHtml(member.user);
    return `<a href="tg://user?id=${userId}">User ${userId}</a>`;
  }

  /**
   * Shared restriction executor for ban/mute/kick families.
   *
   * @param {Context} c - grammY command context.
   * @param {number} botId - Studio bot id.
   * @param {'ban'|'tban'|'mute'|'tmute'|'kick'} action - Action family.
   * @param {object} [options] - Variant options (delete replied, silent).
   * @returns {Promise<void>}
   */
  private async handleRestriction(
    c: Context,
    botId: number,
    action: 'ban' | 'tban' | 'mute' | 'tmute' | 'kick',
    options: { delete?: boolean; silent?: boolean } = {},
  ): Promise<void> {
    const group = await this.groupContext(c, botId);
    if (!group) return;
    const { chatId, lang } = group;

    const capability: AdminCapability = 'restrict';
    if (!(await this.requireCapability(c, botId, chatId, lang, capability))) return;

    const invocation = this.parseInvocation(c, action === 'tban' || action === 'tmute');
    const targetId = await this.resolveUserId(c, invocation);
    if (!targetId) {
      await c.reply(this.i18n.t(lang, 'common.userNotFound')).catch(() => undefined);
      return;
    }
    if (targetId === c.from!.id && action !== 'kick') {
      await c.reply(this.i18n.t(lang, 'common.userNotFound')).catch(() => undefined);
      return;
    }

    const timed = action === 'tban' || action === 'tmute';
    const duration = invocation.durationSeconds;
    if (timed && !duration) {
      await c.reply(this.i18n.t(lang, 'common.invalidDuration')).catch(() => undefined);
      return;
    }

    // Admins cannot be punished through the bot (reference parity).
    if (await this.adminGate.isAdmin(c.api, chatId, targetId)) {
      await c.reply(this.i18n.t(lang, 'common.error')).catch(() => undefined);
      return;
    }

    // Bot-issued admin actions queue for human review (bot2bot safety).
    if (c.from!.is_bot) {
      const b2b = await this.chatSettings.getEffectiveConfig(botId, chatId, 'bot2bot');
      if (b2b.skipReview !== true) {
        await this.queueBotReview(
          c,
          botId,
          chatId,
          `/${action} → ${targetId} ${invocation.reason}`.trim(),
          async () => {
            const until = invocation.durationSeconds ?? 0;
            if (action === 'ban') await this.restrictions.ban(c.api, chatId, targetId);
            else if (action === 'tban') await this.restrictions.ban(c.api, chatId, targetId, until);
            else if (action === 'mute') await this.restrictions.mute(c.api, chatId, targetId);
            else if (action === 'tmute')
              await this.restrictions.mute(c.api, chatId, targetId, until);
            else if (action === 'kick') await this.restrictions.kick(c.api, chatId, targetId);
          },
        );
        return;
      }
    }

    const silentSetting = await this.chatSettings.getValue(
      botId,
      chatId,
      this.moduleKey,
      'silentActions',
    );
    const silent = options.silent === true || silentSetting === true;

    if (options.delete || silent) {
      if (c.msg?.reply_to_message) {
        await c.api.deleteMessage(chatId, c.msg.reply_to_message.message_id).catch(() => undefined);
      }
    }

    const reason = invocation.reason ? `Reason: ${escapeHtml(invocation.reason)}` : '';
    const mention = await this.describeUser(c, targetId);
    let ok = false;
    let messageKey = '';

    switch (action) {
      case 'ban':
        ok = await this.restrictions.ban(c.api, chatId, targetId);
        messageKey = 'restrictions.banned';
        break;
      case 'tban':
        ok = await this.restrictions.ban(c.api, chatId, targetId, duration!);
        messageKey = 'restrictions.tempBanned';
        break;
      case 'mute':
        ok = await this.restrictions.mute(c.api, chatId, targetId);
        messageKey = 'restrictions.muted';
        break;
      case 'tmute':
        ok = await this.restrictions.mute(c.api, chatId, targetId, duration!);
        messageKey = 'restrictions.tempMuted';
        break;
      case 'kick':
        ok = await this.restrictions.kick(c.api, chatId, targetId);
        messageKey = 'restrictions.kicked';
        break;
    }

    this.adminLog.emit({
      botId,
      chatId,
      category: 'admin',
      text: `${c.from!.first_name} → /${action} → ${mention} ${reason}`.trim(),
    });

    if (!ok) {
      if (!silent) {
        await c.reply(this.i18n.t(lang, 'common.error')).catch(() => undefined);
      }
      return;
    }

    if (silent) {
      await c.deleteMessage().catch(() => undefined);
      return;
    }

    await c
      .reply(
        this.i18n.t(lang, messageKey, {
          user: mention,
          reason,
          duration: duration ? formatDuration(duration) : '',
        }),
        { parse_mode: 'HTML' },
      )
      .catch(() => undefined);
  }

  /**
   * Handles /unban.
   */
  private async handleUnban(c: Context, botId: number): Promise<void> {
    const group = await this.groupContext(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.requireCapability(c, botId, chatId, lang, 'restrict'))) return;

    const invocation = this.parseInvocation(c, false);
    const targetId = await this.resolveUserId(c, invocation);
    if (!targetId) {
      await c.reply(this.i18n.t(lang, 'common.userNotFound')).catch(() => undefined);
      return;
    }
    const ok = await this.restrictions.unban(c.api, chatId, targetId);
    this.adminLog.emit({
      botId,
      chatId,
      category: 'admin',
      text: `${c.from!.first_name} → /unban → ${targetId}`,
    });
    if (ok) {
      await c
        .reply(
          this.i18n.t(lang, 'restrictions.unbanned', {
            user: await this.describeUser(c, targetId),
          }),
          {
            parse_mode: 'HTML',
          },
        )
        .catch(() => undefined);
    }
  }

  /**
   * Handles /unmute.
   */
  private async handleUnmute(c: Context, botId: number): Promise<void> {
    const group = await this.groupContext(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.requireCapability(c, botId, chatId, lang, 'restrict'))) return;

    const invocation = this.parseInvocation(c, false);
    const targetId = await this.resolveUserId(c, invocation);
    if (!targetId) {
      await c.reply(this.i18n.t(lang, 'common.userNotFound')).catch(() => undefined);
      return;
    }
    const ok = await this.restrictions.unmute(c.api, chatId, targetId);
    this.adminLog.emit({
      botId,
      chatId,
      category: 'admin',
      text: `${c.from!.first_name} → /unmute → ${targetId}`,
    });
    if (ok) {
      await c
        .reply(
          this.i18n.t(lang, 'restrictions.unmuted', { user: await this.describeUser(c, targetId) }),
          {
            parse_mode: 'HTML',
          },
        )
        .catch(() => undefined);
    }
  }

  /**
   * Handles /kickme — any member may remove themselves.
   */
  private async handleKickme(c: Context, botId: number): Promise<void> {
    const group = await this.groupContext(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (await this.adminGate.isAdmin(c.api, chatId, c.from!.id)) return; // admins can't kickme
    await c.reply(this.i18n.t(lang, 'restrictions.kickme')).catch(() => undefined);
    await this.restrictions.kick(c.api, chatId, c.from!.id);
    this.adminLog.emit({
      botId,
      chatId,
      category: 'user',
      text: `${c.from!.first_name} left via /kickme`,
    });
  }

  /**
   * Counts a user's unexpired warnings.
   *
   * @param {number} botId - Studio bot id.
   * @param {number} chatId - Group chat id.
   * @param {number} telegramId - Target user id.
   * @param {number} expirySeconds - Warn expiry (0 = never).
   * @returns {Promise<number>} Active warn count.
   */
  private async countWarns(
    botId: number,
    chatId: number,
    telegramId: number,
    expirySeconds: number,
  ): Promise<number> {
    const cutoff =
      expirySeconds > 0 ? new Date(Date.now() - expirySeconds * 1000).toISOString() : undefined;
    return this.prisma.chatWarn.count({
      where: {
        botId,
        chatId: String(chatId),
        telegramId: BigInt(telegramId),
        ...(cutoff ? { createdAt: { gte: cutoff } } : {}),
      },
    });
  }

  /**
   * Handles /warn, /dwarn, /swarn: records a warning and applies the warn
   * mode once the configured limit is reached.
   */
  private async handleWarn(
    c: Context,
    botId: number,
    options: { delete?: boolean; silent?: boolean },
  ): Promise<void> {
    const group = await this.groupContext(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.requireCapability(c, botId, chatId, lang, 'restrict'))) return;

    const invocation = this.parseInvocation(c, false);
    const targetId = await this.resolveUserId(c, invocation);
    if (!targetId || targetId === c.from!.id) {
      await c.reply(this.i18n.t(lang, 'common.userNotFound')).catch(() => undefined);
      return;
    }
    if (await this.adminGate.isAdmin(c.api, chatId, targetId)) {
      await c.reply(this.i18n.t(lang, 'common.error')).catch(() => undefined);
      return;
    }

    const config = await this.chatSettings.getEffectiveConfig(botId, chatId, this.moduleKey);
    const limit = Number(config.warnLimit ?? 3);
    const warnMode = String(config.warnMode ?? 'ban');
    const warnDuration = Number(config.warnDurationSeconds ?? 0);
    const warnTime = Number(config.warnTimeSeconds ?? 0);

    await this.prisma.chatWarn.create({
      data: {
        botId,
        chatId: String(chatId),
        telegramId: BigInt(targetId),
        reason: invocation.reason || 'No reason given',
        createdAt: new Date().toISOString(),
      },
    });

    if (options.delete || options.silent) {
      if (c.msg?.reply_to_message) {
        await c.api.deleteMessage(chatId, c.msg.reply_to_message.message_id).catch(() => undefined);
      }
    }

    const count = await this.countWarns(botId, chatId, targetId, warnTime);
    this.adminLog.emit({
      botId,
      chatId,
      category: 'admin',
      text: `${c.from!.first_name} → /warn (${count}/${limit}) → ${targetId}: ${invocation.reason}`,
    });

    if (limit > 0 && count >= limit) {
      await this.clearWarns(botId, chatId, targetId);
      await this.applyWarnMode(c, botId, chatId, targetId, warnMode, warnDuration);
      await c
        .reply(
          this.i18n.t(lang, 'warnings.warnLimitReached', {
            user: await this.describeUser(c, targetId),
          }),
          {
            parse_mode: 'HTML',
          },
        )
        .catch(() => undefined);
      return;
    }

    if (options.silent) {
      await c.deleteMessage().catch(() => undefined);
      return;
    }

    await c
      .reply(
        this.i18n.t(lang, 'warnings.warned', {
          user: await this.describeUser(c, targetId),
          count,
          limit,
          reason: escapeHtml(invocation.reason || ''),
        }),
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: 'Remove warn',
                  callback_data: `gm:rmwarn:${chatId}:${targetId}`,
                },
              ],
            ],
          },
        },
      )
      .catch(() => undefined);
  }

  /**
   * Applies the configured punishment when the warn limit is reached.
   */
  private async applyWarnMode(
    c: Context,
    botId: number,
    chatId: number,
    targetId: number,
    warnMode: string,
    warnDuration: number,
  ): Promise<void> {
    const duration = warnDuration > 0 ? warnDuration : undefined;
    switch (warnMode) {
      case 'kick':
        await this.restrictions.kick(c.api, chatId, targetId);
        break;
      case 'mute':
        await this.restrictions.mute(c.api, chatId, targetId);
        break;
      case 'tmute':
        await this.restrictions.mute(c.api, chatId, targetId, duration ?? 3_600);
        break;
      case 'tban':
        await this.restrictions.ban(c.api, chatId, targetId, duration ?? 86_400);
        break;
      case 'ban':
      default:
        await this.restrictions.ban(c.api, chatId, targetId);
        break;
    }
    this.adminLog.emit({
      botId,
      chatId,
      category: 'automated',
      text: `Warn limit reached → ${warnMode} → ${targetId}`,
    });
  }

  /**
   * Deletes every warning of a user in a chat.
   */
  private async clearWarns(botId: number, chatId: number, telegramId: number): Promise<void> {
    await this.prisma.chatWarn.deleteMany({
      where: { botId, chatId: String(chatId), telegramId: BigInt(telegramId) },
    });
  }

  /**
   * Handles /rmwarn (latest) and /resetwarn (all).
   */
  private async handleRemoveWarn(c: Context, botId: number, all: boolean): Promise<void> {
    const group = await this.groupContext(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.requireCapability(c, botId, chatId, lang, 'restrict'))) return;

    const invocation = this.parseInvocation(c, false);
    const targetId = await this.resolveUserId(c, invocation);
    if (!targetId) {
      await c.reply(this.i18n.t(lang, 'common.userNotFound')).catch(() => undefined);
      return;
    }
    const config = await this.chatSettings.getEffectiveConfig(botId, chatId, this.moduleKey);
    const warnTime = Number(config.warnTimeSeconds ?? 0);

    if (all) {
      await this.clearWarns(botId, chatId, targetId);
      await c
        .reply(
          this.i18n.t(lang, 'warnings.warnsReset', { user: await this.describeUser(c, targetId) }),
          {
            parse_mode: 'HTML',
          },
        )
        .catch(() => undefined);
    } else {
      const latest = await this.prisma.chatWarn.findFirst({
        where: { botId, chatId: String(chatId), telegramId: BigInt(targetId) },
        orderBy: { id: 'desc' },
      });
      if (latest) {
        await this.prisma.chatWarn.delete({ where: { id: latest.id } });
      }
      const count = await this.countWarns(botId, chatId, targetId, warnTime);
      await c
        .reply(
          this.i18n.t(lang, 'warnings.warnRemoved', {
            user: await this.describeUser(c, targetId),
            count,
          }),
          {
            parse_mode: 'HTML',
          },
        )
        .catch(() => undefined);
    }
    this.adminLog.emit({
      botId,
      chatId,
      category: 'admin',
      text: `${c.from!.first_name} → ${all ? '/resetwarn' : '/rmwarn'} → ${targetId}`,
    });
  }

  /**
   * Handles the "Remove warn" inline button on warning messages.
   */
  private async handleRemoveWarnButton(
    c: Context,
    botId: number,
    chatId: number,
    targetId: number,
  ): Promise<void> {
    const lang = await this.i18n.getChatLanguage(botId, chatId);
    if (!c.from || !(await this.adminGate.hasCapability(c.api, chatId, c.from.id, 'restrict'))) {
      await c
        .answerCallbackQuery({ text: this.i18n.t(lang, 'common.adminOnly') })
        .catch(() => undefined);
      return;
    }
    const latest = await this.prisma.chatWarn.findFirst({
      where: { botId, chatId: String(chatId), telegramId: BigInt(targetId) },
      orderBy: { id: 'desc' },
    });
    if (latest) {
      await this.prisma.chatWarn.delete({ where: { id: latest.id } });
    }
    const config = await this.chatSettings.getEffectiveConfig(botId, chatId, this.moduleKey);
    const count = await this.countWarns(
      botId,
      chatId,
      targetId,
      Number(config.warnTimeSeconds ?? 0),
    );
    await c
      .answerCallbackQuery({ text: this.i18n.t(lang, 'warnings.warnRemoved', { user: '', count }) })
      .catch(() => undefined);
    this.adminLog.emit({
      botId,
      chatId,
      category: 'admin',
      text: `${c.from.first_name} removed a warn via button → ${targetId}`,
    });
  }

  /**
   * Handles /warns — lists a user's active warnings.
   */
  private async handleListWarns(c: Context, botId: number): Promise<void> {
    const group = await this.groupContext(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.requireCapability(c, botId, chatId, lang, 'restrict'))) return;

    const invocation = this.parseInvocation(c, false);
    const targetId = (await this.resolveUserId(c, invocation)) ?? c.from!.id;
    const config = await this.chatSettings.getEffectiveConfig(botId, chatId, this.moduleKey);
    const warnTime = Number(config.warnTimeSeconds ?? 0);
    const limit = Number(config.warnLimit ?? 3);
    const count = await this.countWarns(botId, chatId, targetId, warnTime);

    if (count === 0) {
      await c
        .reply(
          this.i18n.t(lang, 'warnings.noWarns', { user: await this.describeUser(c, targetId) }),
          {
            parse_mode: 'HTML',
          },
        )
        .catch(() => undefined);
      return;
    }

    const cutoff = warnTime > 0 ? new Date(Date.now() - warnTime * 1000).toISOString() : undefined;
    const warns = await this.prisma.chatWarn.findMany({
      where: {
        botId,
        chatId: String(chatId),
        telegramId: BigInt(targetId),
        ...(cutoff ? { createdAt: { gte: cutoff } } : {}),
      },
      orderBy: { id: 'desc' },
      take: 10,
    });
    const lines = warns.map((warn) =>
      this.i18n.t(lang, 'warnings.warnItem', {
        reason: escapeHtml(warn.reason),
        date: warn.createdAt ?? '',
      }),
    );
    await c
      .reply(
        `${this.i18n.t(lang, 'warnings.warnList', {
          user: await this.describeUser(c, targetId),
          count,
          limit,
        })}\n${lines.join('\n')}`,
        { parse_mode: 'HTML' },
      )
      .catch(() => undefined);
  }

  /**
   * Handles /setwarnlimit <n>.
   */
  private async handleSetWarnLimit(c: Context, botId: number): Promise<void> {
    const group = await this.groupContext(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.requireCapability(c, botId, chatId, lang, 'change_info'))) return;
    const value = Number((typeof c.match === 'string' ? c.match : '').trim());
    if (!Number.isFinite(value) || value < 1 || value > 100) {
      await c.reply(this.i18n.t(lang, 'common.error')).catch(() => undefined);
      return;
    }
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      warnLimit: value,
    });
    await c
      .reply(this.i18n.t(lang, 'warnings.warnLimitSet', { limit: value }))
      .catch(() => undefined);
    this.adminLog.emit({
      botId,
      chatId,
      category: 'settings',
      text: `${c.from!.first_name} set warn limit to ${value}`,
    });
  }

  /**
   * Handles /setwarnmode <kick|ban|tban T|mute|tmute T>.
   */
  private async handleSetWarnMode(c: Context, botId: number): Promise<void> {
    const group = await this.groupContext(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.requireCapability(c, botId, chatId, lang, 'change_info'))) return;

    const args = (typeof c.match === 'string' ? c.match : '').trim();
    const { seconds, rest } = splitDurationArg(args);
    const mode = rest.toLowerCase();

    if (!['kick', 'ban', 'mute', 'tmute', 'tban'].includes(mode)) {
      await c.reply(this.i18n.t(lang, 'common.error')).catch(() => undefined);
      return;
    }
    if ((mode === 'tban' || mode === 'tmute') && !seconds) {
      await c.reply(this.i18n.t(lang, 'common.invalidDuration')).catch(() => undefined);
      return;
    }

    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      warnMode: mode,
      warnDurationSeconds: seconds ?? 0,
    });
    await c
      .reply(
        this.i18n.t(lang, 'warnings.warnModeSet', {
          mode: seconds ? `${mode} ${formatDuration(seconds)}` : mode,
        }),
      )
      .catch(() => undefined);
    this.adminLog.emit({
      botId,
      chatId,
      category: 'settings',
      text: `${c.from!.first_name} set warn mode to ${mode}`,
    });
  }

  /**
   * Handles /warntime <duration>|off.
   */
  private async handleWarnTime(c: Context, botId: number): Promise<void> {
    const group = await this.groupContext(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.requireCapability(c, botId, chatId, lang, 'change_info'))) return;

    const args = (typeof c.match === 'string' ? c.match : '').trim().toLowerCase();
    const seconds = args === 'off' || args === 'no' ? 0 : (splitDurationArg(args).seconds ?? -1);
    if (seconds < 0) {
      await c.reply(this.i18n.t(lang, 'common.invalidDuration')).catch(() => undefined);
      return;
    }
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      warnTimeSeconds: seconds,
    });
    await c
      .reply(
        seconds > 0
          ? this.i18n.t(lang, 'warnings.warnTimeSet', { duration: formatDuration(seconds) })
          : this.i18n.t(lang, 'warnings.warnTimeOff'),
      )
      .catch(() => undefined);
  }

  /**
   * Handles /del — deletes the replied message plus the command.
   */
  private async handleDeleteSingle(c: Context, botId: number): Promise<void> {
    const group = await this.groupContext(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.requireCapability(c, botId, chatId, lang, 'delete'))) return;
    const replied = c.msg?.reply_to_message;
    if (!replied) return;
    await c.api.deleteMessage(chatId, replied.message_id).catch(() => undefined);
    await c.deleteMessage().catch(() => undefined);
  }

  /**
   * Handles /purge [n] and /spurge [n].
   */
  private async handlePurge(c: Context, botId: number, silent: boolean): Promise<void> {
    const group = await this.groupContext(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.requireCapability(c, botId, chatId, lang, 'delete'))) return;

    const replied = c.msg?.reply_to_message;
    if (!replied) {
      await c.reply(this.i18n.t(lang, 'purges.purgeRange')).catch(() => undefined);
      return;
    }
    const countArg = Number((typeof c.match === 'string' ? c.match : '').trim());
    const limit =
      Number.isFinite(countArg) && countArg > 0
        ? Math.min(countArg, PURGE_HARD_CAP)
        : Math.min(c.msg.message_id - replied.message_id, PURGE_HARD_CAP);

    let deleted = 0;
    for (
      let id = replied.message_id;
      id < replied.message_id + limit && id < c.msg.message_id;
      id++
    ) {
      const ok = await c.api.deleteMessage(chatId, id).then(
        () => true,
        () => false,
      );
      if (ok) deleted++;
    }
    await c.deleteMessage().catch(() => undefined);
    this.adminLog.emit({
      botId,
      chatId,
      category: 'admin',
      text: `${c.from!.first_name} purged ${deleted} message(s)`,
    });
    if (!silent) {
      await c
        .reply(this.i18n.t(lang, 'purges.purgeComplete', { count: deleted }))
        .then((msg) =>
          setTimeout(
            () => void c.api.deleteMessage(chatId, msg.message_id).catch(() => undefined),
            5_000,
          ),
        )
        .catch(() => undefined);
    }
  }

  /**
   * Handles /purgefrom — anchors the purge range start.
   */
  private async handlePurgeFrom(c: Context, botId: number): Promise<void> {
    const group = await this.groupContext(c, botId);
    if (!group) return;
    const { chatId } = group;
    if (!(await this.requireCapability(c, botId, chatId, group.lang, 'delete'))) return;
    const replied = c.msg?.reply_to_message;
    if (!replied) return;
    this.purgeAnchors.set(chatId, replied.message_id);
    await c.react('👌').catch(() => undefined);
    await c.deleteMessage().catch(() => undefined);
  }

  /**
   * Handles /purgeto — purges from the anchored start to this message.
   */
  private async handlePurgeTo(c: Context, botId: number): Promise<void> {
    const group = await this.groupContext(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.requireCapability(c, botId, chatId, lang, 'delete'))) return;
    const from = this.purgeAnchors.get(chatId);
    if (!from) {
      await c.reply(this.i18n.t(lang, 'purges.purgeRange')).catch(() => undefined);
      return;
    }
    this.purgeAnchors.delete(chatId);
    const to = Math.min(c.msg!.message_id - 1, from + PURGE_HARD_CAP);
    let deleted = 0;
    for (let id = from; id <= to; id++) {
      const ok = await c.api.deleteMessage(chatId, id).then(
        () => true,
        () => false,
      );
      if (ok) deleted++;
    }
    await c.deleteMessage().catch(() => undefined);
    this.adminLog.emit({
      botId,
      chatId,
      category: 'admin',
      text: `${c.from!.first_name} purged ${deleted} message(s) (range)`,
    });
    await c
      .reply(this.i18n.t(lang, 'purges.purgeComplete', { count: deleted }))
      .catch(() => undefined);
  }

  /**
   * Handles /approve <target> [reason].
   */
  private async handleApprove(c: Context, botId: number): Promise<void> {
    const group = await this.groupContext(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.requireCapability(c, botId, chatId, lang, 'restrict'))) return;

    const invocation = this.parseInvocation(c, false);
    const targetId = await this.resolveUserId(c, invocation);
    if (!targetId) {
      await c.reply(this.i18n.t(lang, 'common.userNotFound')).catch(() => undefined);
      return;
    }
    await this.prisma.chatApproval.upsert({
      where: {
        botId_chatId_telegramId: {
          botId,
          chatId: String(chatId),
          telegramId: BigInt(targetId),
        },
      },
      create: {
        botId,
        chatId: String(chatId),
        telegramId: BigInt(targetId),
        reason: invocation.reason || null,
        approvedAt: new Date().toISOString(),
      },
      update: { reason: invocation.reason || null },
    });
    await c
      .reply(
        this.i18n.t(lang, 'approvals.approved', { user: await this.describeUser(c, targetId) }),
        {
          parse_mode: 'HTML',
        },
      )
      .catch(() => undefined);
    this.adminLog.emit({
      botId,
      chatId,
      category: 'admin',
      text: `${c.from!.first_name} approved ${targetId}`,
    });
  }

  /**
   * Handles /unapprove <target>.
   */
  private async handleUnapprove(c: Context, botId: number): Promise<void> {
    const group = await this.groupContext(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.requireCapability(c, botId, chatId, lang, 'restrict'))) return;

    const invocation = this.parseInvocation(c, false);
    const targetId = await this.resolveUserId(c, invocation);
    if (!targetId) {
      await c.reply(this.i18n.t(lang, 'common.userNotFound')).catch(() => undefined);
      return;
    }
    const removed = await this.prisma.chatApproval
      .delete({
        where: {
          botId_chatId_telegramId: {
            botId,
            chatId: String(chatId),
            telegramId: BigInt(targetId),
          },
        },
      })
      .then(() => true)
      .catch(() => false);
    if (removed) {
      await c
        .reply(
          this.i18n.t(lang, 'approvals.unapproved', { user: await this.describeUser(c, targetId) }),
          {
            parse_mode: 'HTML',
          },
        )
        .catch(() => undefined);
    }
  }

  /**
   * Handles /approval <target> — checks approval status.
   */
  private async handleApprovalStatus(c: Context, botId: number): Promise<void> {
    const group = await this.groupContext(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.requireCapability(c, botId, chatId, lang, 'restrict'))) return;

    const invocation = this.parseInvocation(c, false);
    const targetId = await this.resolveUserId(c, invocation);
    if (!targetId) {
      await c.reply(this.i18n.t(lang, 'common.userNotFound')).catch(() => undefined);
      return;
    }
    const row = await this.prisma.chatApproval.findUnique({
      where: {
        botId_chatId_telegramId: {
          botId,
          chatId: String(chatId),
          telegramId: BigInt(targetId),
        },
      },
    });
    await c
      .reply(
        row
          ? this.i18n.t(lang, 'approvals.isApproved', {
              user: await this.describeUser(c, targetId),
              reason: escapeHtml(row.reason ?? ''),
            })
          : this.i18n.t(lang, 'approvals.notApproved', {
              user: await this.describeUser(c, targetId),
            }),
        { parse_mode: 'HTML' },
      )
      .catch(() => undefined);
  }

  /**
   * Handles /approved — lists approved users.
   */
  private async handleApprovedList(c: Context, botId: number): Promise<void> {
    const group = await this.groupContext(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.requireCapability(c, botId, chatId, lang, 'restrict'))) return;

    const rows = await this.prisma.chatApproval.findMany({
      where: { botId, chatId: String(chatId) },
      orderBy: { telegramId: 'asc' },
      take: 100,
    });
    if (rows.length === 0) {
      await c.reply(this.i18n.t(lang, 'approvals.approvalEmpty')).catch(() => undefined);
      return;
    }
    const lines = rows.map(
      (row) =>
        `• <a href="tg://user?id=${row.telegramId}">${row.telegramId}</a>${row.reason ? ` — ${escapeHtml(row.reason)}` : ''}`,
    );
    await c
      .reply(
        `${this.i18n.t(lang, 'approvals.approvedList', { count: rows.length })}\n${lines.join('\n')}`,
        {
          parse_mode: 'HTML',
        },
      )
      .catch(() => undefined);
  }

  /**
   * Handles /unapproveall — owner only.
   */
  private async handleUnapproveAll(c: Context, botId: number): Promise<void> {
    const group = await this.groupContext(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.adminGate.isOwner(c.api, chatId, c.from!.id))) {
      await c.reply(this.i18n.t(lang, 'common.adminOnly')).catch(() => undefined);
      return;
    }
    await this.prisma.chatApproval.deleteMany({ where: { botId, chatId: String(chatId) } });
    await c.reply(this.i18n.t(lang, 'approvals.approvedAllCleared')).catch(() => undefined);
    this.adminLog.emit({
      botId,
      chatId,
      category: 'settings',
      text: `${c.from!.first_name} cleared all approvals`,
    });
  }

  /**
   * Handles /silentactions on|off — owner only.
   */
  private async handleSilentActions(c: Context, botId: number): Promise<void> {
    const group = await this.groupContext(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.adminGate.isOwner(c.api, chatId, c.from!.id))) {
      await c.reply(this.i18n.t(lang, 'common.adminOnly')).catch(() => undefined);
      return;
    }
    const args = (typeof c.match === 'string' ? c.match : '').trim().toLowerCase();
    const enable = ['on', 'yes', 'true'].includes(args);
    const disable = ['off', 'no', 'false'].includes(args);
    if (!enable && !disable) {
      await c.reply(this.i18n.t(lang, 'common.error')).catch(() => undefined);
      return;
    }
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      silentActions: enable,
    });
    await c
      .reply(this.i18n.t(lang, enable ? 'silent.enabled' : 'silent.disabled'))
      .catch(() => undefined);
  }

  /**
   * Handles /adminerror on|off.
   */
  private async handleAdminError(c: Context, botId: number): Promise<void> {
    const group = await this.groupContext(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.requireCapability(c, botId, chatId, lang, 'change_info'))) return;
    const args = (typeof c.match === 'string' ? c.match : '').trim().toLowerCase();
    const enable = ['on', 'yes', 'true'].includes(args);
    const disable = ['off', 'no', 'false'].includes(args);
    if (!enable && !disable) {
      await c.reply(this.i18n.t(lang, 'common.error')).catch(() => undefined);
      return;
    }
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      adminError: enable,
    });
    await c.reply(this.i18n.t(lang, 'common.done')).catch(() => undefined);
  }

  /** Pending bot-issued actions awaiting admin review (bot2bot). */
  private readonly botReviews = new Map<string, { chatId: number; execute: () => Promise<void> }>();

  /**
   * Queues a bot-issued admin action behind inline Approve/Deny buttons.
   */
  private async queueBotReview(
    c: Context,
    botId: number,
    chatId: number,
    label: string,
    execute: () => Promise<void>,
  ): Promise<void> {
    const nonce = crypto.randomUUID().slice(0, 10);
    this.botReviews.set(nonce, { chatId, execute });
    await c.api
      .sendMessage(
        chatId,
        `🤖 Bot action requires review:
${label}`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Approve', callback_data: `gm:b2bok:${nonce}` },
                { text: '⛔ Deny', callback_data: `gm:b2bno:${nonce}` },
              ],
            ],
          },
        },
      )
      .catch(() => undefined);
    void botId;
  }

  /**
   * Handles /admincache — forces an admin list refresh.
   */
  private async handleAdminCache(c: Context, botId: number): Promise<void> {
    const group = await this.groupContext(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.requireCapability(c, botId, chatId, lang, 'change_info'))) return;
    this.adminGate.refresh(chatId);
    await c.reply(this.i18n.t(lang, 'common.done')).catch(() => undefined);
  }
}
