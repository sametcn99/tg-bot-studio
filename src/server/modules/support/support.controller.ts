import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { BotPoolService } from '../../bot-engine/bot-pool.service';
import { AiAssistantService, type AiConfig, type ChatMessage } from '../ai-assistant/ai-assistant.service';

/**
 * Support desk inbox and reply endpoints for the dashboard.
 */
@Controller('bots/:botId/support')
export class SupportController {
  /**
   * @param {DatabaseService} db - SQLite access service.
   * @param {BotPoolService} pool - Bot runtime pool for sending messages.
   * @param {AiAssistantService} ai - AI service for Copilot draft generation.
   */
  constructor(
    private readonly db: DatabaseService,
    private readonly pool: BotPoolService,
    private readonly ai: AiAssistantService,
  ) {}

  /**
   * Lists recent support messages (both directions).
   * @param {number} botId - Owning bot id.
   * @param {number} [limit=500] - Maximum rows returned.
   * @returns {object[]} Newest first message rows.
   */
  @Get('messages')
  messages(
    @Param('botId', ParseIntPipe) botId: number,
    @Query('limit') limit?: string,
  ) {
    const max = Math.min(2000, Math.max(1, Number(limit ?? 500)));
    return this.db.query(
      'SELECT * FROM support_messages WHERE bot_id = ? ORDER BY id DESC LIMIT ?',
      botId,
      max,
    );
  }

  /**
   * Lists conversation threads (one row per user with last activity).
   * @param {number} botId - Owning bot id.
   * @returns {object[]} Threads with latest message preview.
   */
  @Get('threads')
  threads(@Param('botId', ParseIntPipe) botId: number) {
    return this.db.query(
      `SELECT telegram_id,
              MAX(sender_name) as sender_name,
              COUNT(*) as message_count,
              MAX(created_at) as last_activity,
              (SELECT message_text FROM support_messages sm2
                WHERE sm2.bot_id = sm.bot_id AND sm2.telegram_id = sm.telegram_id
                  AND sm2.id = MAX(sm.id)) as last_message
       FROM support_messages sm
       WHERE bot_id = ?
       GROUP BY telegram_id
       ORDER BY last_activity DESC`,
      botId,
    );
  }

  /**
   * Sends an admin reply to a user directly from the web dashboard.
   * @param {number} botId - Owning bot id.
   * @param {object} body - Payload with telegramId and text.
   * @returns {Promise<object>} Result and message ID.
   */
  @Post('reply')
  async reply(
    @Param('botId', ParseIntPipe) botId: number,
    @Body() body: { telegramId: number; text: string },
  ) {
    const bot = this.pool.getBot(botId);
    if (!bot) {
      throw new NotFoundException('Bot is not running. Please start the bot first.');
    }
    const text = String(body.text ?? '').trim();
    if (!text) {
      throw new NotFoundException('Reply text cannot be empty');
    }

    // 1. Send via Telegram Bot API directly to the user
    const sent = await bot.api.sendMessage(body.telegramId, text);

    // 2. Lookup existing forum topic to relay back to the admin group if configured
    const topic = this.db.get<{ admin_chat_id: number; forum_topic_id: number }>(
      `SELECT admin_chat_id, forum_topic_id
       FROM support_messages
       WHERE bot_id = ? AND telegram_id = ? AND forum_topic_id IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
      botId,
      body.telegramId,
    );

    if (topic?.admin_chat_id && topic?.forum_topic_id) {
      await bot.api
        .sendMessage(topic.admin_chat_id, `[Web Admin]: ${text}`, {
          message_thread_id: topic.forum_topic_id,
        })
        .catch(() => undefined);
    }

    // 3. Record in support_messages table with direction = 'out'
    this.db.run(
      `INSERT INTO support_messages (bot_id, telegram_id, user_message_id, admin_chat_id, forum_topic_id, direction, sender_name, message_text, media_type, created_at)
       VALUES (?, ?, ?, ?, ?, 'out', 'Admin (Web)', ?, 'text', ?)`,
      botId,
      body.telegramId,
      sent.message_id,
      topic?.admin_chat_id ?? null,
      topic?.forum_topic_id ?? null,
      text,
      new Date().toISOString(),
    );

    return { success: true, messageId: sent.message_id };
  }

  /**
   * Uses AI Copilot to generate a suggested support reply draft based on thread history.
   * @param {number} botId - Owning bot id.
   * @param {object} body - Payload with telegramId.
   * @returns {Promise<{ draft: string }>} Suggested draft reply.
   */
  @Post('copilot/draft')
  async copilotDraft(
    @Param('botId', ParseIntPipe) botId: number,
    @Body() body: { telegramId: number },
  ) {
    const historyRows = this.db.query<{ direction: string; message_text: string }>(
      `SELECT direction, message_text
       FROM support_messages
       WHERE bot_id = ? AND telegram_id = ? AND message_text IS NOT NULL
       ORDER BY id ASC
       LIMIT 10`,
      botId,
      body.telegramId,
    );

    if (historyRows.length === 0) {
      return { draft: 'Hello! How can I assist you today?' };
    }

    // Check if AI module is configured
    const aiModuleRow = this.db.get<{ is_enabled: number; config_json: string | null }>(
      "SELECT is_enabled, config_json FROM bot_modules WHERE bot_id = ? AND module_key = 'ai-assistant'",
      botId,
    );
    const aiConfig = aiModuleRow?.config_json
      ? (JSON.parse(aiModuleRow.config_json) as AiConfig)
      : null;

    if (aiConfig?.apiKey) {
      const messages: ChatMessage[] = historyRows.map((row) => ({
        role: row.direction === 'out' ? 'assistant' : 'user',
        content: row.message_text,
      }));
      const promptConfig: AiConfig = {
        ...aiConfig,
        systemPrompt:
          'You are an expert customer support agent. Generate a concise, friendly, and professional resolution reply for the user based on the chat history. Provide only the reply message.',
        maxTokens: 250,
      };
      try {
        const reply = await this.ai.complete(promptConfig, messages);
        return { draft: reply.trim() };
      } catch {
        // Fallback on provider error
      }
    }

    // Fallback contextual template when AI assistant key is not set
    const lastUserMsg = [...historyRows].reverse().find((r) => r.direction === 'in')?.message_text ?? '';
    const fallbackDraft = `Hello! Thank you for reaching out regarding "${lastUserMsg.slice(0, 40)}...". We are looking into this for you right away.`;
    return { draft: fallbackDraft };
  }
}
