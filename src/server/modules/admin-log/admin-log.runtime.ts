import { Injectable, Logger } from '@nestjs/common';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { AdminGateService } from '../../bot-engine/admin-gate.service';
import { AdminLogService, type AdminLogCategory } from '../../bot-engine/admin-log.service';
import { ChatSettingsService } from '../../bot-engine/chat-settings.service';
import { escapeHtml } from '../../common/utils/telegram-text.util';

/**
 * Runtime for the Admin Log Channel module: subscribes to the shared
 * AdminLogService bus and forwards events of the enabled categories to the
 * configured Telegram log channel (reference /setlog parity, dashboard-driven).
 */
@Injectable()
export class AdminLogRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'admin-log';

  private readonly logger = new Logger(AdminLogRuntime.name);

  /**
   * @param {AdminLogService} adminLog - Admin action log bus.
   * @param {AdminGateService} adminGate - Telegram permission gate.
   * @param {ChatSettingsService} chatSettings - Per-chat config layer.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly adminLog: AdminLogService,
    private readonly adminGate: AdminGateService,
    private readonly chatSettings: ChatSettingsService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Subscribes this bot to the log bus, forwarding events to the log chat.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot, botId } = ctx;

    // /setlog in the target channel (admin forwards the confirmation into
    // the group to link it — simplified: run /setlog while replying in the
    // group, or configure from the dashboard).
    bot.command('setlog', async (c) => {
      if (c.chat?.type !== 'supergroup' && c.chat?.type !== 'group') return;
      if (!c.from || !(await this.adminGate.isOwner(c.api, c.chat.id, c.from.id))) return;
      const args = String(typeof c.match === 'string' ? c.match : '').trim();
      if (!/^-?\d+$/.test(args)) return;
      const override = (await this.chatSettings.getOverride(botId, c.chat.id, this.moduleKey)) ?? {};
      await this.chatSettings.setOverride(botId, c.chat.id, this.moduleKey, {
        ...override,
        logChatId: Number(args),
      });
      await c.reply('✅').catch(() => undefined);
    });

    bot.command('unsetlog', async (c) => {
      if (c.chat?.type !== 'supergroup' && c.chat?.type !== 'group') return;
      if (!c.from || !(await this.adminGate.isOwner(c.api, c.chat.id, c.from.id))) return;
      const override = (await this.chatSettings.getOverride(botId, c.chat.id, this.moduleKey)) ?? {};
      await this.chatSettings.setOverride(botId, c.chat.id, this.moduleKey, {
        ...override,
        logChatId: 0,
      });
      await c.reply('✅').catch(() => undefined);
    });

    bot.command('logchannel', async (c) => {
      if (c.chat?.type !== 'supergroup' && c.chat?.type !== 'group') return;
      if (!c.from || !(await this.adminGate.hasCapability(c.api, c.chat.id, c.from.id, 'change_info'))) {
        return;
      }
      const config = await this.chatSettings.getEffectiveConfig(botId, c.chat.id, this.moduleKey);
      await c.reply(`Log channel: ${Number(config.logChatId ?? 0) || '—'}`).catch(() => undefined);
    });

    this.adminLog.subscribe(botId, (event) => {
      void this.forward(ctx, event.chatId, event.category, event.text);
    });
  }

  /**
   * Forwards one event to the chat's log channel when its category is on.
   */
  private async forward(
    ctx: ModuleRuntimeContext,
    sourceChatId: number,
    category: AdminLogCategory,
    text: string,
  ): Promise<void> {
    try {
      const config = await this.chatSettings.getEffectiveConfig(
        ctx.botId,
        sourceChatId,
        this.moduleKey,
      );
      const logChatId = Number(config.logChatId ?? 0);
      if (!logChatId) return;
      const categories = Array.isArray(config.categories)
        ? (config.categories as string[])
        : ['settings', 'admin', 'user', 'automated', 'reports', 'other'];
      if (!categories.includes(category)) return;

      await ctx.bot.api.sendMessage(
        logChatId,
        `[${category}] ${escapeHtml(text)}`,
        { parse_mode: 'HTML' },
      );
    } catch (error) {
      this.logger.warn(
        `Log forward failed for bot ${ctx.botId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
