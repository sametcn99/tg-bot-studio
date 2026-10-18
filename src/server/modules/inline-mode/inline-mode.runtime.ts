import { Injectable, Logger } from '@nestjs/common';
import type { InlineQuery, InlineQueryResultArticle } from 'grammy/types';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { PrismaService } from '../../database/prisma.service';
import { AiAssistantService, type AiConfig } from '../ai-assistant/ai-assistant.service';

/** One operator-configured inline quick answer. */
export interface InlineSuggestion {
  title: string;
  description?: string;
  /** Message content injected into the chat when the result is picked. */
  content: string;
}

/** Parsed inline-mode module config. */
interface InlineModeConfig {
  suggestions: InlineSuggestion[];
  enableAi: boolean;
  cacheSeconds: number;
}

/**
 * Inline mode runtime: answers inline queries (`@bot query` in any chat) with
 * operator-configured quick answers and — optionally — a live AI-generated
 * answer sourced from the bot's AI assistant configuration.
 *
 * Requires inline mode to be enabled for the bot via @BotFather (/setinline).
 */
@Injectable()
export class InlineModeRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'inline-mode';

  private readonly logger = new Logger(InlineModeRuntime.name);

  /**
   * @param {PrismaService} prisma - Prisma ORM access service.
   * @param {AiAssistantService} aiService - AI gateway for AI-backed answers.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiAssistantService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches inline query middleware.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot, botId, config } = ctx;

    bot.on('inline_query', async (update) => {
      const query = update.inlineQuery;
      if (!query) return;
      const parsed = this.parseConfig(config);
      const results: InlineQueryResultArticle[] = [];
      const needle = query.query.trim().toLowerCase();

      // 1. Operator-configured quick answers (filtered by prefix match).
      for (const suggestion of parsed.suggestions) {
        if (needle && !suggestion.title.toLowerCase().includes(needle)) continue;
        results.push(this.buildArticle(`sugg:${results.length}`, suggestion));
        if (results.length >= 20) break;
      }

      // 2. Optional AI-generated answer for non-trivial queries.
      if (parsed.enableAi && query.query.trim().length >= 3) {
        const aiAnswer = await this.answerWithAi(botId, query, 8_000);
        if (aiAnswer) {
          results.unshift(this.buildArticle('ai:1', aiAnswer));
        }
      }

      if (results.length === 0 && needle) {
        // Telegram requires at least one result or switch strings; nudge the
        // operator setup instead of failing the answer call.
        await update.answerInlineQuery([], {
          cache_time: 1,
          button: { text: 'No matching saved answer', start_parameter: 'inline-help' },
        });
        return;
      }

      await update.answerInlineQuery(results, {
        cache_time: Math.max(1, Math.min(300, parsed.cacheSeconds)),
        is_personal: true,
      });
    });
  }

  /**
   * Builds an inline article result from a suggestion.
   * @param {string} id - Stable result id.
   * @param {InlineSuggestion} suggestion - Suggestion payload.
   * @returns {InlineQueryResultArticle} Article result object.
   */
  private buildArticle(id: string, suggestion: InlineSuggestion): InlineQueryResultArticle {
    return {
      type: 'article',
      id,
      title: suggestion.title.slice(0, 256),
      description: (suggestion.description ?? suggestion.content).slice(0, 200),
      input_message_content: {
        message_text: suggestion.content.slice(0, 4_096),
        parse_mode: 'HTML',
      },
    };
  }

  /**
   * Produces an AI answer for the query using the bot's AI assistant config.
   * @param {number} botId - Owning bot id.
   * @param {InlineQuery} query - Incoming inline query.
   * @param {number} timeoutMs - Hard latency budget.
   * @returns {Promise<InlineSuggestion | null>} AI suggestion, or null on
   *   misconfiguration/timeout/error.
   */
  private async answerWithAi(
    botId: string,
    query: InlineQuery,
    timeoutMs: number,
  ): Promise<InlineSuggestion | null> {
    const moduleRow = await this.prisma.botModule.findFirst({
      where: { botId, moduleKey: 'ai-assistant', isEnabled: 1 },
    });
    if (!moduleRow?.configJson) return null;
    let aiConfig: AiConfig;
    try {
      aiConfig = JSON.parse(moduleRow.configJson) as AiConfig;
    } catch {
      return null;
    }
    if (!this.aiService.isConfigured(aiConfig)) return null;

    try {
      const answer = await Promise.race([
        this.aiService.complete(aiConfig, [
          {
            role: 'system',
            content:
              'You answer Telegram inline queries. Reply with the single most useful answer in at most 280 characters, plain text, no markdown, no preamble.',
          },
          { role: 'user', content: query.query },
        ]),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      if (!answer || answer.startsWith('The AI assistant is not configured')) return null;
      return {
        title: '✨ AI answer',
        description: answer.slice(0, 200),
        content: answer.slice(0, 4_096),
      };
    } catch (error) {
      this.logger.warn(
        `Inline AI answer failed on bot ${botId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Normalizes and validates the module config.
   * @param {Record<string, unknown>} config - Raw effective config.
   * @returns {InlineModeConfig} Parsed config.
   */
  private parseConfig(config: Record<string, unknown>): InlineModeConfig {
    const rawSuggestions = Array.isArray(config.suggestions) ? config.suggestions : [];
    const suggestions = rawSuggestions
      .map((entry) => {
        const item = entry as Record<string, unknown>;
        return {
          title: String(item.title ?? '').trim(),
          description: item.description ? String(item.description) : undefined,
          content: String(item.content ?? '').trim(),
        };
      })
      .filter((item) => item.title.length > 0 && item.content.length > 0);
    return {
      suggestions,
      enableAi: config.enableAi === true,
      cacheSeconds: Number(config.cacheSeconds ?? 30) || 30,
    };
  }
}
