import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { BotPoolService } from '../../bot-engine/bot-pool.service';
import {
  AiAssistantService,
  type AiConfig,
  type ChatMessage,
} from '../ai-assistant/ai-assistant.service';
import { SupportModel } from '../../models/support.model';
import { BotModel } from '../../models/bot.model';
import { SystemSettingsService } from '../../database/system-settings.service';
import { LiveEventsService } from '../../common/live/live-events.service';
import { StudioException } from '../../common/errors/studio-error';

/**
 * Support desk inbox and reply endpoints for the dashboard.
 */
@Controller('bots/:botId/support')
export class SupportController {
  constructor(
    private readonly supportModel: SupportModel,
    private readonly botModel: BotModel,
    private readonly pool: BotPoolService,
    private readonly ai: AiAssistantService,
    private readonly settings: SystemSettingsService,
    private readonly live: LiveEventsService,
  ) {}

  /**
   * Server-Sent Events stream pinging whenever support data changes, so the
   * inbox refetches instantly instead of polling on a fixed timer.
   */
  @Sse('stream')
  stream(@Param('botId', ParseIntPipe) botId: number): import('rxjs').Observable<MessageEvent> {
    return this.live.stream('support', botId);
  }

  /**
   * Lists open AI→Human escalations (users the AI classifier routed to a
   * human operator) with the latest message preview per user.
   */
  @Get('escalations')
  async escalations(@Param('botId', ParseIntPipe) botId: number) {
    const open = this.settings
      .listBotSettingsByPrefix(botId, 'escalation_')
      .map(({ key, value }) => ({
        telegramId: Number(key.slice('escalation_'.length)),
        escalatedAt: value,
      }))
      .filter((row) => Number.isFinite(row.telegramId) && row.telegramId !== 0)
      .sort((a, b) => b.escalatedAt.localeCompare(a.escalatedAt));
    const previews = await this.supportModel.listMessages(botId, 300);
    return open.map((row) => {
      const latest = [...previews]
        .reverse()
        .find((message) => message.telegram_id === row.telegramId && message.direction === 'in');
      return {
        ...row,
        senderName: latest?.sender_name ?? null,
        lastMessage: latest?.message_text ?? null,
      };
    });
  }

  /**
   * Marks an AI→Human escalation as resolved (removes it from the queue).
   */
  @Post('escalations/:telegramId/resolve')
  async resolveEscalation(
    @Param('botId', ParseIntPipe) botId: number,
    @Param('telegramId', ParseIntPipe) telegramId: number,
  ) {
    this.settings.deleteBotSetting(botId, `escalation_${telegramId}`);
    return { success: true };
  }

  /**
   * Lists recent support messages (both directions).
   */
  @Get('messages')
  async messages(@Param('botId', ParseIntPipe) botId: number, @Query('limit') limit?: string) {
    const max = Math.min(2000, Math.max(1, Number(limit ?? 500)));
    return this.supportModel.listMessages(botId, max);
  }

  /**
   * Lists conversation threads (one row per user with last activity).
   */
  @Get('threads')
  async threads(@Param('botId', ParseIntPipe) botId: number) {
    return this.supportModel.listThreads(botId);
  }

  /**
   * Sends an admin reply to a user directly from the web dashboard.
   */
  @Post('reply')
  async reply(
    @Param('botId', ParseIntPipe) botId: number,
    @Body() body: { telegramId: number; text: string },
  ) {
    const bot = this.pool.getBot(botId);
    if (!bot) {
      throw new StudioException(
        'BOT_NOT_RUNNING',
        'Bot is not running. Please start the bot first.',
        404,
      );
    }
    const text = String(body.text ?? '').trim();
    if (!text) {
      throw new StudioException('REPLY_EMPTY', 'Reply text cannot be empty', 404);
    }

    // 1. Send via Telegram Bot API directly to the user
    const sent = await bot.api.sendMessage(body.telegramId, text);

    // 2. Lookup existing forum topic to relay back to the admin group if configured
    const topic = await this.supportModel.findLatestTopicForUser(botId, body.telegramId);

    if (topic?.admin_chat_id && topic?.forum_topic_id) {
      await bot.api
        .sendMessage(topic.admin_chat_id, `[Web Admin]: ${text}`, {
          message_thread_id: topic.forum_topic_id,
        })
        .catch(() => undefined);
    }

    // 3. Record in support_messages table with direction = 'out'
    await this.supportModel.createMessage({
      botId,
      telegramId: body.telegramId,
      userMessageId: sent.message_id,
      adminChatId: topic?.admin_chat_id ?? null,
      forumTopicId: topic?.forum_topic_id ?? null,
      direction: 'out',
      senderName: 'Admin (Web)',
      messageText: text,
      mediaType: 'text',
    });

    return { success: true, messageId: sent.message_id };
  }

  /**
   * Uses AI Copilot to generate a suggested support reply draft based on thread history.
   */
  @Post('copilot/draft')
  async copilotDraft(
    @Param('botId', ParseIntPipe) botId: number,
    @Body() body: { telegramId: number },
  ) {
    const historyRows = await this.supportModel.getThreadHistory(botId, body.telegramId, 10);

    if (historyRows.length === 0) {
      return { draft: 'Hello! How can I assist you today?' };
    }

    // Check if AI module is configured
    const aiModuleRow = await this.botModel.getModule(botId, 'ai-assistant');
    const aiConfig = aiModuleRow?.configJson
      ? (JSON.parse(aiModuleRow.configJson) as AiConfig)
      : null;

    if (aiConfig && this.ai.isConfigured(aiConfig)) {
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
    const lastUserMsg =
      [...historyRows].reverse().find((r) => r.direction === 'in')?.message_text ?? '';
    const fallbackDraft = `Hello! Thank you for reaching out regarding "${lastUserMsg.slice(0, 40)}...". We are looking into this for you right away.`;
    return { draft: fallbackDraft };
  }
}
