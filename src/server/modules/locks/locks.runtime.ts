import { Injectable } from '@nestjs/common';
import type { Context } from 'grammy';
import { PrismaService } from '../../database/prisma.service';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { AdminGateService } from '../../bot-engine/admin-gate.service';
import { AdminLogService } from '../../bot-engine/admin-log.service';
import { BotI18nService, type BotLanguage } from '../../bot-engine/bot-i18n.service';
import { ChatSettingsService } from '../../bot-engine/chat-settings.service';
import { RestrictionsService } from '../../bot-engine/restrictions.service';
import { formatDuration, splitDurationArg } from '../../common/utils/duration.util';
import { userMentionHtml } from '../../common/utils/telegram-text.util';
import { LOCK_TYPES, evaluateLocks, isAllowlisted } from './lock-evaluator';

/** Parsed /lock custom rule (### reason {action}). */
interface LockRule {
  reason?: string;
  action?: string;
  durationSeconds?: number;
}

/**
 * Runtime for the Chat Locks module: evaluates every group message against
 * the chat's active lock types, deletes violations, optionally warns, and
 * applies per-lock custom punishments. Locks take precedence over
 * blocklists (reference ordering) — both run independently, locks earlier in
 * middleware order.
 */
@Injectable()
export class LocksRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'locks';

  /**
   * @param {PrismaService} prisma - Prisma ORM access service.
   * @param {AdminGateService} adminGate - Telegram permission gate.
   * @param {RestrictionsService} restrictions - Shared action executor.
   * @param {AdminLogService} adminLog - Admin action log bus.
   * @param {BotI18nService} i18n - Bot-reply localization.
   * @param {ChatSettingsService} chatSettings - Per-chat config layer.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
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
   * Attaches lock enforcement middleware and lock management commands.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot, botId } = ctx;

    bot.on('message', async (update) => {
      if (update.chat?.type !== 'supergroup' && update.chat?.type !== 'group') return;
      if (!update.from || update.from.id === bot.botInfo?.id) return;

      const config = await this.chatSettings.getEffectiveConfig(
        botId,
        update.chat.id,
        this.moduleKey,
      );
      const lockedTypes = Array.isArray(config.lockedTypes) ? (config.lockedTypes as string[]) : [];
      if (lockedTypes.length === 0) return;
      if (await this.isImmune(botId, update, update.chat.id, update.from.id)) return;
      const allowlist = Array.isArray(config.allowlist) ? (config.allowlist as string[]) : [];
      if (isAllowlisted(allowlist, update.msg)) return;

      const violated = evaluateLocks(lockedTypes, update.msg, update.chat.id);
      if (violated.length === 0) return;

      await update.deleteMessage().catch(() => undefined);

      const rules = (config.lockRules as Record<string, LockRule>) ?? {};
      const rule = rules[violated[0]];

      this.adminLog.emit({
        botId,
        chatId: update.chat.id,
        category: 'automated',
        text: `Lock hit [${violated.join(', ')}] from ${update.from.first_name}`,
      });

      if (rule?.action) {
        await this.applyAction(update, botId, update.chat.id, update.from.id, rule);
        return;
      }
      if (config.lockWarns === true) {
        await this.warnForLock(update, botId, update.chat.id, update.from, violated);
      }
    });

    bot.command('lock', (c) => this.handleLock(c, botId, true));
    bot.command('unlock', (c) => this.handleLock(c, botId, false));
    bot.command('locks', (c) => this.handleListLocks(c, botId));
    bot.command('locktypes', (c) => this.handleLockTypes(c, botId));
    bot.command('lockwarns', (c) => this.handleLockWarns(c, botId));
    bot.command('allowlist', (c) => this.handleAllowlist(c, botId));
    bot.command('rmallowlist', (c) => this.handleRmAllowlist(c, botId));
  }

  /**
   * Admins, approved users, and bots we manage are immune to locks.
   */
  private async isImmune(
    botId: number,
    update: Context,
    chatId: number,
    userId: number,
  ): Promise<boolean> {
    if (await this.adminGate.isAdmin(update.api, chatId, userId)) return true;
    const approved = await this.prisma.chatApproval
      .findUnique({
        where: { botId_chatId_telegramId: { botId, chatId: String(chatId), telegramId: userId } },
      })
      .catch(() => null);
    return approved !== null;
  }

  /**
   * Applies a per-lock custom action (kick/ban/tban/mute/tmute).
   */
  private async applyAction(
    update: Context,
    botId: number,
    chatId: number,
    userId: number,
    rule: LockRule,
  ): Promise<void> {
    const action = rule.action ?? '';
    const duration = rule.durationSeconds ?? 0;
    const mention = `<a href="tg://user?id=${userId}">User ${userId}</a>`;
    switch (action) {
      case 'kick':
        await this.restrictions.kick(update.api, chatId, userId);
        break;
      case 'ban':
      case 'sban':
        await this.restrictions.ban(update.api, chatId, userId);
        break;
      case 'tban':
        await this.restrictions.ban(update.api, chatId, userId, duration || 86_400);
        break;
      case 'mute':
      case 'smute':
        await this.restrictions.mute(update.api, chatId, userId);
        break;
      case 'tmute':
        await this.restrictions.mute(update.api, chatId, userId, duration || 3_600);
        break;
      default:
        break;
    }
    if (!action.startsWith('s')) {
      await update
        .reply(
          `${mention} ${rule.reason ?? action}${duration ? ` (${formatDuration(duration)})` : ''}`,
          { parse_mode: 'HTML' },
        )
        .catch(() => undefined);
    }
  }

  /**
   * Records a warning for a lock violation and applies the group-moderation
   * warn mode once the warn limit is reached.
   */
  private async warnForLock(
    update: Context,
    botId: number,
    chatId: number,
    from: { id: number; first_name?: string },
    violated: string[],
  ): Promise<void> {
    const gmConfig = await this.chatSettings.getEffectiveConfig(botId, chatId, 'group-moderation');
    const limit = Number(gmConfig.warnLimit ?? 3);
    await this.prisma.chatWarn.create({
      data: {
        botId,
        chatId: String(chatId),
        telegramId: from.id,
        reason: `Lock violation: ${violated.join(', ')}`,
        createdAt: new Date().toISOString(),
      },
    });
    const count = await this.prisma.chatWarn.count({
      where: { botId, chatId: String(chatId), telegramId: from.id },
    });
    if (limit > 0 && count >= limit) {
      await this.prisma.chatWarn.deleteMany({
        where: { botId, chatId: String(chatId), telegramId: from.id },
      });
      const warnMode = String(gmConfig.warnMode ?? 'ban');
      const warnDuration = Number(gmConfig.warnDurationSeconds ?? 0);
      switch (warnMode) {
        case 'kick':
          await this.restrictions.kick(update.api, chatId, from.id);
          break;
        case 'mute':
          await this.restrictions.mute(update.api, chatId, from.id);
          break;
        case 'tmute':
          await this.restrictions.mute(update.api, chatId, from.id, warnDuration || 3_600);
          break;
        case 'tban':
          await this.restrictions.ban(update.api, chatId, from.id, warnDuration || 86_400);
          break;
        default:
          await this.restrictions.ban(update.api, chatId, from.id);
          break;
      }
      return;
    }
    await update
      .reply(
        this.i18n.t(await this.i18n.getChatLanguage(botId, chatId), 'locks.lockWarned', {
          user: userMentionHtml(from as never),
          types: violated.join(', '),
          count,
          limit,
        }),
        { parse_mode: 'HTML' },
      )
      .catch(() => undefined);
  }

  /**
   * Guard: group + change_info capability.
   */
  private async guard(
    c: Context,
    botId: number,
  ): Promise<{ chatId: number; lang: BotLanguage; config: Record<string, unknown> } | null> {
    if (c.chat?.type !== 'supergroup' && c.chat?.type !== 'group') return null;
    if (!c.from) return null;
    const chatId = c.chat.id;
    if (!(await this.adminGate.hasCapability(c.api, chatId, c.from.id, 'change_info'))) {
      return null;
    }
    const lang = await this.i18n.getChatLanguage(botId, chatId);
    const config = await this.chatSettings.getEffectiveConfig(botId, chatId, this.moduleKey);
    return { chatId, lang, config };
  }

  /**
   * Handles /lock and /unlock with `### reason {action}` custom rules.
   */
  private async handleLock(c: Context, botId: number, lock: boolean): Promise<void> {
    const group = await this.guard(c, botId);
    if (!group) return;
    const { chatId, lang } = group;

    const raw = String(typeof c.match === 'string' ? c.match : '').trim();
    if (!raw) {
      await this.handleListLocks(c, botId);
      return;
    }

    let typesPart = raw;
    let rule: LockRule | undefined;
    const customIndex = raw.indexOf('###');
    if (customIndex >= 0) {
      typesPart = raw.slice(0, customIndex).trim();
      const tail = raw.slice(customIndex + 3).trim();
      const actionMatch = tail.match(/\{([a-z]+)(?:\s+([\dmhs]+))?\}\s*$/i);
      let reason = tail;
      if (actionMatch) {
        reason = tail.slice(0, actionMatch.index).trim();
        rule = {
          reason: reason || undefined,
          action: actionMatch[1].toLowerCase(),
          durationSeconds: actionMatch[2]
            ? (splitDurationArg(actionMatch[2]).seconds ?? 0)
            : undefined,
        };
      } else {
        rule = { reason: reason || undefined };
      }
    }

    const requested = typesPart
      .split(/[\s,]+/)
      .map((type) => type.trim().toLowerCase())
      .filter(Boolean);
    const valid = requested.filter((type) => (LOCK_TYPES as readonly string[]).includes(type));
    if (valid.length === 0) {
      await c.reply(this.i18n.t(lang, 'common.error')).catch(() => undefined);
      return;
    }

    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    const current = Array.isArray(override.lockedTypes)
      ? [...(override.lockedTypes as string[])]
      : [];
    const next = lock
      ? [...new Set([...current, ...valid])]
      : current.filter(
          (type) => !valid.includes(type) && !(valid.includes('all') && type !== 'all'),
        );
    const rules = { ...((override.lockRules as Record<string, LockRule>) ?? {}) };
    if (rule) {
      for (const type of valid) rules[type] = rule;
    } else if (!lock) {
      for (const type of valid) delete rules[type];
    }

    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      lockedTypes: next,
      lockRules: rules,
    });
    await c
      .reply(
        this.i18n.t(lang, lock ? 'locks.locked' : 'locks.unlocked', { types: valid.join(', ') }),
      )
      .catch(() => undefined);
    this.adminLog.emit({
      botId,
      chatId,
      category: 'settings',
      text: `${c.from!.first_name} ${lock ? 'locked' : 'unlocked'}: ${valid.join(', ')}`,
    });
  }

  /**
   * Handles /locks — shows active locks.
   */
  private async handleListLocks(c: Context, botId: number): Promise<void> {
    const group = await this.guard(c, botId);
    if (!group) return;
    const lockedTypes = Array.isArray(group.config.lockedTypes)
      ? (group.config.lockedTypes as string[])
      : [];
    await c
      .reply(
        lockedTypes.length > 0 ? `🔒 ${lockedTypes.map((type) => `\`${type}\``).join(', ')}` : '🔓',
        { parse_mode: 'HTML' },
      )
      .catch(() => undefined);
  }

  /**
   * Handles /locktypes — lists every supported lock type.
   */
  private async handleLockTypes(c: Context, botId: number): Promise<void> {
    const group = await this.guard(c, botId);
    if (!group) return;
    await c.reply(LOCK_TYPES.join(', ')).catch(() => undefined);
  }

  /**
   * Handles /lockwarns on|off.
   */
  private async handleLockWarns(c: Context, botId: number): Promise<void> {
    const group = await this.guard(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    const enable = ['on', 'yes', 'true'].includes(
      String(typeof c.match === 'string' ? c.match : '')
        .trim()
        .toLowerCase(),
    );
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      lockWarns: enable,
    });
    await c.reply(this.i18n.t(lang, 'common.done')).catch(() => undefined);
  }

  /**
   * Handles /allowlist (list, or add an entry).
   */
  private async handleAllowlist(c: Context, botId: number): Promise<void> {
    const group = await this.guard(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    const entry = String(typeof c.match === 'string' ? c.match : '').trim();
    if (!entry) {
      const allowlist = Array.isArray(group.config.allowlist)
        ? (group.config.allowlist as string[])
        : [];
      await c
        .reply(
          allowlist.length > 0
            ? `✅ ${allowlist.map((item) => `\`${item}\``).join(', ')}`
            : this.i18n.t(lang, 'locks.allowlistEmpty'),
        )
        .catch(() => undefined);
      return;
    }
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    const allowlist = Array.isArray(override.allowlist)
      ? [...(override.allowlist as string[])]
      : [];
    allowlist.push(entry);
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      allowlist,
    });
    await c.reply(this.i18n.t(lang, 'locks.allowlisted', { item: entry })).catch(() => undefined);
  }

  /**
   * Handles /rmallowlist <entry>.
   */
  private async handleRmAllowlist(c: Context, botId: number): Promise<void> {
    const group = await this.guard(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    const entry = String(typeof c.match === 'string' ? c.match : '').trim();
    if (!entry) return;
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    const allowlist = Array.isArray(override.allowlist)
      ? [...(override.allowlist as string[])]
      : [];
    const next = allowlist.filter((item) => item !== entry);
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      allowlist: next,
    });
    await c
      .reply(this.i18n.t(lang, 'locks.allowlistRemoved', { item: entry }))
      .catch(() => undefined);
  }
}
