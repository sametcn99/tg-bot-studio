import { Injectable, Logger } from '@nestjs/common';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { DatabaseService } from '../../database/database.service';
import { AiAssistantService, type AiConfig, type ChatMessage } from './ai-assistant.service';

/**
 * Runtime for the AI Knowledge Assistant module. Answers private text
 * messages around the clock using the configured provider and system prompt,
 * keeping a short per-user history in memory. Messages already claimed by
 * the support desk or matched by autoresponder rules are left untouched.
 */
@Injectable()
export class AiAssistantRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'ai-assistant';

  private readonly logger = new Logger(AiAssistantRuntime.name);

  /** Per-user conversation history keyed `${botId}:${telegramId}`. */
  private readonly history = new Map<string, ChatMessage[]>();

  /**
   * @param {AiAssistantService} service - Provider gateway.
   * @param {DatabaseService} db - SQLite access service.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly service: AiAssistantService,
    private readonly db: DatabaseService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches the private-chat AI handler to the bot.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot } = ctx;
    const config = ctx.config as unknown as AiConfig;

    bot.on('message:text', async (update) => {
      if (update.chat?.type !== 'private') return;
      if (update.msg.text.startsWith('/')) return;
      if (!update.from) return;

      // The support desk owns private conversations when enabled.
      if (this.moduleEnabled(ctx.botId, 'support')) return;
      // Autoresponder keyword rules take precedence.
      if (this.matchedAutoresponder(ctx.botId, update.msg.text)) return;

      const key = `${ctx.botId}:${update.from.id}`;
      const userHistory = this.history.get(key) ?? [];
      userHistory.push({ role: 'user', content: update.msg.text });

      try {
        const reply = await this.service.complete(config, userHistory);
        userHistory.push({ role: 'assistant', content: reply });
        this.history.set(key, userHistory.slice(-(config.historyLimit || 6) * 2));
        await update.reply(reply);
      } catch (error) {
        this.logger.warn(
          `AI reply failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        await update
          .reply('The assistant is temporarily unavailable. Please try again later.')
          .catch(() => undefined);
      }
    });
  }

  /**
   * Checks whether a module is enabled for the bot.
   * @param {number} botId - Owning bot id.
   * @param {string} moduleKey - Module registry key.
   * @returns {boolean} True when enabled.
   */
  private moduleEnabled(botId: number, moduleKey: string): boolean {
    return Boolean(
      this.db.get<{ is_enabled: number }>(
        'SELECT is_enabled FROM bot_modules WHERE bot_id = ? AND module_key = ?',
        botId,
        moduleKey,
      )?.is_enabled,
    );
  }

  /**
   * Checks whether an autoresponder rule claims the message text.
   * @param {number} botId - Owning bot id.
   * @param {string} text - Incoming message text.
   * @returns {boolean} True when a keyword rule matches.
   */
  private matchedAutoresponder(botId: number, text: string): boolean {
    if (!this.moduleEnabled(botId, 'autoresponder')) return false;
    const rules = this.db.query<{ command: string }>(
      'SELECT command FROM autoresponders WHERE bot_id = ? AND is_active = 1',
      botId,
    );
    return rules.some(
      (rule) =>
        !rule.command.startsWith('/') &&
        text.toLowerCase().includes(rule.command.toLowerCase()),
    );
  }
}
