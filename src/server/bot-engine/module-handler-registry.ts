import { Injectable } from '@nestjs/common';
import { BotModuleHandler } from './bot-module-handler';

/**
 * Runtime collection of every feature module handler. Feature modules
 * self-register during their `onModuleInit`; the bot pool reads the registry
 * after application bootstrap to wire enabled modules.
 */
@Injectable()
export class ModuleHandlerRegistry {
  private readonly handlers = new Map<string, BotModuleHandler>();

  /**
   * Registers (or replaces) a module handler.
   * @param {BotModuleHandler} handler - Handler implementation.
   * @returns {void}
   */
  register(handler: BotModuleHandler): void {
    this.handlers.set(handler.moduleKey, handler);
  }

  /**
   * Fetches a registered handler by module key.
   * @param {string} key - Module identifier.
   * @returns {BotModuleHandler | undefined} Handler when registered.
   */
  get(key: string): BotModuleHandler | undefined {
    return this.handlers.get(key);
  }

  /**
   * Lists every registered handler.
   * @returns {BotModuleHandler[]} All handlers.
   */
  all(): BotModuleHandler[] {
    return [...this.handlers.values()];
  }
}
