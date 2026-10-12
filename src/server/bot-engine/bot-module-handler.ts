import type { Bot } from 'grammy';

/**
 * Context handed to a module runtime when its middleware is attached to a
 * running bot.
 * @interface ModuleRuntimeContext
 * @property {Bot} bot - Live grammY instance for the bot.
 * @property {number} botId - Studio database id of the bot.
 * @property {Record<string, unknown>} config - Effective module configuration
 * (stored config merged over registry defaults).
 */
export interface ModuleRuntimeContext {
  bot: Bot;
  botId: number;
  config: Record<string, unknown>;
}

/**
 * Contract implemented by every feature module runtime. Handlers register
 * themselves into the {@link ModuleHandlerRegistry} on init; the bot pool
 * invokes `register` for each enabled module when (re)building a bot.
 */
export abstract class BotModuleHandler {
  /** Stable module key matching an entry in MODULE_REGISTRY. */
  abstract readonly moduleKey: string;

  /**
   * Attaches the module's grammY middleware to the bot instance.
   * @param {ModuleRuntimeContext} _ctx - Runtime context with bot and config.
   * @returns {void | Promise<void>} Nothing, or a promise resolved once wired.
   */
  abstract register(_ctx: ModuleRuntimeContext): void | Promise<void>;
}
