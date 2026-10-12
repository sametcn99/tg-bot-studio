import { Injectable } from '@nestjs/common';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { EngineHelpersService } from '../../bot-engine/engine-helpers.service';
import { EngagementService } from './engagement.service';

/**
 * Runtime for the Reaction Analytics & Gamification module. Tracks emoji
 * reactions on channel posts and rewards the reacting member with points.
 * Note: bots receive `message_reaction` updates only for chats where the
 * reaction actor is visible; anonymous reactions cannot be attributed.
 */
@Injectable()
export class ReactionsRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'reactions';

  /**
   * @param {EngagementService} service - Engagement service.
   * @param {EngineHelpersService} helpers - Shared audience operations.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly service: EngagementService,
    private readonly helpers: EngineHelpersService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches reaction tracking middleware to the bot.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const pointsPerReaction = Number(ctx.config.pointsPerReaction ?? 1);

    ctx.bot.on('message_reaction', (update) => {
      const reaction = update.messageReaction;
      const userId = (reaction as { user_id?: number }).user_id;
      if (!userId) return;

      for (const entry of reaction.new_reaction) {
        if (entry.type !== 'emoji') continue;
        this.service.recordReaction(ctx.botId, entry.emoji);
        this.helpers.addPoints(ctx.botId, userId, pointsPerReaction);
      }
    });
  }
}
