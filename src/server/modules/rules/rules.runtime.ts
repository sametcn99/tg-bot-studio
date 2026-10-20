import { Injectable, Logger } from '@nestjs/common';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { AdminGateService } from '../../bot-engine/admin-gate.service';
import { BotI18nService } from '../../bot-engine/bot-i18n.service';
import { ChatSettingsService } from '../../bot-engine/chat-settings.service';
import { AdminLogService } from '../../bot-engine/admin-log.service';
import { isChatTargeted } from '../../common/utils/chat-targets.util';

/**
 * Runtime for the Group Rules module (reference parity): per-group rules text,
 * /rules delivery (in chat or via a PM button), /start rules_<chatId> deep
 * link powering the {rules} template placeholder, and button renaming.
 */
@Injectable()
export class RulesRuntime extends BotModuleHandler {
  private readonly logger = new Logger(RulesRuntime.name);
  /** Registry key of the module. */
  readonly moduleKey = 'rules';

  /**
   * @param {AdminGateService} adminGate - Telegram permission gate.
   * @param {BotI18nService} i18n - Bot-reply localization.
   * @param {ChatSettingsService} chatSettings - Per-chat config layer.
   * @param {AdminLogService} adminLog - Admin action log bus.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly adminGate: AdminGateService,
    private readonly i18n: BotI18nService,
    private readonly chatSettings: ChatSettingsService,
    private readonly adminLog: AdminLogService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches rules commands and the PM deep link.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot, botId } = ctx;

    bot.command('rules', (c) => this.handleRules(c, botId));
    bot.command('setrules', (c) => this.handleSetRules(c, botId));
    bot.command('resetrules', (c) => this.handleResetRules(c, botId));
    bot.command('privaterules', (c) => this.handlePrivateRules(c, botId));
    bot.command('setrulesbutton', (c) => this.handleRulesButton(c, botId));
    bot.command('resetrulesbutton', (c) => this.handleRulesButtonReset(c, botId));

    // PM deep link used by the {rules} placeholder: /start rules_<chatId>.
    bot.command('start', async (c, next) => {
      try {
        if (c.chat?.type !== 'private' || !c.from) return;
        const payload = String(typeof c.match === 'string' ? c.match : '').trim();
        if (!payload.startsWith('rules_')) return;
        const chatId = payload.slice('rules_'.length);
        const config = await this.chatSettings.getEffectiveConfig(botId, chatId, this.moduleKey);
        if (!isChatTargeted(config.targetChats, chatId)) return;
        const lang = await this.i18n.getChatLanguage(botId, chatId);
        const text = String(config.rulesText ?? '');
        if (!text) {
          await c.reply(this.i18n.t(lang, 'rules.noneSet')).catch(() => undefined);
          return;
        }
        await c.reply(text, { parse_mode: 'HTML' }).catch(() => undefined);
      } catch (err) {
        this.logger.warn(
          `Rules /start handling error for bot ${botId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        await next();
      }
    });
  }

  /**
   * Builds the {rules} placeholder URL for a chat (PM deep link).
   *
   * @param {ModuleRuntimeContext} ctx - Runtime context.
   * @param {number} chatId - Group chat id.
   * @returns {string} t.me deep link to read the rules in PM.
   */
  public rulesDeepLink(ctx: ModuleRuntimeContext, chatId: number): string {
    const username = ctx.bot.botInfo?.username ?? 'this_bot';
    return `https://t.me/${username}?start=rules_${chatId}`;
  }

  /**
   * Handles /rules — in-chat text or PM button delivery.
   */
  private async handleRules(c: import('grammy').Context, botId: string): Promise<void> {
    if (!c.chat) return;
    const isGroup = c.chat.type === 'supergroup' || c.chat.type === 'group';
    const isPrivate = c.chat.type === 'private';
    if (!isGroup && !isPrivate) return;
    const chatId = c.chat.id;
    const lang = await this.i18n.getChatLanguage(botId, chatId);
    const config = await this.chatSettings.getEffectiveConfig(botId, chatId, this.moduleKey);
    if (!isChatTargeted(config.targetChats, chatId)) return;
    const text = String(config.rulesText ?? '');
    if (!text) {
      await c.reply(this.i18n.t(lang, 'rules.noneSet')).catch(() => undefined);
      return;
    }

    if (isGroup && config.privateRules !== false) {
      const username = c.me.username ?? 'this_bot';
      await c
        .reply(this.i18n.t(lang, 'rules.dmPrompt'), {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: String(config.rulesButton ?? this.i18n.t(lang, 'rules.buttonLabel')),
                  url: `https://t.me/${username}?start=rules_${chatId}`,
                },
              ],
            ],
          },
        })
        .catch(() => undefined);
      return;
    }
    await c.reply(text, { parse_mode: 'HTML' }).catch(() => undefined);
  }

  /**
   * Handles /setrules <text>.
   */
  private async handleSetRules(c: import('grammy').Context, botId: string): Promise<void> {
    if (c.chat?.type !== 'supergroup' && c.chat?.type !== 'group') return;
    if (
      !c.from ||
      !(await this.adminGate.hasCapability(c.api, c.chat.id, c.from.id, 'change_info'))
    ) {
      return;
    }
    const chatId = c.chat.id;
    const text = String(typeof c.match === 'string' ? c.match : '').trim();
    if (!text) return;
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      rulesText: text,
    });
    await c.reply('✅').catch(() => undefined);
    this.adminLog.emit({
      botId,
      chatId,
      category: 'settings',
      text: `${c.from.first_name} updated the rules`,
    });
  }

  /**
   * Handles /resetrules.
   */
  private async handleResetRules(c: import('grammy').Context, botId: string): Promise<void> {
    if (c.chat?.type !== 'supergroup' && c.chat?.type !== 'group') return;
    if (
      !c.from ||
      !(await this.adminGate.hasCapability(c.api, c.chat.id, c.from.id, 'change_info'))
    ) {
      return;
    }
    const chatId = c.chat.id;
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    delete override.rulesText;
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, override);
    await c.reply('✅').catch(() => undefined);
  }

  /**
   * Handles /privaterules on|off (on by default, reference parity).
   */
  private async handlePrivateRules(c: import('grammy').Context, botId: string): Promise<void> {
    if (c.chat?.type !== 'supergroup' && c.chat?.type !== 'group') return;
    if (
      !c.from ||
      !(await this.adminGate.hasCapability(c.api, c.chat.id, c.from.id, 'change_info'))
    ) {
      return;
    }
    const chatId = c.chat.id;
    const enable = ['on', 'yes', 'true'].includes(
      String(typeof c.match === 'string' ? c.match : '')
        .trim()
        .toLowerCase(),
    );
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      privateRules: enable,
    });
    await c.reply('✅').catch(() => undefined);
  }

  /**
   * Handles /setrulesbutton <label>.
   */
  private async handleRulesButton(c: import('grammy').Context, botId: string): Promise<void> {
    if (c.chat?.type !== 'supergroup' && c.chat?.type !== 'group') return;
    if (
      !c.from ||
      !(await this.adminGate.hasCapability(c.api, c.chat.id, c.from.id, 'change_info'))
    ) {
      return;
    }
    const chatId = c.chat.id;
    const label = String(typeof c.match === 'string' ? c.match : '').trim();
    if (!label) return;
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      rulesButton: label,
    });
    await c.reply('✅').catch(() => undefined);
  }

  /**
   * Handles /resetrulesbutton.
   */
  private async handleRulesButtonReset(c: import('grammy').Context, botId: string): Promise<void> {
    if (c.chat?.type !== 'supergroup' && c.chat?.type !== 'group') return;
    if (
      !c.from ||
      !(await this.adminGate.hasCapability(c.api, c.chat.id, c.from.id, 'change_info'))
    ) {
      return;
    }
    const chatId = c.chat.id;
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    delete override.rulesButton;
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, override);
    await c.reply('✅').catch(() => undefined);
  }
}
