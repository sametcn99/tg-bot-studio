import { Injectable, Logger } from '@nestjs/common';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { AiAssistantService, type AiConfig } from './ai-assistant.service';
import { AiModel } from './ai.model';
import { BotModel } from '../../bots/bot.model';
import { AutoresponderModel } from '../autoresponder/autoresponder.model';
import { SupportModel } from '../support/support.model';
import { SystemSettingsService } from '../../database/system-settings.service';
import { escapeHtml } from '../../common/utils/telegram-text.util';

/**
 * Runtime for the AI Knowledge Assistant module.
 * Answers private text and voice messages around the clock using RAG knowledge,
 * persistent history, and intelligent human handoff triage.
 */
@Injectable()
export class AiAssistantRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'ai-assistant';

  private readonly logger = new Logger(AiAssistantRuntime.name);

  constructor(
    private readonly service: AiAssistantService,
    private readonly aiModel: AiModel,
    private readonly botModel: BotModel,
    private readonly autoresponderModel: AutoresponderModel,
    private readonly supportModel: SupportModel,
    private readonly settings: SystemSettingsService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches text and voice AI handlers to the bot.
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot } = ctx;
    const config = ctx.config as unknown as AiConfig;

    // ----- Text Messages Handler ---------------------------------------------
    bot.on('message:text', async (update) => {
      if (update.chat?.type !== 'private') return;
      if (update.msg.text.startsWith('/')) return;
      if (!update.from) return;

      // The support desk owns private conversations when active.
      if (await this.moduleEnabled(ctx.botId, 'support')) return;
      // Autoresponder keyword rules take precedence.
      if (await this.matchedAutoresponder(ctx.botId, update.msg.text)) return;

      await this.handleUserTurn(ctx, update, update.msg.text);
    });

    // ----- Multimodal Voice/Audio Messages Handler ---------------------------
    bot.on(['message:voice', 'message:audio'], async (update) => {
      if (update.chat?.type !== 'private') return;
      if (!update.from) return;
      if (await this.moduleEnabled(ctx.botId, 'support')) return;

      try {
        const file = await update.getFile();
        if (!file.file_path || !this.service.isConfigured(config)) return;

        const token = bot.token;
        const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        const res = await fetch(fileUrl);
        if (!res.ok) return;

        const arrayBuf = await res.arrayBuffer();
        const transcribed = await this.service.transcribeAudio(
          config,
          Buffer.from(arrayBuf),
          'voice.oga',
        );

        if (transcribed && transcribed.trim()) {
          // Log metadata only — the transcript is user speech (PII) and must
          // not land in server logs.
          this.logger.log(
            `Transcribed voice from user ${update.from.id} (${transcribed.trim().length} chars)`,
          );
          await this.handleUserTurn(ctx, update, transcribed.trim());
        }
      } catch (err) {
        this.logger.warn(
          `Voice processing error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }

  /** Cheap keyword fallback for handoff detection (TR + EN). */
  private static readonly HANDOFF_KEYWORDS = [
    'yetkili',
    'temsilci',
    'canlı destek',
    'insan',
    'human',
    'agent',
    'operator',
    'speak to a person',
    'real person',
  ];

  /**
   * Current consecutive-frustration counter for a user.
   * @param {ModuleRuntimeContext} ctx - Runtime context.
   * @param {number} telegramId - User id.
   * @returns {number} Streak length.
   */
  private angerStreak(ctx: ModuleRuntimeContext, telegramId: number): number {
    return Number(this.settings.getBotSetting(ctx.botId, `handoff_anger_${telegramId}`) ?? '0');
  }

  /**
   * Classifies whether the user wants a human agent or is frustrated with the
   * bot. Uses a cheap LLM classification when the module is configured and
   * `smartHandoff` is not disabled; falls back to the keyword list on any
   * failure. Repeated frustration escalates after the second angry turn.
   * @param {ModuleRuntimeContext} ctx - Runtime context.
   * @param {AiConfig} config - Effective AI module config.
   * @param {string} text - User message.
   * @returns {Promise<'human' | 'angry' | 'no'>} Classification result.
   */
  private async classifyHandoffIntent(
    ctx: ModuleRuntimeContext,
    config: AiConfig,
    text: string,
  ): Promise<'human' | 'angry' | 'no'> {
    const lower = text.toLowerCase();
    const keywordHit = AiAssistantRuntime.HANDOFF_KEYWORDS.some((word) => lower.includes(word));
    if (config.smartHandoff === false || !this.service.isConfigured(config)) {
      return keywordHit ? 'human' : 'no';
    }
    try {
      const raw = await this.service.complete(
        {
          ...config,
          systemPrompt:
            'You are a strict intent classifier for a Telegram support bot. Reply with exactly one word: "human" if the user explicitly asks to talk to a human agent/operator, "angry" if the user expresses frustration with or distrust of the bot (but does not ask for a human), otherwise "no". No punctuation, no explanation.',
          maxTokens: 8,
        },
        [{ role: 'user', content: text }],
      );
      const verdict = raw.trim().toLowerCase();
      if (verdict.startsWith('human')) return 'human';
      if (verdict.startsWith('angry')) return 'angry';
      if (verdict.startsWith('no')) return 'no';
      return keywordHit ? 'human' : 'no';
    } catch {
      return keywordHit ? 'human' : 'no';
    }
  }

  /**
   * Processes a user turn: checks smart human handoff, loads persistent history,
   * queries RAG context, and replies.
   */
  private async handleUserTurn(
    ctx: ModuleRuntimeContext,
    update: { from?: { id: number }; reply: (text: string) => Promise<unknown> },
    text: string,
  ): Promise<void> {
    if (!update.from) return;
    const telegramId = update.from.id;
    const config = ctx.config as unknown as AiConfig;

    // 1. Smart Human-in-the-Loop Handoff Check (LLM classifier with keyword
    //    fallback; repeated frustration escalates too).
    const classification = await this.classifyHandoffIntent(ctx, config, text);
    const angerStreakKey = `handoff_anger_${telegramId}`;
    if (classification === 'no') {
      this.settings.setBotSetting(ctx.botId, angerStreakKey, '0');
    } else {
      const streak = Number(this.settings.getBotSetting(ctx.botId, angerStreakKey) ?? '0') + 1;
      this.settings.setBotSetting(ctx.botId, angerStreakKey, String(streak));
    }
    const escalationIntent =
      classification === 'human' ||
      (classification === 'angry' && this.angerStreak(ctx, telegramId) >= 2);

    if (escalationIntent) {
      this.settings.setBotSetting(ctx.botId, `escalation_${telegramId}`, new Date().toISOString());
      this.settings.setBotSetting(ctx.botId, angerStreakKey, '0');

      const senderName = update.from
        ? `${(update.from as { first_name?: string }).first_name ?? ''} ${(update.from as { last_name?: string }).last_name ?? ''}`.trim()
        : String(telegramId);

      const supportModule = await this.botModel.getModule(ctx.botId, 'support');
      const supportConfig = supportModule?.configJson
        ? (JSON.parse(supportModule.configJson) as Record<string, unknown>)
        : {};
      const adminChatId = Number(supportConfig.adminChatId ?? 0);

      // The record lands in the Support Desk (and the AI→Human queue) even
      // when the support module toggle is off, so escalations are never lost.
      await this.supportModel.createMessage({
        botId: ctx.botId,
        telegramId,
        userMessageId: 0,
        adminChatId,
        forumTopicId: 0,
        direction: 'in',
        senderName: senderName || String(telegramId),
        messageText: `[AI Escalation] ${text}`,
        mediaType: 'text',
      });

      if (adminChatId) {
        // User-controlled name and inquiry text are HTML-escaped: they travel
        // inside a parse_mode=HTML admin notification.
        void ctx.bot.api
          .sendMessage(
            adminChatId,
            `🚨 <b>[AI Escalation to Human Agent]</b>\nUser: <b>${escapeHtml(senderName)}</b> (ID: <code>${telegramId}</code>)\nReason: <i>${escapeHtml(classification)}</i>\nInquiry: "${escapeHtml(text)}"`,
            { parse_mode: 'HTML' },
          )
          .catch(() => undefined);
      }

      await update.reply(
        'Talebinizi yetkili destek ekibimize ilettim ve önceliklendirdim. Bir müşteri temsilcimiz sizinle en kısa sürede iletişime geçecektir. / I have escalated your inquiry to our human support team. An agent will follow up shortly.',
      );
      return;
    }

    // 2. Load Persistent Chat History
    const limit = (config.historyLimit || 6) * 2;
    const history = await this.service.getHistory(ctx.botId, telegramId, limit);
    history.push({ role: 'user', content: text });

    // 3. Save incoming turn
    await this.service.saveMessage(ctx.botId, telegramId, 'user', text);

    // 4. Generate RAG & Tool-enriched Completion (never throws; failures are
    //    classified in the result and shown to the user as unavailability).
    const result = await this.service.completeWithSources(ctx.botId, telegramId, config, history);

    // 5. Save assistant reply and attach usage metrics.
    const savedId = await this.service.saveMessage(
      ctx.botId,
      telegramId,
      'assistant',
      result.reply,
    );
    await this.aiModel
      .recordMetrics(savedId, {
        promptTokens: result.usage?.prompt_tokens,
        completionTokens: result.usage?.completion_tokens,
        latencyMs: result.latencyMs,
        isError: result.isError,
      })
      .catch(() => undefined);

    // 6. Send to Telegram user (friendly fallback on provider failure).
    if (result.isError) {
      this.logger.warn(`AI reply failed: ${result.reply}`);
      await update
        .reply('The assistant is temporarily unavailable. Please try again later.')
        .catch(() => undefined);
      return;
    }
    await update.reply(result.reply);
  }

  /**
   * Checks whether a module is enabled for the bot.
   */
  private async moduleEnabled(botId: number, moduleKey: string): Promise<boolean> {
    const mod = await this.botModel.getModule(botId, moduleKey);
    return Boolean(mod?.isEnabled);
  }

  /**
   * Checks whether an autoresponder rule claims the message text.
   */
  private async matchedAutoresponder(botId: number, text: string): Promise<boolean> {
    if (!(await this.moduleEnabled(botId, 'autoresponder'))) return false;
    const rules = await this.autoresponderModel.list(botId);
    return rules.some(
      (rule) =>
        rule.isActive === 1 &&
        !rule.command.startsWith('/') &&
        text.toLowerCase().includes(rule.command.toLowerCase()),
    );
  }
}
