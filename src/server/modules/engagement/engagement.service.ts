import { Injectable, NotFoundException } from '@nestjs/common';
import { SystemSettingsService } from '../../database/system-settings.service';

/**
 * Quiz definition stored in the `quizzes` bot_settings collection.
 * @interface QuizDefinition
 * @property {string} id - Unique quiz identifier (slug).
 * @property {string} question - Quiz question text.
 * @property {string[]} options - Answer options.
 * @property {number} correctOptionId - Zero-based index of the correct option.
 * @property {number} points - Points awarded per correct answer.
 * @property {boolean} [isAnonymous] - Poll anonymity (default false for scoring).
 */
export interface QuizDefinition {
  id: string;
  question: string;
  options: string[];
  correctOptionId: number;
  points: number;
  isAnonymous?: boolean;
}

/**
 * Reaction analytics configuration and counters accessor. Reactions and quiz
 * scoreboards are persisted in bot_settings JSON blobs because the platform
 * schema is fixed.
 */
@Injectable()
export class EngagementService {
  /**
   * @param {SystemSettingsService} settings - Bot settings key-value store.
   */
  constructor(private readonly settings: SystemSettingsService) {}

  /**
   * Lists configured quizzes.
   * @param {number} botId - Owning bot id.
   * @returns {QuizDefinition[]} Stored quizzes.
   */
  listQuizzes(botId: string): QuizDefinition[] {
    return this.settings.getBotJson<QuizDefinition[]>(botId, 'quizzes') ?? [];
  }

  /**
   * Creates a quiz with a generated id.
   * @param {number} botId - Owning bot id.
   * @param {Omit<QuizDefinition, 'id'>} data - Quiz payload without id.
   * @returns {QuizDefinition} Created quiz.
   */
  createQuiz(botId: string, data: Omit<QuizDefinition, 'id'>): QuizDefinition {
    const quizzes = this.listQuizzes(botId);
    const quiz: QuizDefinition = {
      ...data,
      id: `quiz_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
    };
    quizzes.push(quiz);
    this.settings.setBotJson(botId, 'quizzes', quizzes);
    return quiz;
  }

  /**
   * Deletes a quiz and its scoreboard.
   * @param {number} botId - Owning bot id.
   * @param {string} quizId - Quiz identifier.
   * @returns {void}
   * @throws {NotFoundException} When the quiz does not exist.
   */
  removeQuiz(botId: string, quizId: string): void {
    const quizzes = this.listQuizzes(botId);
    if (!quizzes.some((quiz) => quiz.id === quizId)) {
      throw new NotFoundException(`Quiz ${quizId} not found`);
    }
    this.settings.setBotJson(
      botId,
      'quizzes',
      quizzes.filter((quiz) => quiz.id !== quizId),
    );
    this.settings.setBotJson(botId, `quiz_scores_${quizId}`, {});
  }

  /**
   * Records a correct quiz answer in the scoreboard.
   * @param {number} botId - Owning bot id.
   * @param {string} quizId - Quiz identifier.
   * @param {number} telegramId - Participant Telegram id.
   * @returns {void}
   */
  recordCorrectAnswer(botId: string, quizId: string, telegramId: number): void {
    const scores = this.getScoreboard(botId, quizId);
    scores[String(telegramId)] = (scores[String(telegramId)] ?? 0) + 1;
    this.settings.setBotJson(botId, `quiz_scores_${quizId}`, scores);
  }

  /**
   * Reads the quiz scoreboard.
   * @param {number} botId - Owning bot id.
   * @param {string} quizId - Quiz identifier.
   * @returns {Record<string, number>} Correct-answer counts per Telegram id.
   */
  getScoreboard(botId: string, quizId: string): Record<string, number> {
    return this.settings.getBotJson<Record<string, number>>(botId, `quiz_scores_${quizId}`) ?? {};
  }

  /**
   * Reads the reaction counter summary.
   * @param {number} botId - Owning bot id.
   * @returns {Record<string, number>} Reaction emoji counts.
   */
  getReactionSummary(botId: string): Record<string, number> {
    return this.settings.getBotJson<Record<string, number>>(botId, 'reaction_summary') ?? {};
  }

  /**
   * Increments a reaction counter.
   * @param {number} botId - Owning bot id.
   * @param {string} emoji - Reaction emoji.
   * @returns {void}
   */
  recordReaction(botId: string, emoji: string): void {
    const summary = this.getReactionSummary(botId);
    summary[emoji] = (summary[emoji] ?? 0) + 1;
    this.settings.setBotJson(botId, 'reaction_summary', summary);
  }
}
