import { Injectable, Logger } from '@nestjs/common';
import type { Context } from 'grammy';
import type { User } from 'grammy/types';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { EngineHelpersService } from '../../bot-engine/engine-helpers.service';
import { AdminGateService } from '../../bot-engine/admin-gate.service';
import { AdminLogService } from '../../bot-engine/admin-log.service';
import { BotI18nService, type BotLanguage } from '../../bot-engine/bot-i18n.service';
import { ChatSettingsService } from '../../bot-engine/chat-settings.service';
import { RestrictionsService } from '../../bot-engine/restrictions.service';
import { PrismaService } from '../../database/prisma.service';
import { isChatTargeted, SIMULATOR_GROUP_ID } from '../../common/utils/chat-targets.util';
import { splitDurationArg } from '../../common/utils/duration.util';
import { userMentionHtml } from '../../common/utils/telegram-text.util';
import { matchBlocklist } from './blocklist-matcher';

/**
 * Runtime for the Automated Moderation & Anti-Spam module (v2). Enforces
 * per-chat blocklists (reference wildcards/modes/non-text triggers), link
 * blocking, and flood control with configurable punishments. Admins and
 * approved users are immune.
 */
@Injectable()
export class ModerationRuntime extends BotModuleHandler {
  private readonly logger = new Logger(ModerationRuntime.name);
  /** Registry key of the module. */
  readonly moduleKey = 'moderation';

  /** Message timestamps per (bot, chat, user) for flood control. */
  private readonly floodWindow = new Map<string, number[]>();

  /** Strike counters per (bot, chat, user) for legacy escalation. */
  private readonly strikes = new Map<string, number>();

  /** Last activity timestamp per key, for state sweeping. */
  private readonly lastSeen = new Map<string, number>();

  /** Max once-per-10-minutes guard for the sweep. */
  private lastSweepAt = 0;

  /**
   * Periodic in-memory sweep (max once per 10 minutes) so flood windows and
   * strike counters stay bounded: keys with no activity for 24h are dropped.
   * @returns {void}
   */
  private sweepStaleState(): void {
    const now = Date.now();
    if (now - this.lastSweepAt < 600_000) return;
    this.lastSweepAt = now;
    const staleCutoff = now - 86_400_000;
    for (const [key, seen] of this.lastSeen) {
      if (seen < staleCutoff) {
        this.lastSeen.delete(key);
        this.floodWindow.delete(key);
        this.strikes.delete(key);
      }
    }
  }

  /**
   * @param {EngineHelpersService} helpers - Shared audience operations.
   * @param {AdminGateService} adminGate - Telegram permission gate.
   * @param {RestrictionsService} restrictions - Shared action executor.
   * @param {AdminLogService} adminLog - Admin action log bus.
   * @param {BotI18nService} i18n - Bot-reply localization.
   * @param {ChatSettingsService} chatSettings - Per-chat config layer.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly helpers: EngineHelpersService,
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
   * Attaches group moderation middleware and reference-style settings commands.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot, botId } = ctx;

    bot.on('message', async (update, next) => {
      let blocked = false;
      try {
        if (update.chat?.type !== 'supergroup' && update.chat?.type !== 'group') {
          await next();
          return;
        }
        if (!update.from || update.from.id === bot.botInfo?.id) {
          await next();
          return;
        }
        const chatId = update.chat.id;
        const from = update.from;
        const key = `${botId}:${chatId}:${from.id}`;
        this.sweepStaleState();
        this.lastSeen.set(key, Date.now());

        const config = await this.chatSettings.getEffectiveConfig(botId, chatId, this.moduleKey);
        if (!isChatTargeted(config.targetChats, chatId)) {
          await next();
          return;
        }

        // Admins and approved users are immune to automated moderation.
        if (await this.isImmune(botId, update, chatId, from)) {
          await next();
          return;
        }

        // Blocklist (reference precedence: locks run in the locks module middleware
        // before blocklists when both modules are enabled).
        const blockedWords = Array.isArray(config.blockedWords)
          ? (config.blockedWords as string[])
          : [];
        if (blockedWords.length > 0 && config.blocklistDelete !== false) {
          const hit = matchBlocklist(blockedWords, update.msg, from);
          if (hit) {
            blocked = true;
            await this.applyBlocklistHit(
              ctx,
              update,
              chatId,
              from,
              config,
              hit.trigger,
              hit.action,
              hit.durationSeconds,
            );
            return;
          }
        }

        // Link blocking.
        const text = update.msg.text ?? update.msg.caption ?? '';
        if (
          config.blockLinks === true &&
          (text.includes('http://') || text.includes('https://') || text.includes('t.me/'))
        ) {
          blocked = true;
          await this.applyBlocklistHit(ctx, update, chatId, from, config, 'Link posting');
          return;
        }

        // Flood control (persistent window via sliding timestamps).
        const floodLimit = Number(config.floodMessageLimit ?? 0);
        if (floodLimit > 0) {
          const windowSeconds = Number(config.floodWindowSeconds ?? 10);
          const now = Date.now();
          const windowStart = now - windowSeconds * 1000;
          const timestamps = (this.floodWindow.get(key) ?? []).filter((ts) => ts >= windowStart);
          timestamps.push(now);
          this.floodWindow.set(key, timestamps);
          if (timestamps.length > floodLimit) {
            blocked = true;
            this.floodWindow.set(key, []);
            await this.applyFloodPunishment(update, botId, chatId, from, config);
            return;
          }
        }
      } catch (err) {
        this.logger.warn(
          `Moderation message handling error for bot ${botId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (!blocked) {
        await next();
      }
    });

    this.registerCommands(bot, botId);
  }

  /**
   * Registers the reference-style antiflood and blocklist commands.
   */
  private registerCommands(bot: import('grammy').Bot, botId: string): void {
    bot.command('setflood', (c) => this.handleSetFlood(c, botId, 'floodMessageLimit'));
    bot.command('setfloodtimer', (c) => this.handleSetFloodTimer(c, botId));
    bot.command('setfloodmode', (c) => this.handleSetFloodMode(c, botId));
    bot.command('clearflood', (c) => this.handleClearFlood(c, botId));
    bot.command('flood', (c) => this.handleFloodStatus(c, botId));
    bot.command('addblocklist', (c) => this.handleBlocklist(c, botId, 'add'));
    bot.command('rmblocklist', (c) => this.handleBlocklist(c, botId, 'remove'));
    bot.command('rmblocklistall', (c) => this.handleBlocklistAll(c, botId));
    bot.command('blocklist', (c) => this.handleBlocklistList(c, botId));
    bot.command('blocklistmode', (c) => this.handleBlocklistMode(c, botId));
    bot.command('blocklistdelete', (c) => this.handleBlocklistDelete(c, botId));
    bot.command('setblocklistreason', (c) => this.handleBlocklistReason(c, botId));
  }

  /**
   * Checks whether a sender is exempt from automated moderation.
   */
  private async isImmune(
    botId: string,
    update: Context,
    chatId: number,
    from: User,
  ): Promise<boolean> {
    if (from.is_bot) return true;
    if (
      chatId !== SIMULATOR_GROUP_ID &&
      (await this.adminGate.isAdmin(update.api, chatId, from.id))
    )
      return true;
    const approved = await this.prisma.chatApproval
      .findUnique({
        where: { botId_chatId_telegramId: { botId, chatId: String(chatId), telegramId: from.id } },
      })
      .catch(() => null);
    return approved !== null;
  }

  /**
   * Applies the blocklist punishment ladder for a matched trigger.
   */
  private async applyBlocklistHit(
    ctx: ModuleRuntimeContext,
    update: Context,
    chatId: number,
    from: User,
    config: Record<string, unknown>,
    trigger: string,
    entryAction?: string,
    entryDuration?: number,
  ): Promise<void> {
    await update.deleteMessage().catch(() => undefined);
    const botId = ctx.botId;
    const lang = await this.i18n.getChatLanguage(botId, chatId);

    const action = entryAction ?? String(config.blocklistMode ?? 'nothing');
    const reason = String(config.blocklistReason ?? '');

    this.adminLog.emit({
      botId,
      chatId,
      category: 'automated',
      text: `Blocklist hit [${trigger}] from ${from.first_name} → ${action}`,
    });

    if (action === 'nothing' || action === 'warn') {
      const gmConfig = await this.chatSettings.getEffectiveConfig(
        botId,
        chatId,
        'group-moderation',
      );
      const limit = Number(gmConfig.warnLimit ?? 3);
      await this.prisma.chatWarn.create({
        data: {
          botId,
          chatId: String(chatId),
          telegramId: from.id,
          reason: reason || `Blocklist match: ${trigger}`,
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
        if (warnMode === 'kick') await this.restrictions.kick(update.api, chatId, from.id);
        else if (warnMode === 'mute') await this.restrictions.mute(update.api, chatId, from.id);
        else if (warnMode === 'tmute')
          await this.restrictions.mute(update.api, chatId, from.id, warnDuration || 3_600);
        else if (warnMode === 'tban')
          await this.restrictions.ban(update.api, chatId, from.id, warnDuration || 86_400);
        else await this.restrictions.ban(update.api, chatId, from.id);
      } else if (action !== 'nothing') {
        await update
          .reply(this.i18n.t(lang, 'blocklist.hit', { count, limit }), {
            reply_parameters: { message_id: 0, allow_sending_without_reply: true },
          })
          .catch(() => undefined);
      }
      return;
    }

    await this.applyAction(
      update,
      chatId,
      from.id,
      action,
      entryDuration ?? Number(config.blocklistDurationSeconds ?? 0),
    );
  }

  /**
   * Applies a named action via the shared restrictions executor.
   */
  private async applyAction(
    update: Context,
    chatId: number,
    userId: number,
    action: string,
    durationSeconds: number,
  ): Promise<void> {
    switch (action) {
      case 'kick':
      case 'skick':
        await this.restrictions.kick(update.api, chatId, userId);
        break;
      case 'ban':
      case 'sban':
        await this.restrictions.ban(update.api, chatId, userId);
        break;
      case 'tban':
        await this.restrictions.ban(update.api, chatId, userId, durationSeconds || 86_400);
        break;
      case 'mute':
      case 'smute':
        await this.restrictions.mute(update.api, chatId, userId);
        break;
      case 'tmute':
        await this.restrictions.mute(update.api, chatId, userId, durationSeconds || 3_600);
        break;
      default:
        break;
    }
    if (!action.startsWith('s')) {
      await update
        .reply(
          `${userMentionHtml({ id: userId, is_bot: false, first_name: `User ${userId}` } as never)} — ${action}`,
          { parse_mode: 'HTML' },
        )
        .catch(() => undefined);
    }
  }

  /**
   * Applies the configured flood punishment.
   */
  private async applyFloodPunishment(
    update: Context,
    botId: string,
    chatId: number,
    from: User,
    config: Record<string, unknown>,
  ): Promise<void> {
    await update.deleteMessage().catch(() => undefined);
    const action = String(config.floodMode ?? 'mute');
    const duration = Number(config.floodDurationSeconds ?? 600);
    const lang = await this.i18n.getChatLanguage(botId, chatId);

    this.adminLog.emit({
      botId,
      chatId,
      category: 'automated',
      text: `Flood from ${from.first_name} → ${action}`,
    });

    await this.applyAction(update, chatId, from.id, action, duration);
    void lang;
  }

  /**
   * Guard for settings commands: group + change_info + explicit target chat.
   */
  private async guard(
    c: Context,
    botId: string,
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
   * Handles /setflood <n> (consecutive limit).
   */
  private async handleSetFlood(c: Context, botId: string, field: string): Promise<void> {
    const group = await this.guard(c, botId);
    if (!group) return;
    const value = Number(String(typeof c.match === 'string' ? c.match : '').trim());
    if (!Number.isFinite(value) || value < 0) {
      await c.reply(this.i18n.t(group.lang, 'common.error')).catch(() => undefined);
      return;
    }
    const override =
      (await this.chatSettings.getOverride(botId, group.chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, group.chatId, this.moduleKey, {
      ...override,
      [field]: value,
    });
    await c.reply(this.i18n.t(group.lang, 'flood.settingsSet')).catch(() => undefined);
  }

  /**
   * Handles /setfloodtimer <n> <window> (messages within a duration).
   */
  private async handleSetFloodTimer(c: Context, botId: string): Promise<void> {
    const group = await this.guard(c, botId);
    if (!group) return;
    const args = String(typeof c.match === 'string' ? c.match : '').trim();
    const parts = args.split(/\s+/);
    const limit = Number(parts[0]);
    const { seconds } = splitDurationArg(parts.slice(1).join(' '));
    if (!Number.isFinite(limit) || limit <= 0 || !seconds) {
      await c.reply(this.i18n.t(group.lang, 'common.invalidDuration')).catch(() => undefined);
      return;
    }
    const override =
      (await this.chatSettings.getOverride(botId, group.chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, group.chatId, this.moduleKey, {
      ...override,
      floodMessageLimit: limit,
      floodWindowSeconds: Math.round(seconds),
    });
    await c.reply(this.i18n.t(group.lang, 'flood.settingsSet')).catch(() => undefined);
  }

  /**
   * Handles /setfloodmode <action>.
   */
  private async handleSetFloodMode(c: Context, botId: string): Promise<void> {
    const group = await this.guard(c, botId);
    if (!group) return;
    const args = String(typeof c.match === 'string' ? c.match : '').trim();
    const { seconds, rest } = splitDurationArg(args);
    const mode = rest.toLowerCase();
    if (!['kick', 'ban', 'tban', 'mute', 'tmute'].includes(mode)) {
      await c.reply(this.i18n.t(group.lang, 'common.error')).catch(() => undefined);
      return;
    }
    if ((mode === 'tban' || mode === 'tmute') && !seconds) {
      await c.reply(this.i18n.t(group.lang, 'common.invalidDuration')).catch(() => undefined);
      return;
    }
    const override =
      (await this.chatSettings.getOverride(botId, group.chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, group.chatId, this.moduleKey, {
      ...override,
      floodMode: mode,
      floodDurationSeconds: seconds ?? 600,
    });
    await c.reply(this.i18n.t(group.lang, 'flood.settingsSet')).catch(() => undefined);
  }

  /**
   * Handles /clearflood on|off.
   */
  private async handleClearFlood(c: Context, botId: string): Promise<void> {
    const group = await this.guard(c, botId);
    if (!group) return;
    const enable = ['on', 'yes', 'true'].includes(
      String(typeof c.match === 'string' ? c.match : '')
        .trim()
        .toLowerCase(),
    );
    const override =
      (await this.chatSettings.getOverride(botId, group.chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, group.chatId, this.moduleKey, {
      ...override,
      clearFlood: enable,
    });
    await c.reply(this.i18n.t(group.lang, 'common.done')).catch(() => undefined);
  }

  /**
   * Handles /flood — shows the current antiflood configuration.
   */
  private async handleFloodStatus(c: Context, botId: string): Promise<void> {
    const group = await this.guard(c, botId);
    if (!group) return;
    const { floodMessageLimit, floodWindowSeconds, floodMode } = group.config;
    await c
      .reply(
        `Flood: ${Number(floodMessageLimit ?? 0)} msg / ${Number(floodWindowSeconds ?? 10)}s → ${String(floodMode ?? 'mute')}`,
      )
      .catch(() => undefined);
  }

  /**
   * Handles /addblocklist and /rmblocklist (single, phrase, or (a, b, c)).
   */
  private async handleBlocklist(c: Context, botId: string, mode: 'add' | 'remove'): Promise<void> {
    const group = await this.guard(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    const raw = String(typeof c.match === 'string' ? c.match : '').trim();
    if (!raw) return;

    const triggers: string[] = [];
    const listMatch = raw.match(/^\((.*)\)([\s\S]*)$/);
    if (listMatch) {
      for (const part of listMatch[1].split(',')) {
        const trimmed = part.trim().replace(/^"|"$/g, '');
        if (trimmed) triggers.push(trimmed);
      }
    } else {
      // First token (or quoted phrase) is the trigger, rest is the reason.
      const quoted = raw.match(/^"([^"]+)"\s*(.*)$/);
      if (quoted) {
        triggers.push(quoted[1]);
      } else {
        triggers.push(raw.split(/\s+/)[0]);
      }
    }

    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    const current = Array.isArray(override.blockedWords)
      ? [...(override.blockedWords as string[])]
      : Array.isArray(group.config.blockedWords)
        ? [...(group.config.blockedWords as string[])]
        : [];
    const next =
      mode === 'add'
        ? [...new Set([...current, ...triggers])]
        : current.filter((item) => !triggers.includes(item));

    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      blockedWords: next,
    });
    await c
      .reply(this.i18n.t(lang, mode === 'add' ? 'blocklist.added' : 'blocklist.removed'))
      .catch(() => undefined);
    this.adminLog.emit({
      botId,
      chatId,
      category: 'settings',
      text: `${c.from!.first_name} ${mode === 'add' ? 'added' : 'removed'} blocklist: ${triggers.join(', ')}`,
    });
  }

  /**
   * Handles /rmblocklistall (owner only).
   */
  private async handleBlocklistAll(c: Context, botId: string): Promise<void> {
    const group = await this.guard(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.adminGate.isOwner(c.api, chatId, c.from!.id))) {
      await c.reply(this.i18n.t(lang, 'common.adminOnly')).catch(() => undefined);
      return;
    }
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      blockedWords: [],
    });
    await c.reply(this.i18n.t(lang, 'blocklist.cleared')).catch(() => undefined);
  }

  /**
   * Handles /blocklist — lists triggers.
   */
  private async handleBlocklistList(c: Context, botId: string): Promise<void> {
    const group = await this.guard(c, botId);
    if (!group) return;
    const words = Array.isArray(group.config.blockedWords)
      ? (group.config.blockedWords as string[])
      : [];
    if (words.length === 0) {
      await c.reply(this.i18n.t(group.lang, 'blocklist.empty')).catch(() => undefined);
      return;
    }
    await c
      .reply(
        `${this.i18n.t(group.lang, 'blocklist.listTitle', { count: words.length })}\n${words
          .map((word) => `• ${word}`)
          .join('\n')}`,
      )
      .catch(() => undefined);
  }

  /**
   * Handles /blocklistmode <nothing|warn|kick|ban|tban T|mute|tmute T>.
   */
  private async handleBlocklistMode(c: Context, botId: string): Promise<void> {
    const group = await this.guard(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    const args = String(typeof c.match === 'string' ? c.match : '').trim();
    const { seconds, rest } = splitDurationArg(args);
    const mode = rest.toLowerCase();
    if (!['nothing', 'warn', 'kick', 'ban', 'tban', 'mute', 'tmute'].includes(mode)) {
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
      blocklistMode: mode,
      blocklistDurationSeconds: seconds ?? 0,
    });
    await c.reply(this.i18n.t(lang, 'common.done')).catch(() => undefined);
  }

  /**
   * Handles /blocklistdelete on|off.
   */
  private async handleBlocklistDelete(c: Context, botId: string): Promise<void> {
    const group = await this.guard(c, botId);
    if (!group) return;
    const enable = ['on', 'yes', 'true'].includes(
      String(typeof c.match === 'string' ? c.match : '')
        .trim()
        .toLowerCase(),
    );
    const override =
      (await this.chatSettings.getOverride(botId, group.chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, group.chatId, this.moduleKey, {
      ...override,
      blocklistDelete: enable,
    });
    await c.reply(this.i18n.t(group.lang, 'common.done')).catch(() => undefined);
  }

  /**
   * Handles /setblocklistreason <text>.
   */
  private async handleBlocklistReason(c: Context, botId: string): Promise<void> {
    const group = await this.guard(c, botId);
    if (!group) return;
    const reason = String(typeof c.match === 'string' ? c.match : '').trim();
    const override =
      (await this.chatSettings.getOverride(botId, group.chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, group.chatId, this.moduleKey, {
      ...override,
      blocklistReason: reason,
    });
    await c.reply(this.i18n.t(group.lang, 'common.done')).catch(() => undefined);
  }
}
