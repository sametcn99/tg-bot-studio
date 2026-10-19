import { Injectable, Logger } from '@nestjs/common';
import type { Message } from 'grammy/types';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { ChatSettingsService } from '../../bot-engine/chat-settings.service';
import { MessageScoreService } from './message-score.service';

/** Service-message keys that never count as member activity. */
const SERVICE_KEYS: ReadonlyArray<keyof Message> = [
  'new_chat_members',
  'left_chat_member',
  'new_chat_title',
  'new_chat_photo',
  'delete_chat_photo',
  'group_chat_created',
  'supergroup_chat_created',
  'channel_chat_created',
  'migrate_to_chat_id',
  'pinned_message',
];

/** Media keys counted with the media weight. */
const MEDIA_KEYS: ReadonlyArray<keyof Message> = [
  'photo',
  'video',
  'animation',
  'sticker',
  'voice',
  'video_note',
  'audio',
  'document',
];

/**
 * Runtime for the Message Score & Activity Leaderboard module. Counts every
 * non-service member message in groups and supergroups into per-day activity
 * buckets (messages, replies to other members, media).
 *
 * Note: Telegram's bot privacy mode hides regular member messages in groups
 * unless the bot is an administrator or privacy mode is disabled via
 * BotFather; document this in the module setup guide.
 */
@Injectable()
export class MessageScoreRuntime extends BotModuleHandler {
  private readonly logger = new Logger(MessageScoreRuntime.name);
  /** Registry key of the module. */
  readonly moduleKey = 'message-score';

  /**
   * @param {MessageScoreService} service - Score service.
   * @param {ChatSettingsService} chatSettings - Per-chat config layer.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly service: MessageScoreService,
    private readonly chatSettings: ChatSettingsService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches activity-tracking middleware to the bot.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    ctx.bot.on('message', async (update, next) => {
      try {
        const chat = update.chat;
        if (chat.type !== 'group' && chat.type !== 'supergroup') return;
        const from = update.msg.from;
        if (!from || from.is_bot) return;
        // Explicit-target gate: only configured chats accumulate activity.
        if (!(await this.chatSettings.isTargeted(ctx.botId, chat.id, this.moduleKey))) return;
        const msg = update.msg;
        if (SERVICE_KEYS.some((key) => msg[key] !== undefined)) return;

        const replyTarget = msg.reply_to_message?.from;
        const isReplyToOther = Boolean(
          msg.reply_to_message && (!replyTarget || replyTarget.id !== from.id),
        );
        const isMedia = MEDIA_KEYS.some((key) => msg[key] !== undefined);
        this.service.recordActivity(ctx.botId, chat.id, from.id, {
          reply: isReplyToOther,
          media: isMedia,
        });
      } catch (err) {
        this.logger.warn(
          `Message-score recording error for bot ${ctx.botId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        await next();
      }
    });
  }
}
