import { Injectable, Logger } from '@nestjs/common';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { DatabaseService } from '../../database/database.service';
import { AiAssistantService, type AiConfig, type ChatMessage } from './ai-assistant.service';

/**
 * Runtime for the AI Knowledge Assistant module.
 * Answers private text and voice messages around the clock using RAG knowledge,
 * persistent SQLite history, and intelligent human handoff triage.
 */
@Injectable()
export class AiAssistantRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'ai-assistant';

  private readonly logger = new Logger(AiAssistantRuntime.name);

  /**
   * @param {AiAssistantService} service - Provider gateway.
   * @param {DatabaseService} db - SQLite access service.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly service: AiAssistantService,
    private readonly db: DatabaseService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches text and voice AI handlers to the bot.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
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
      if (this.moduleEnabled(ctx.botId, 'support')) return;
      // Autoresponder keyword rules take precedence.
      if (this.matchedAutoresponder(ctx.botId, update.msg.text)) return;

      await this.handleUserTurn(ctx, update, update.msg.text);
    });

    // ----- Multimodal Voice/Audio Messages Handler ---------------------------
    bot.on(['message:voice', 'message:audio'], async (update) => {
      if (update.chat?.type !== 'private') return;
      if (!update.from) return;
      if (this.moduleEnabled(ctx.botId, 'support')) return;

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
        this.logger.warn(`Voice processing error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  }

  /**
   * Processes a user turn: checks smart human handoff, loads persistent SQLite history,
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

    if (wantsHuman && this.moduleEnabled(ctx.botId, 'support')) {
      await update.reply(
        'Talebinizi yetkili destek ekibimize ilettim. En kısa sürede bir müşteri temsilcimiz sizinle iletişime geçecektir. / I have escalated your request to a human support agent.',
      );
      return;
    }

    // 2. Load Persistent Chat History from SQLite
    const limit = (config.historyLimit || 6) * 2;
    const history = this.service.getHistory(ctx.botId, telegramId, limit);
    history.push({ role: 'user', content: text });

    // 3. Save incoming turn
    this.service.saveMessage(ctx.botId, telegramId, 'user', text);

    try {
      // 4. Generate RAG & Tool-enriched Completion
      const reply = await this.service.completeWithContext(
        ctx.botId,
        telegramId,
        config,
        history,
      );

      // 5. Save assistant reply to SQLite
      this.service.saveMessage(ctx.botId, telegramId, 'assistant', reply);

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
  private moduleEnabled(botId: number, moduleKey: string): boolean {
    return Boolean(
      this.db.get<{ is_enabled: number }>(
        'SELECT is_enabled FROM bot_modules WHERE bot_id = ? AND module_key = ?',
        botId,
        moduleKey,
      )?.is_enabled,
    );
  }

  /**
   * Checks whether an autoresponder rule claims the message text.
   */
  private matchedAutoresponder(botId: number, text: string): boolean {
    if (!this.moduleEnabled(botId, 'autoresponder')) return false;
    const rules = this.db.query<{ command: string }>(
      'SELECT command FROM autoresponders WHERE bot_id = ? AND is_active = 1',
      botId,
    );
    return rules.some(
      (rule) =>
        !rule.command.startsWith('/') &&
        text.toLowerCase().includes(rule.command.toLowerCase()),
    );
  }
}
