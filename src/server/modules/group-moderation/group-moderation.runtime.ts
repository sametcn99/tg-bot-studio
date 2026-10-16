import { Injectable } from '@nestjs/common';
import type { Context } from 'grammy';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { AdminGateService, type AdminCapability } from '../../bot-engine/admin-gate.service';
import { AdminLogService } from '../../bot-engine/admin-log.service';
import { BotI18nService } from '../../bot-engine/bot-i18n.service';
import { ChatSettingsService } from '../../bot-engine/chat-settings.service';
import { RestrictionsService } from '../../bot-engine/restrictions.service';
import { PrismaService } from '../../database/prisma.service';
import { formatDuration } from '../../common/utils/duration.util';
import { escapeHtml } from '../../common/utils/telegram-text.util';
import {
  describeUser,
  groupContext,
  parseInvocation,
  requireCapability,
  resolveUserId,
  type ModerationDeps,
} from './moderation.helpers';
import { createWarnHandlers, type WarnHandlers } from './warn-commands';
import { createApprovalHandlers, type ApprovalHandlers } from './approval-commands';

/** Hard cap for a single /purge sweep (mirrors the reference bot's practical ceiling). */
const PURGE_HARD_CAP = 500;

/**
 * Runtime for the reference-parity Group Moderation Commands module: manual
 * ban/mute/kick/warn/purge commands, silent + delete variants, approvals,
 * and warn-mode settings — all permission-checked against native Telegram
 * admin rights and localized per chat.
 *
 * Command families live in sibling files wired through {@link ModerationDeps}:
 * the warn subsystem in `warn-commands.ts`, approvals in
 * `approval-commands.ts`, and shared guards in `moderation.helpers.ts`.
 */
@Injectable()
export class GroupModerationRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'group-moderation';

  /** Purges-in-progress keyed by chat id (purgefrom anchor message). */
  private readonly purgeAnchors = new Map<number, number>();

  /** Pending bot-issued actions awaiting admin review (bot2bot). */
  private readonly botReviews = new Map<string, { chatId: number; execute: () => Promise<void> }>();

  private readonly deps: ModerationDeps;
  private readonly warn: WarnHandlers;
  private readonly approvals: ApprovalHandlers;

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
    prisma: PrismaService,
    private readonly adminGate: AdminGateService,
    private readonly restrictions: RestrictionsService,
    private readonly adminLog: AdminLogService,
    private readonly i18n: BotI18nService,
    private readonly chatSettings: ChatSettingsService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    this.deps = {
      moduleKey: this.moduleKey,
      prisma,
      adminGate,
      restrictions,
      adminLog,
      i18n,
      chatSettings,
    };
    this.warn = createWarnHandlers(this.deps);
    this.approvals = createApprovalHandlers(this.deps);
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
    bot.command('warn', (c) => this.warn.handleWarn(c, botId, {}));
    bot.command('dwarn', (c) => this.warn.handleWarn(c, botId, { delete: true }));
    bot.command('swarn', (c) => this.warn.handleWarn(c, botId, { silent: true }));
    bot.command('rmwarn', (c) => this.warn.handleRemoveWarn(c, botId, false));
    bot.command('resetwarn', (c) => this.warn.handleRemoveWarn(c, botId, true));
    bot.command('warns', (c) => this.warn.handleListWarns(c, botId));
    bot.command('setwarnlimit', (c) => this.warn.handleSetWarnLimit(c, botId));
    bot.command('setwarnmode', (c) => this.warn.handleSetWarnMode(c, botId));
    bot.command('warntime', (c) => this.warn.handleWarnTime(c, botId));

    // --- Purges -----------------------------------------------------------
    bot.command('del', (c) => this.handleDeleteSingle(c, botId));
    bot.command('purge', (c) => this.handlePurge(c, botId, false));
    bot.command('spurge', (c) => this.handlePurge(c, botId, true));
    bot.command('purgefrom', (c) => this.handlePurgeFrom(c, botId));
    bot.command('purgeto', (c) => this.handlePurgeTo(c, botId));

    // --- Approvals --------------------------------------------------------
    bot.command('approve', (c) => this.approvals.handleApprove(c, botId));
    bot.command('unapprove', (c) => this.approvals.handleUnapprove(c, botId));
    bot.command('approval', (c) => this.approvals.handleApprovalStatus(c, botId));
    bot.command('approved', (c) => this.approvals.handleApprovedList(c, botId));
    bot.command('unapproveall', (c) => this.approvals.handleUnapproveAll(c, botId));

    // --- Housekeeping -----------------------------------------------------
    bot.command('silentactions', (c) => this.handleSilentActions(c, botId));
    bot.command('adminerror', (c) => this.handleAdminError(c, botId));
    bot.command('admincache', (c) => this.handleAdminCache(c, botId));

    // "Remove warn" button on warning messages (reference parity).
    bot.callbackQuery(/^gm:rmwarn:(-?\d+):(\d+)$/, (c) =>
      this.warn.handleRemoveWarnButton(c, botId, Number(c.match[1]), Number(c.match[2])),
    );
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
    const group = await groupContext(this.deps, c, botId);
    if (!group) return;
    const { chatId, lang } = group;

    const capability: AdminCapability = 'restrict';
    if (!(await requireCapability(this.deps, c, botId, chatId, lang, capability))) return;

    const invocation = parseInvocation(c, action === 'tban' || action === 'tmute');
    const targetId = await resolveUserId(c, invocation);
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
    const mention = await describeUser(c, targetId);
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
    const group = await groupContext(this.deps, c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await requireCapability(this.deps, c, botId, chatId, lang, 'restrict'))) return;

    const invocation = parseInvocation(c, false);
    const targetId = await resolveUserId(c, invocation);
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
            user: await describeUser(c, targetId),
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
    const group = await groupContext(this.deps, c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await requireCapability(this.deps, c, botId, chatId, lang, 'restrict'))) return;

    const invocation = parseInvocation(c, false);
    const targetId = await resolveUserId(c, invocation);
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
          this.i18n.t(lang, 'restrictions.unmuted', { user: await describeUser(c, targetId) }),
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
    const group = await groupContext(this.deps, c, botId);
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
   * Handles /del — deletes the replied message plus the command.
   */
  private async handleDeleteSingle(c: Context, botId: number): Promise<void> {
    const group = await groupContext(this.deps, c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await requireCapability(this.deps, c, botId, chatId, lang, 'delete'))) return;
    const replied = c.msg?.reply_to_message;
    if (!replied) return;
    await c.api.deleteMessage(chatId, replied.message_id).catch(() => undefined);
    await c.deleteMessage().catch(() => undefined);
  }

  /**
   * Handles /purge [n] and /spurge [n].
   */
  private async handlePurge(c: Context, botId: number, silent: boolean): Promise<void> {
    const group = await groupContext(this.deps, c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await requireCapability(this.deps, c, botId, chatId, lang, 'delete'))) return;

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
    const group = await groupContext(this.deps, c, botId);
    if (!group) return;
    const { chatId } = group;
    if (!(await requireCapability(this.deps, c, botId, chatId, group.lang, 'delete'))) return;
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
    const group = await groupContext(this.deps, c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await requireCapability(this.deps, c, botId, chatId, lang, 'delete'))) return;
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
   * Handles /silentactions on|off — owner only.
   */
  private async handleSilentActions(c: Context, botId: number): Promise<void> {
    const group = await groupContext(this.deps, c, botId);
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
    const group = await groupContext(this.deps, c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await requireCapability(this.deps, c, botId, chatId, lang, 'change_info'))) return;
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

  /**
   * Queues a bot-issued admin action behind inline Approve/Deny buttons.
   */
  private async queueBotReview(
    c: Context,
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
  }

  /**
   * Handles /admincache — forces an admin list refresh.
   */
  private async handleAdminCache(c: Context, botId: number): Promise<void> {
    const group = await groupContext(this.deps, c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await requireCapability(this.deps, c, botId, chatId, lang, 'change_info'))) return;
    this.adminGate.refresh(chatId);
    await c.reply(this.i18n.t(lang, 'common.done')).catch(() => undefined);
  }
}
