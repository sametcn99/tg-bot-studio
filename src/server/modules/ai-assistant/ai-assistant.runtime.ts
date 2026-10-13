import { Injectable, Logger } from '@nestjs/common';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { AiAssistantService, type AiConfig } from './ai-assistant.service';
import { BotModel } from '../../models/bot.model';
import { AutoresponderModel } from '../../models/autoresponder.model';
import { SupportModel } from '../../models/support.model';
import { SystemSettingsService } from '../../database/system-settings.service';

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
        if (!file.file_path || !config.apiKey) return;

        const token = bot.token;
        const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        const res = await fetch(fileUrl);
        if (!res.ok) return;

        const arrayBuf = await res.arrayBuffer();
        const transcribed = await this.service.transcribeAudio(
          config.apiKey,
          Buffer.from(arrayBuf),
          'voice.oga',
        );

        if (transcribed && transcribed.trim()) {
          this.logger.log(`Transcribed voice from user ${update.from.id}: "${transcribed.trim()}"`);
          await this.handleUserTurn(ctx, update, transcribed.trim());
        }
      } catch (err) {
        this.logger.warn(
          `Voice processing error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
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

    // 1. Smart Human-in-the-Loop Handoff Check
    const lower = text.toLowerCase();
    const handoffTriggers = [
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
    const wantsHuman = handoffTriggers.some((t) => lower.includes(t));

    if (wantsHuman) {
      this.settings.setBotSetting(ctx.botId, `escalation_${telegramId}`, new Date().toISOString());

      const senderName = update.from
        ? `${(update.from as { first_name?: string }).first_name ?? ''} ${(update.from as { last_name?: string }).last_name ?? ''}`.trim()
        : String(telegramId);

      const supportModule = await this.botModel.getModule(ctx.botId, 'support');
      const supportConfig = supportModule?.configJson
        ? (JSON.parse(supportModule.configJson) as Record<string, unknown>)
        : {};
      const adminChatId = Number(supportConfig.adminChatId ?? 0);

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
        void ctx.bot.api
          .sendMessage(
            adminChatId,
            `🚨 <b>[AI Escalation to Human Agent]</b>\nUser: <b>${senderName}</b> (ID: <code>${telegramId}</code>)\nInquiry: "${text}"`,
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

    try {
      // 4. Generate RAG & Tool-enriched Completion
      const reply = await this.service.completeWithContext(ctx.botId, telegramId, config, history);

      // 5. Save assistant reply
      await this.service.saveMessage(ctx.botId, telegramId, 'assistant', reply);

      // 6. Send to Telegram user
      await update.reply(reply);
    } catch (error) {
      this.logger.warn(
        `AI reply failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      await update
        .reply('The assistant is temporarily unavailable. Please try again later.')
        .catch(() => undefined);
    }
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
