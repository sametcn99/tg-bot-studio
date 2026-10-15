import { Injectable } from '@nestjs/common';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { ChatSettingsService } from '../../bot-engine/chat-settings.service';

/** Commands this bot classifies as admin-level for cleancommand. */
const ADMIN_COMMANDS = new Set([
  'ban',
  'tban',
  'dban',
  'sban',
  'unban',
  'mute',
  'tmute',
  'dmute',
  'smute',
  'unmute',
  'kick',
  'dkick',
  'skick',
  'warn',
  'dwarn',
  'swarn',
  'rmwarn',
  'resetwarn',
  'setwarnlimit',
  'setwarnmode',
  'warntime',
  'del',
  'purge',
  'spurge',
  'purgefrom',
  'purgeto',
  'pin',
  'permapin',
  'unpin',
  'unpinall',
  'approve',
  'unapprove',
  'approved',
  'unapproveall',
  'approval',
  'setwelcome',
  'resetwelcome',
  'setgoodbye',
  'resetgoodbye',
  'setrules',
  'resetrules',
  'setflood',
  'setfloodtimer',
  'setfloodmode',
  'lock',
  'unlock',
  'antiraid',
  'addblocklist',
  'rmblocklist',
  'rmblocklistall',
  'blocklistmode',
  'disable',
  'enable',
  'silentactions',
  'promote',
  'demote',
  'echo',
  'say',
  'setlang',
  'newfed',
  'joinfed',
  'leavefed',
  'fban',
  'unfban',
  'fedpromote',
  'feddemote',
]);

/** Commands this bot classifies as user-level for cleancommand. */
const USER_COMMANDS = new Set([
  'start',
  'menu',
  'rules',
  'notes',
  'filters',
  'id',
  'info',
  'adminlist',
  'warns',
  'kickme',
  'report',
  'locks',
  'locktypes',
  'blocklist',
  'flood',
  'approved',
  'fedstat',
  'fbanstat',
  'fedinfo',
  'fedadmins',
  'quiz',
  'scoreboard',
  'giveaway',
  'top',
]);

/** Delay before used commands and bot messages are removed. */
const CLEAN_DELAY_MS = 1_500;
const BOT_MESSAGE_TTL_MS = 5 * 60_000;

/**
 * Runtime for the Message Cleaning module: deletes used command messages
 * (by class), Telegram service messages (join/leave/pin/title/photo/...),
 * and — via an API transformer — the bot's own group messages after five
 * minutes (cleanmsg).
 */
@Injectable()
export class CleaningRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'cleaning';

  /**
   * @param {ChatSettingsService} chatSettings - Per-chat config layer.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly chatSettings: ChatSettingsService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches cleaning middleware and the outgoing-message tracker.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot, botId } = ctx;

    // Used command cleanup (delayed so commands still get processed).
    bot.on('message:text', async (update) => {
      if (update.chat?.type !== 'supergroup' && update.chat?.type !== 'group') return;
      const text = update.msg.text;
      if (!text.startsWith('/')) return;

      const config = await this.chatSettings.getEffectiveConfig(
        botId,
        update.chat.id,
        this.moduleKey,
      );
      const setting = String(config.cleanCommand ?? 'off');
      if (setting === 'off') return;

      const command = text.slice(1).split(/[\s@]/)[0].toLowerCase();
      const kind = ADMIN_COMMANDS.has(command)
        ? 'admin'
        : USER_COMMANDS.has(command)
          ? 'user'
          : 'other';
      const wanted =
        setting === 'all' ||
        (setting === 'admin' && kind === 'admin') ||
        (setting === 'user' && kind === 'user') ||
        (setting === 'other' && kind === 'other');
      if (!wanted) return;

      const chatId = update.chat.id;
      const messageId = update.msg.message_id;
      setTimeout(() => {
        void bot.api.deleteMessage(chatId, messageId).catch(() => undefined);
      }, CLEAN_DELAY_MS);
    });

    // Service message cleanup by type.
    bot.on('message', async (update) => {
      if (update.chat?.type !== 'supergroup' && update.chat?.type !== 'group') return;
      const msg = update.msg;
      const type = this.serviceType(msg);
      if (!type) return;

      const config = await this.chatSettings.getEffectiveConfig(
        botId,
        update.chat.id,
        this.moduleKey,
      );
      const types = Array.isArray(config.cleanServiceTypes)
        ? (config.cleanServiceTypes as string[])
        : [];
      if (types.length === 0) return;
      if (types.includes('all') || types.includes(type)) {
        await update.deleteMessage().catch(() => undefined);
      }
    });

    // cleanmsg: track outgoing group messages and delete them after 5 min.
    bot.api.config.use((prev, method, payload) => {
      if (method !== 'sendMessage' && method !== 'sendPhoto' && method !== 'sendVideo') {
        return prev(method, payload);
      }
      const chatId = Number((payload as { chat_id?: unknown }).chat_id ?? 0);
      if (chatId >= 0) return prev(method, payload); // private chats stay
      return prev(method, payload).then(async (response) => {
        if (!response.ok) return response;
        const messageId = (response.result as { message_id?: number }).message_id;
        if (!messageId) return response;
        const config = await this.chatSettings
          .getEffectiveConfig(botId, chatId, this.moduleKey)
          .catch(() => null);
        if (config && config.cleanBotMessages === true) {
          setTimeout(() => {
            void bot.api.deleteMessage(chatId, messageId).catch(() => undefined);
          }, BOT_MESSAGE_TTL_MS);
        }
        return response;
      });
    });
  }

  /**
   * Maps a message to its service type (null when not a service message).
   *
   * @param {import('grammy/types').Message} msg - Telegram message.
   * @returns {string | null} Service type key.
   */
  private serviceType(msg: import('grammy/types').Message): string | null {
    if (msg.new_chat_members) return 'join';
    if (msg.left_chat_member) return 'leave';
    if (msg.pinned_message) return 'pin';
    if (msg.new_chat_title) return 'title';
    if (msg.new_chat_photo || msg.delete_chat_photo) return 'photo';
    if (
      msg.video_chat_started ||
      msg.video_chat_ended ||
      msg.video_chat_participants_invited ||
      msg.video_chat_scheduled
    ) {
      return 'videochat';
    }
    if (
      msg.group_chat_created ||
      msg.supergroup_chat_created ||
      msg.channel_chat_created ||
      msg.message_auto_delete_timer_changed ||
      msg.proximity_alert_triggered ||
      msg.web_app_data
    ) {
      return 'other';
    }
    return null;
  }
}
