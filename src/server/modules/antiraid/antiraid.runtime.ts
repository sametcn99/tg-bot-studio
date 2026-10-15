import { Injectable } from '@nestjs/common';
import type { Context } from 'grammy';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { AdminGateService } from '../../bot-engine/admin-gate.service';
import { AdminLogService } from '../../bot-engine/admin-log.service';
import { BotI18nService, type BotLanguage } from '../../bot-engine/bot-i18n.service';
import { ChatSettingsService } from '../../bot-engine/chat-settings.service';
import { RestrictionsService } from '../../bot-engine/restrictions.service';
import { formatDuration, splitDurationArg } from '../../common/utils/duration.util';

/** Active antiraid windows keyed by (bot, chat). */
interface RaidState {
  /** Epoch ms when active raid mode turns off (0 = inactive). */
  until: number;
  /** Join timestamps for auto-trigger detection. */
  joins: number[];
}

/**
 * Runtime for the AntiRaid module: while raid mode is active (manually via
 * /antiraid or automatically when join rates spike), every new joiner is
 * temporarily banned so raids drain out without collateral damage.
 */
@Injectable()
export class AntiraidRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'antiraid';

  /** Per-(bot, chat) raid state. */
  private readonly state = new Map<string, RaidState>();

  /**
   * @param {AdminGateService} adminGate - Telegram permission gate.
   * @param {RestrictionsService} restrictions - Shared action executor.
   * @param {AdminLogService} adminLog - Admin action log bus.
   * @param {BotI18nService} i18n - Bot-reply localization.
   * @param {ChatSettingsService} chatSettings - Per-chat config layer.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
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
   * Attaches join monitoring and raid management commands.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot, botId } = ctx;

    // Join tracking: raid bans + auto-trigger rate detection.
    bot.on(['message:new_chat_members', 'chat_member'], async (update) => {
      if (!update.chat || (update.chat.type !== 'supergroup' && update.chat.type !== 'group')) {
        return;
      }
      const chatId = update.chat.id;
      const config = await this.chatSettings.getEffectiveConfig(botId, chatId, this.moduleKey);
      const key = `${botId}:${chatId}`;
      const state = this.state.get(key) ?? { until: 0, joins: [] };
      const now = Date.now();

      // Auto-trigger: N joins within a minute enables raid mode.
      const threshold = Number(config.autoRaidJoinThreshold ?? 0);
      if (threshold > 0) {
        state.joins = [...state.joins.filter((ts) => now - ts < 60_000), now];
        if (state.until <= Date.now() && state.joins.length >= threshold) {
          const raidTime = Number(config.raidTimeSeconds ?? 21_600);
          state.until = now + raidTime * 1000;
          this.adminLog.emit({
            botId,
            chatId,
            category: 'automated',
            text: `AntiRaid auto-enabled (${state.joins.length} joins/min)`,
          });
        }
      }

      if (state.until > Date.now()) {
        const actionTime = Number(config.raidActionTimeSeconds ?? 3_600);
        const newcomerId =
          update.chatMember?.new_chat_member.user.id ?? update.msg?.new_chat_members?.[0]?.id;
        if (newcomerId && newcomerId !== bot.botInfo?.id) {
          await this.restrictions.ban(update.api, chatId, newcomerId, actionTime);
          this.adminLog.emit({
            botId,
            chatId,
            category: 'automated',
            text: `AntiRaid temp-banned joiner ${newcomerId} (${formatDuration(actionTime)})`,
          });
        }
      }

      this.state.set(key, state);
    });

    bot.command('antiraid', (c) => this.handleAntiraid(c, botId));
    bot.command('raidtime', (c) => this.handleRaidTime(c, botId, 'raidTimeSeconds'));
    bot.command('raidactiontime', (c) => this.handleRaidTime(c, botId, 'raidActionTimeSeconds'));
    bot.command('autoantiraid', (c) => this.handleAutoAntiraid(c, botId));
  }

  /**
   * Handles /antiraid [on|off|<duration>].
   */
  private async handleAntiraid(c: Context, botId: number): Promise<void> {
    const group = await this.guard(c, botId);
    if (!group) return;
    const { chatId, lang, config } = group;
    const args = String(typeof c.match === 'string' ? c.match : '')
      .trim()
      .toLowerCase();
    const key = `${botId}:${chatId}`;
    const state = this.state.get(key) ?? { until: 0, joins: [] };

    if (args === 'off' || args === 'no' || args === 'false') {
      state.until = 0;
      this.state.set(key, state);
      await c.reply(this.i18n.t(lang, 'antiraid.disabled')).catch(() => undefined);
      return;
    }

    const custom = splitDurationArg(args).seconds;
    const raidTime = custom ?? Number(config.raidTimeSeconds ?? 21_600);
    const actionTime = Number(config.raidActionTimeSeconds ?? 3_600);
    state.until = Date.now() + raidTime * 1000;
    this.state.set(key, state);

    await c
      .reply(
        this.i18n.t(lang, 'antiraid.enabled', {
          duration: formatDuration(raidTime),
          actionTime: formatDuration(actionTime),
        }),
      )
      .catch(() => undefined);
    this.adminLog.emit({
      botId,
      chatId,
      category: 'admin',
      text: `${c.from!.first_name} enabled AntiRaid for ${formatDuration(raidTime)}`,
    });
  }

  /**
   * Handles /raidtime and /raidactiontime <duration>.
   */
  private async handleRaidTime(c: Context, botId: number, field: string): Promise<void> {
    const group = await this.guard(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    const seconds = splitDurationArg(
      String(typeof c.match === 'string' ? c.match : '').trim(),
    ).seconds;
    if (!seconds) {
      await c.reply(this.i18n.t(lang, 'common.invalidDuration')).catch(() => undefined);
      return;
    }
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      [field]: seconds,
    });
    await c.reply(this.i18n.t(lang, 'common.done')).catch(() => undefined);
  }

  /**
   * Handles /autoantiraid <threshold|off>.
   */
  private async handleAutoAntiraid(c: Context, botId: number): Promise<void> {
    const group = await this.guard(c, botId);
    if (!group) return;
    const { chatId, lang } = group;
    const args = String(typeof c.match === 'string' ? c.match : '')
      .trim()
      .toLowerCase();
    const threshold = args === 'off' || args === 'no' ? 0 : Number(args.split(/\s+/)[0]) || -1;
    if (threshold < 0) {
      await c.reply(this.i18n.t(lang, 'common.error')).catch(() => undefined);
      return;
    }
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      autoRaidJoinThreshold: threshold,
    });
    await c.reply(this.i18n.t(lang, 'common.done')).catch(() => undefined);
  }

  /**
   * Guard: group + restrict capability.
   */
  private async guard(
    c: Context,
    botId: number,
  ): Promise<{ chatId: number; lang: BotLanguage; config: Record<string, unknown> } | null> {
    if (c.chat?.type !== 'supergroup' && c.chat?.type !== 'group') return null;
    if (!c.from) return null;
    const chatId = c.chat.id;
    if (!(await this.adminGate.hasCapability(c.api, chatId, c.from.id, 'restrict'))) {
      return null;
    }
    const lang = await this.i18n.getChatLanguage(botId, chatId);
    const config = await this.chatSettings.getEffectiveConfig(botId, chatId, this.moduleKey);
    return { chatId, lang, config };
  }
}
