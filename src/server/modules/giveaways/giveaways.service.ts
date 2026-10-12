import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { DatabaseService } from '../../database/database.service';
import { BotPoolService } from '../../bot-engine/bot-pool.service';
import { SystemSettingsService } from '../../database/system-settings.service';

/**
 * Giveaway row in the `giveaways` table.
 * @interface GiveawayRow
 * @property {number} id - Giveaway identifier.
 * @property {number} bot_id - Owning bot id.
 * @property {string} title - Prize title.
 * @property {string} [required_channels_json] - JSON array of required channel ids/usernames.
 * @property {number} winners_count - Number of winners to draw.
 * @property {string} [prize_details] - Prize description.
 * @property {string} [ends_at] - ISO end timestamp.
 * @property {string} status - `active` | `finished`.
 */
export interface GiveawayRow {
  id: number;
  bot_id: number;
  title: string;
  required_channels_json: string | null;
  winners_count: number;
  prize_details: string | null;
  ends_at: string | null;
  status: string;
}

/** Draw-check ticker interval (60 seconds). */
const TICK_INTERVAL_MS = 60_000;

/**
 * Giveaways & Contest Engine: CRUD, participant bookkeeping (stored in
 * bot_settings), required-channel verification, and a ticker that draws
 * verifiable winners (seeded shuffle) when a giveaway ends.
 */
@Injectable()
export class GiveawaysService implements OnApplicationShutdown {
  private readonly logger = new Logger(GiveawaysService.name);
  private readonly ticker: ReturnType<typeof setInterval>;

  /**
   * @param {DatabaseService} db - SQLite access service.
   * @param {BotPoolService} pool - Multi-bot runtime pool.
   * @param {SystemSettingsService} settings - Bot settings key-value store.
   */
  constructor(
    private readonly db: DatabaseService,
    private readonly pool: BotPoolService,
    private readonly settings: SystemSettingsService,
  ) {
    this.ticker = setInterval(() => {
      void this.finishDue().catch((error: Error) =>
        this.logger.error(`Giveaway draw failed: ${error.message}`),
      );
    }, TICK_INTERVAL_MS);
  }

  /**
   * Stops the draw ticker on shutdown.
   * @returns {void}
   */
  onApplicationShutdown(): void {
    clearInterval(this.ticker);
  }

  /**
   * Lists giveaways for a bot with participant counts.
   * @param {number} botId - Owning bot id.
   * @returns {Array<object>} Giveaway rows enriched with participants.
   */
  list(botId: number): Array<Record<string, unknown>> {
    const rows = this.db.query<GiveawayRow>(
      'SELECT * FROM giveaways WHERE bot_id = ? ORDER BY id DESC',
      botId,
    );
    return rows.map((row) => ({
      ...row,
      requiredChannels: row.required_channels_json
        ? (JSON.parse(row.required_channels_json) as string[])
        : [],
      participants: this.participants(botId, row.id).length,
    }));
  }

  /**
   * Creates a giveaway.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} data - title, requiredChannels, winnersCount, prizeDetails, endsAt.
   * @returns {object} Created giveaway.
   */
  create(botId: number, data: Record<string, unknown>): Record<string, unknown> {
    const result = this.db.run(
      `INSERT INTO giveaways (bot_id, title, required_channels_json, winners_count, prize_details, ends_at, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      botId,
      String(data.title ?? 'Untitled giveaway'),
      data.requiredChannels ? JSON.stringify(data.requiredChannels) : null,
      Number(data.winnersCount ?? 1),
      (data.prizeDetails as string) ?? null,
      (data.endsAt as string) ?? null,
    );
    return this.list(botId).find((row) => row.id === Number(result.lastInsertRowid))!;
  }

  /**
   * Updates a giveaway.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Giveaway identifier.
   * @param {Record<string, unknown>} data - Patch fields.
   * @returns {object} Updated giveaway.
   * @throws {NotFoundException} When the giveaway does not exist.
   */
  update(botId: number, id: number, data: Record<string, unknown>): Record<string, unknown> {
    const existing = this.db.get<GiveawayRow>(
      'SELECT * FROM giveaways WHERE bot_id = ? AND id = ?',
      botId,
      id,
    );
    if (!existing) throw new NotFoundException(`Giveaway ${id} not found`);
    this.db.run(
      'UPDATE giveaways SET title = ?, required_channels_json = ?, winners_count = ?, prize_details = ?, ends_at = ? WHERE id = ?',
      String(data.title ?? existing.title),
      data.requiredChannels ? JSON.stringify(data.requiredChannels) : existing.required_channels_json,
      Number(data.winnersCount ?? existing.winners_count),
      (data.prizeDetails as string) ?? existing.prize_details,
      (data.endsAt as string) ?? existing.ends_at,
      id,
    );
    return this.list(botId).find((row) => row.id === id)!;
  }

  /**
   * Deletes a giveaway and its participant bookkeeping.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Giveaway identifier.
   * @returns {void}
   */
  remove(botId: number, id: number): void {
    this.db.run('DELETE FROM giveaways WHERE bot_id = ? AND id = ?', botId, id);
    this.settings.setBotJson(botId, `giveaway_participants_${id}`, []);
  }

  /**
   * Reads the participant list of a giveaway.
   * @param {number} botId - Owning bot id.
   * @param {number} giveawayId - Giveaway identifier.
   * @returns {number[]} Participant Telegram ids.
   */
  participants(botId: number, giveawayId: number): number[] {
    return this.settings.getBotJson<number[]>(botId, `giveaway_participants_${giveawayId}`) ?? [];
  }

  /**
   * Adds a participant (idempotent).
   * @param {number} botId - Owning bot id.
   * @param {number} giveawayId - Giveaway identifier.
   * @param {number} telegramId - Participant Telegram id.
   * @returns {boolean} True when the user was newly added.
   */
  addParticipant(botId: number, giveawayId: number, telegramId: number): boolean {
    const list = this.participants(botId, giveawayId);
    if (list.includes(telegramId)) return false;
    list.push(telegramId);
    this.settings.setBotJson(botId, `giveaway_participants_${giveawayId}`, list);
    return true;
  }

  /**
   * Verifies that a user is a member of every required channel.
   * @param {number} botId - Owning bot id.
   * @param {number} telegramId - Participant Telegram id.
   * @param {string[]} channels - Required channel ids or @usernames.
   * @returns {Promise<boolean>} True when all checks pass.
   */
  async verifyMembership(
    botId: number,
    telegramId: number,
    channels: string[],
  ): Promise<boolean> {
    const bot = this.pool.getBot(botId);
    if (!bot || channels.length === 0) return channels.length === 0;
    for (const channel of channels) {
      const target = Number.isNaN(Number(channel)) ? channel : Number(channel);
      try {
        const member = await bot.api.getChatMember(target, telegramId);
        if (!['member', 'administrator', 'creator'].includes(member.status)) {
          return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  }

  /**
   * Draws winners for every ended giveaway using a seeded deterministic
   * shuffle (seed = giveaway id + participant list hash) so results are
   * verifiable after the fact.
   * @returns {Promise<void>} Resolves once all due giveaways were processed.
   */
  private async finishDue(): Promise<void> {
    const now = new Date().toISOString();
    const due = this.db.query<GiveawayRow>(
      "SELECT * FROM giveaways WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at <= ?",
      now,
    );
    for (const giveaway of due) {
      const bot = this.pool.getBot(giveaway.bot_id);
      const participants = this.participants(giveaway.bot_id, giveaway.id);
      const winners = this.drawWinners(giveaway.id, participants, giveaway.winners_count);

      this.db.run("UPDATE giveaways SET status = 'finished' WHERE id = ?", giveaway.id);
      this.settings.setBotJson(giveaway.bot_id, `giveaway_winners_${giveaway.id}`, winners);

      if (bot) {
        for (const winner of winners) {
          void bot.api
            .sendMessage(
              winner,
              `Congratulations! You won the giveaway: ${giveaway.title}.\n${giveaway.prize_details ?? ''}`.trim(),
            )
            .catch(() => undefined);
        }
      }
      this.logger.log(`Giveaway ${giveaway.id} finished with ${winners.length} winner(s)`);
    }
  }

  /**
   * Deterministic seeded shuffle selecting `count` winners.
   * @param {number} giveawayId - Giveaway identifier (seed component).
   * @param {number[]} participants - Eligible participant ids.
   * @param {number} count - Number of winners to draw.
   * @returns {number[]} Drawn winner ids.
   */
  private drawWinners(giveawayId: number, participants: number[], count: number): number[] {
    if (participants.length === 0) return [];
    const seedSource = `${giveawayId}:${[...participants].sort((a, b) => a - b).join(',')}`;
    let seed = 0;
    for (const char of seedSource) {
      seed = (seed * 31 + char.charCodeAt(0)) % 2 ** 31;
    }
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const poolCopy = [...participants];
    const winners: number[] = [];
    while (winners.length < Math.min(count, poolCopy.length)) {
      const index = Math.floor(random() * poolCopy.length);
      winners.push(poolCopy.splice(index, 1)[0]!);
    }
    return winners;
  }

  /**
   * Builds the join button keyboard for a giveaway announcement.
   * @param {number} giveawayId - Giveaway identifier.
   * @returns {InlineKeyboard} Keyboard with the join callback button.
   */
  joinKeyboard(giveawayId: number): InlineKeyboard {
    return new InlineKeyboard().text('Participate', `giveaway:${giveawayId}:join`);
  }
}
