import { Injectable, Logger } from '@nestjs/common';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';

/**
 * Runtime for the Telegram Business Secretary module. Answers client
 * messages arriving through a Telegram Business connection with the
 * configured auto-reply. The Bot API surface for business messaging evolves
 * independently, so the reply is sent through the raw API with the business
 * chat id extracted from the incoming update.
 */
@Injectable()
export class BusinessRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'business';

  private readonly logger = new Logger(BusinessRuntime.name);

  /**
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(registry: ModuleHandlerRegistry) {
    super();
    registry.register(this);
  }

  /**
   * Attaches business message handling to the bot.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot } = ctx;
    const configuredConnection = String(ctx.config.connectionId ?? '');
    const autoReplyText = String(ctx.config.autoReplyText ?? '');
    if (!autoReplyText) return;

    bot.on('message', async (update, next) => {
      try {
        const message = update.msg as {
          business_connection_id?: string;
          business_chat_id?: number;
          chat?: { id: number };
          text?: string;
        };
        if (!message.business_connection_id) return;
        if (message.text?.startsWith('/')) return;
        if (configuredConnection && message.business_connection_id !== configuredConnection) return;

        // Business replies target the business chat id when present.
        const target = message.business_chat_id ?? message.chat?.id;
        if (!target) return;

        try {
          await (
            bot.api.raw as unknown as {
              sendMessage: (params: Record<string, unknown>) => Promise<unknown>;
            }
          ).sendMessage({
            chat_id: target,
            business_connection_id: message.business_connection_id,
            text: autoReplyText,
          });
        } catch (error) {
          this.logger.warn(
            `Business reply failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } finally {
        await next();
      }
    });
  }
}
