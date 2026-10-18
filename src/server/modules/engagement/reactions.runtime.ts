import { Injectable } from '@nestjs/common';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { ChatSettingsService } from '../../bot-engine/chat-settings.service';
import { EngineHelpersService } from '../../bot-engine/engine-helpers.service';
import { isChatTargeted } from '../../common/utils/chat-targets.util';
import { EngagementService } from './engagement.service';

/**
 * Runtime for the Reaction Analytics & Gamification module. Tracks emoji
 * reactions on channel posts and rewards the reacting member with points;
 * the reward weight is read per chat so groups and channels can override
 * the bot-level default. Note: bots receive `message_reaction` updates only
 * for chats where the reaction actor is visible; anonymous reactions cannot
 * be attributed.
 */
@Injectable()
export class ReactionsRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'reactions';

  /**
   * @param {EngagementService} service - Engagement service.
   * @param {EngineHelpersService} helpers - Shared audience operations.
   * @param {ChatSettingsService} chatSettings - Per-chat config layer.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly service: EngagementService,
    private readonly helpers: EngineHelpersService,
    private readonly chatSettings: ChatSettingsService,
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
    ctx.bot.on('message_reaction', async (update) => {
      const reaction = update.messageReaction;
      const chatId = (reaction as { chat_id?: number }).chat_id;
      const userId = (reaction as { user_id?: number }).user_id;
      if (!userId || !chatId) return;

      // Effective per-chat weight (chat override -> bot config -> default),
      // and the explicit-target gate: untargeted chats earn nothing.
      const config = await this.chatSettings.getEffectiveConfig(ctx.botId, chatId, this.moduleKey);
      if (!isChatTargeted(config.targetChats, chatId)) return;
      const pointsPerReaction = Math.max(0, Number(config.pointsPerReaction ?? 1));

      for (const entry of reaction.new_reaction) {
        if (entry.type !== 'emoji') continue;
        this.service.recordReaction(ctx.botId, entry.emoji);
        this.helpers.addPoints(ctx.botId, userId, pointsPerReaction);
      }
    });
  }
}
