import { Injectable } from '@nestjs/common';
import type { Bot } from 'grammy';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { EngineHelpersService } from '../../bot-engine/engine-helpers.service';
import { DatabaseService } from '../../database/database.service';

/**
 * Runtime for the Forum Topics Support Desk (Livegram pattern). Every user
 * gets a dedicated forum topic inside the admin supergroup; user messages
 * are copied into the topic and admin replies are copied back. Quick
 * commands `/ban`, `/unban`, `/info` operate on the topic's user, and a
 * throttled auto-reply confirms receipt to the user.
 */
@Injectable()
export class SupportRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'support';

  /**
   * @param {EngineHelpersService} helpers - Shared audience operations.
   * @param {DatabaseService} db - SQLite access service.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly helpers: EngineHelpersService,
    private readonly db: DatabaseService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches the two-way support relay middleware to the bot.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot } = ctx;
    const adminChatId = Number(ctx.config.adminChatId ?? 0);
    if (!adminChatId) return;
    const welcomeText = String(
      ctx.config.welcomeText ?? 'Your message has been delivered to our support team.',
    );
    const throttleMinutes = Number(ctx.config.autoReplyThrottleMinutes ?? 60);

    // ----- User -> Admin relay -------------------------------------------------
    bot.on('message', async (update) => {
      if (update.chat?.type !== 'private') return;
      if ((update.msg as { business_connection_id?: string }).business_connection_id) return;
      if (update.msg.text?.startsWith('/')) return;
      if (!update.from) return;

      const telegramId = update.from.id;
      const topicId = await this.ensureTopic(
        bot,
        ctx.botId,
        adminChatId,
        telegramId,
        update.from.first_name,
        update.from.username ?? null,
      );

      await update
        .copyMessage(adminChatId, { message_thread_id: topicId })
        .catch(() =>
          bot.api.sendMessage(adminChatId, `#${telegramId} ${update.msg.text ?? '[media]'}`, {
            message_thread_id: topicId,
          }),
        );

      this.db.run(
        `INSERT INTO support_messages (bot_id, telegram_id, user_message_id, admin_chat_id, forum_topic_id, direction, sender_name, message_text, media_type, created_at)
         VALUES (?, ?, ?, ?, ?, 'in', ?, ?, ?, ?)`,
        ctx.botId,
        telegramId,
        update.msg.message_id,
        adminChatId,
        topicId,
        `${update.from.first_name} ${update.from.last_name ?? ''}`.trim(),
        update.msg.text ?? update.msg.caption ?? null,
        update.msg.photo
          ? 'photo'
          : update.msg.video
            ? 'video'
            : update.msg.voice
              ? 'voice'
              : update.msg.document
                ? 'document'
                : 'text',
        new Date().toISOString(),
      );

      // Throttled receipt auto-reply.
      const lastKey = `support_last_auto_${telegramId}`;
      const last = this.db.get<{ value: string }>(
        'SELECT value FROM bot_settings WHERE bot_id = ? AND key = ?',
        ctx.botId,
        lastKey,
      );
      const expired =
        !last || Date.now() - new Date(last.value).getTime() > throttleMinutes * 60_000;
      if (expired) {
        await bot.api.sendMessage(telegramId, welcomeText).catch(() => undefined);
        this.db.run(
          `INSERT INTO bot_settings (bot_id, key, value) VALUES (?, ?, ?)
           ON CONFLICT(bot_id, key) DO UPDATE SET value = excluded.value`,
          ctx.botId,
          lastKey,
          new Date().toISOString(),
        );
      }
    });

    // ----- Admin -> User relay -------------------------------------------------
    bot.on('message', async (update) => {
      if (update.chat?.id !== adminChatId) return;
      if (!update.msg.is_topic_message) return;
      if (!update.from || update.from.id === bot.botInfo?.id) return;

      const threadId = update.msg.message_thread_id;
      if (!threadId) return;
      const mapping = this.db.get<{ value: string }>(
        'SELECT value FROM bot_settings WHERE bot_id = ? AND key = ?',
        ctx.botId,
        `support_topic_user_${threadId}`,
      );
      if (!mapping) return;
      const telegramId = Number(mapping.value);

      const commandText = update.msg.text?.trim() ?? '';
      if (commandText.startsWith('/ban')) {
        this.helpers.blockUser(ctx.botId, update.from, `Support ban by admin ${update.from.id}`);
        await update.reply('User banned from contacting the bot.');
        return;
      }
      if (commandText.startsWith('/unban')) {
        this.helpers.unblockUser(ctx.botId, telegramId);
        await update.reply('User ban lifted.');
        return;
      }
      if (commandText.startsWith('/info')) {
        const user = this.helpers.getUser(ctx.botId, telegramId);
        await update.reply(
          user
            ? `Id: ${user.telegram_id}\nName: ${user.first_name ?? '-'}\nUsername: ${user.username ?? '-'}\nLanguage: ${user.language_code ?? '-'}\nPoints: ${user.points}\nFirst seen: ${user.first_seen_at ?? '-'}`
            : 'No profile recorded.',
        );
        return;
      }
      if (commandText.startsWith('/')) return;

      await update
        .copyMessage(telegramId)
        .catch(() => bot.api.sendMessage(telegramId, update.msg.text ?? '[media]'));

      this.db.run(
        `INSERT INTO support_messages (bot_id, telegram_id, user_message_id, admin_chat_id, forum_topic_id, direction, sender_name, message_text, media_type, created_at)
         VALUES (?, ?, ?, ?, ?, 'out', ?, ?, ?, ?)`,
        ctx.botId,
        telegramId,
        update.msg.message_id,
        adminChatId,
        threadId,
        update.from.first_name,
        update.msg.text ?? update.msg.caption ?? null,
        'text',
        new Date().toISOString(),
      );
    });
  }

  /**
   * Resolves (or creates) the per-user forum topic in the admin supergroup.
   * @param {Bot} bot - Live grammY instance of the bot.
   * @param {number} botId - Owning bot id.
   * @param {number} adminChatId - Admin supergroup id.
   * @param {number} telegramId - User Telegram id.
   * @param {string} firstName - User first name for the topic title.
   * @param {string | null} username - User @username for the topic title.
   * @returns {Promise<number>} Forum topic (thread) id.
   */
  private async ensureTopic(
    bot: Bot,
    botId: number,
    adminChatId: number,
    telegramId: number,
    firstName: string,
    username: string | null,
  ): Promise<number> {
    const key = `support_topic_${telegramId}`;
    const existing = this.db.get<{ value: string }>(
      'SELECT value FROM bot_settings WHERE bot_id = ? AND key = ?',
      botId,
      key,
    );
    if (existing) return Number(existing.value);

    const title = username ? `@${username} (${telegramId})` : `${firstName} (${telegramId})`;
    const topic = await bot.api.createForumTopic(adminChatId, title.slice(0, 120));
    this.db.run(
      `INSERT INTO bot_settings (bot_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(bot_id, key) DO UPDATE SET value = excluded.value`,
      botId,
      key,
      String(topic.message_thread_id),
    );
    this.db.run(
      `INSERT INTO bot_settings (bot_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(bot_id, key) DO UPDATE SET value = excluded.value`,
      botId,
      `support_topic_user_${topic.message_thread_id}`,
      String(telegramId),
    );
    return topic.message_thread_id;
  }
}
