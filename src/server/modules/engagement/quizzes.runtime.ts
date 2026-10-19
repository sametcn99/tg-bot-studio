import { Injectable, Logger } from '@nestjs/common';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { EngineHelpersService } from '../../bot-engine/engine-helpers.service';
import { ChatSettingsService } from '../../bot-engine/chat-settings.service';
import { EngagementService } from './engagement.service';

/**
 * Runtime for the Interactive Quizzes & Polls module. The configured command
 * sends a Telegram quiz poll via `sendPoll`, and `poll_answer` updates award
 * points for correct answers and feed the persistent scoreboard. Correctness
 * is evaluated against the quiz definition because the bot authored the poll.
 */
@Injectable()
export class QuizzesRuntime extends BotModuleHandler {
  private readonly logger = new Logger(QuizzesRuntime.name);
  /** Registry key of the module. */
  readonly moduleKey = 'quizzes';

  /** Telegram poll id -> quiz id, scoped per bot (`botId:pollId` keys). */
  private readonly activePolls = new Map<string, string>();

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
   * Attaches quiz and scoreboard middleware to the bot.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot } = ctx;
    const botId = ctx.botId;

    // Explicit-target gate: quizzes run only in the module's configured chats.
    const targeted = async (chatId: number): Promise<boolean> =>
      this.chatSettings.isTargeted(botId, chatId, this.moduleKey);

    bot.command(String(ctx.config.defaultCommand ?? 'quiz'), async (update) => {
      if (!(await targeted(update.chat.id))) return;
      const quizzes = this.service.listQuizzes(ctx.botId);
      if (quizzes.length === 0) {
        await update.reply('No quizzes are configured yet.');
        return;
      }
      const quiz = quizzes[Math.floor(Math.random() * quizzes.length)]!;
      const sent = await bot.api.sendPoll(update.chat.id, quiz.question, quiz.options, {
        type: 'quiz',
        correct_option_ids: [quiz.correctOptionId],
        is_anonymous: false,
      });
      this.activePolls.set(`${ctx.botId}:${sent.poll.id}`, quiz.id);
    });

    bot.command('scoreboard', async (update) => {
      if (!(await targeted(update.chat.id))) return;
      const quizzes = this.service.listQuizzes(ctx.botId);
      const blocks: string[] = [];
      for (const quiz of quizzes) {
        const scores = this.service.getScoreboard(ctx.botId, quiz.id);
        const entries = Object.entries(scores)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(
            ([telegramId, count], index) => `${index + 1}. <code>${telegramId}</code> - ${count}`,
          )
          .join('\n');
        blocks.push(`<b>${quiz.question}</b>\n${entries || 'No answers yet.'}`);
      }
      await update.reply(
        blocks.length ? `<b>Scoreboards</b>\n\n${blocks.join('\n\n')}` : 'No quizzes configured.',
        { parse_mode: 'HTML' },
      );
    });

    bot.on('poll_answer', async (update, next) => {
      try {
        const quizId = this.activePolls.get(`${ctx.botId}:${update.pollAnswer.poll_id}`);
        if (!quizId) return;
        const quiz = this.service.listQuizzes(ctx.botId).find((entry) => entry.id === quizId);
        if (!quiz || !update.pollAnswer.user) return;
        const [chosen] = update.pollAnswer.option_ids;
        if (chosen === undefined || chosen !== quiz.correctOptionId) return;
        this.service.recordCorrectAnswer(ctx.botId, quizId, update.pollAnswer.user.id);
        this.helpers.addPoints(ctx.botId, update.pollAnswer.user.id, quiz.points);
      } catch (err) {
        this.logger.warn(
          `Quizzes poll_answer error for bot ${ctx.botId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        await next();
      }
    });
  }
}
