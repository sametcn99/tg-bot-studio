import { Injectable, Logger, NotFoundException, OnApplicationShutdown } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { BotPoolService } from '../../bot-engine/bot-pool.service';
import { SystemSettingsService } from '../../database/system-settings.service';
import { PrismaService } from '../../database/prisma.service';
import { GiveawayModel } from './giveaway.model';

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
  id: string;
  bot_id: string;
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

  constructor(
    private readonly giveawayModel: GiveawayModel,
    private readonly pool: BotPoolService,
    private readonly settings: SystemSettingsService,
    private readonly prisma: PrismaService,
  ) {
    this.ticker = setInterval(() => {
      void this.finishDue().catch((error: Error) =>
        this.logger.error(`Giveaway draw failed: ${error.message}`),
      );
    }, TICK_INTERVAL_MS);
  }

  /**
   * Stops the draw ticker on shutdown.
   */
  onApplicationShutdown(): void {
    clearInterval(this.ticker);
  }

  /**
   * Lists giveaways for a bot with participant counts.
   */
  async list(botId: string): Promise<Array<Record<string, unknown>>> {
    const rows = await this.giveawayModel.list(botId);
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        bot_id: row.botId,
        title: row.title,
        required_channels_json: row.requiredChannelsJson,
        winners_count: row.winnersCount,
        prize_details: row.prizeDetails,
        ends_at: row.endsAt,
        status: row.status,
        botId: row.botId,
        requiredChannelsJson: row.requiredChannelsJson,
        winnersCount: row.winnersCount,
        prizeDetails: row.prizeDetails,
        endsAt: row.endsAt,
        requiredChannels: row.requiredChannelsJson
          ? (JSON.parse(row.requiredChannelsJson) as string[])
          : [],
        participants: (await this.participants(botId, row.id)).length,
      })),
    );
  }

  /**
   * Creates a giveaway.
   */
  async create(botId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const item = await this.giveawayModel.create({
      botId,
      title: String(data.title ?? 'Untitled giveaway'),
      requiredChannelsJson: data.requiredChannels ? JSON.stringify(data.requiredChannels) : null,
      winnersCount: Number(data.winnersCount ?? 1),
      prizeDetails: (data.prizeDetails as string) ?? null,
      endsAt: (data.endsAt as string) ?? null,
    });
    return {
      id: item.id,
      bot_id: item.botId,
      title: item.title,
      required_channels_json: item.requiredChannelsJson,
      winners_count: item.winnersCount,
      prize_details: item.prizeDetails,
      ends_at: item.endsAt,
      status: item.status,
      botId: item.botId,
      requiredChannelsJson: item.requiredChannelsJson,
      winnersCount: item.winnersCount,
      prizeDetails: item.prizeDetails,
      endsAt: item.endsAt,
      requiredChannels: item.requiredChannelsJson
        ? (JSON.parse(item.requiredChannelsJson) as string[])
        : [],
      participants: 0,
    };
  }

  /**
   * Updates a giveaway.
   */
  async update(
    botId: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const existing = await this.giveawayModel.findById(botId, id);
    if (!existing) throw new NotFoundException(`Giveaway ${id} not found`);
    const updated = await this.giveawayModel.update(id, {
      title: data.title !== undefined ? String(data.title) : existing.title,
      requiredChannelsJson: data.requiredChannels
        ? JSON.stringify(data.requiredChannels)
        : existing.requiredChannelsJson,
      winnersCount:
        data.winnersCount !== undefined ? Number(data.winnersCount) : existing.winnersCount,
      prizeDetails:
        data.prizeDetails !== undefined
          ? (data.prizeDetails as string) || null
          : existing.prizeDetails,
      endsAt: data.endsAt !== undefined ? (data.endsAt as string) || null : existing.endsAt,
    });
    const parts = await this.participants(botId, id);
    return {
      id: updated.id,
      bot_id: updated.botId,
      title: updated.title,
      required_channels_json: updated.requiredChannelsJson,
      winners_count: updated.winnersCount,
      prize_details: updated.prizeDetails,
      ends_at: updated.endsAt,
      status: updated.status,
      botId: updated.botId,
      requiredChannelsJson: updated.requiredChannelsJson,
      winnersCount: updated.winnersCount,
      prizeDetails: updated.prizeDetails,
      endsAt: updated.endsAt,
      requiredChannels: updated.requiredChannelsJson
        ? (JSON.parse(updated.requiredChannelsJson) as string[])
        : [],
      participants: parts.length,
    };
  }

  /**
   * Deletes a giveaway and its participant bookkeeping.
   */
  async remove(botId: string, id: string): Promise<void> {
    await this.giveawayModel.delete(id);
    await this.settings.setBotJson(botId, `giveaway_participants_${id}`, []);
  }

  /**
   * Reads the participant list of a giveaway.
   */
  async participants(botId: string, giveawayId: string): Promise<number[]> {
    return (
      (await this.settings.getBotJson<number[]>(botId, `giveaway_participants_${giveawayId}`)) ?? []
    );
  }

  /**
   * Adds a participant (idempotent).
   */
  async addParticipant(botId: string, giveawayId: string, telegramId: number): Promise<boolean> {
    const list = await this.participants(botId, giveawayId);
    if (list.includes(telegramId)) return false;
    list.push(telegramId);
    await this.settings.setBotJson(botId, `giveaway_participants_${giveawayId}`, list);
    return true;
  }

  /**
   * Verifies that a user is a member of every required channel.
   */
  async verifyMembership(botId: string, telegramId: number, channels: string[]): Promise<boolean> {
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
   */
  private async finishDue(): Promise<void> {
    const now = new Date().toISOString();
    const due = await this.giveawayModel.findDue(now);
    for (const giveaway of due) {
      const bot = this.pool.getBot(giveaway.botId);
      const participants = await this.participants(giveaway.botId, giveaway.id);
      const winners = this.drawWinners(giveaway.id, participants, giveaway.winnersCount);

      await this.giveawayModel.finish(giveaway.id);
      await this.settings.setBotJson(giveaway.botId, `giveaway_winners_${giveaway.id}`, winners);

      if (bot) {
        const moduleRow = await this.prisma.botModule.findUnique({
          where: { botId_moduleKey: { botId: giveaway.botId, moduleKey: 'giveaways' } },
        });
        const config = moduleRow?.configJson
          ? (JSON.parse(moduleRow.configJson) as Record<string, unknown>)
          : {};
        const announce = config.announceWinners !== false;

        if (announce) {
          for (const winner of winners) {
            void bot.api
              .sendMessage(
                winner,
                `🎉 Congratulations! You won the giveaway: ${giveaway.title}.\n${giveaway.prizeDetails ?? ''}`.trim(),
              )
              .catch(() => undefined);
          }

          if (giveaway.requiredChannelsJson) {
            try {
              const channels = JSON.parse(giveaway.requiredChannelsJson) as string[];
              const announcement = `🎉 <b>Giveaway Ended: ${giveaway.title}</b>\n\nPrize: ${giveaway.prizeDetails ?? 'Mystery Prize'}\nWinners drawn: ${winners.length}\nCongratulations to all winners!`;
              for (const ch of channels) {
                const target = Number.isNaN(Number(ch)) ? ch : Number(ch);
                void bot.api
                  .sendMessage(target, announcement, { parse_mode: 'HTML' })
                  .catch(() => undefined);
              }
            } catch {}
          }
        }
      }
      this.logger.log(`Giveaway ${giveaway.id} finished with ${winners.length} winner(s)`);
    }
  }

  /**
   * Deterministic seeded shuffle selecting `count` winners.
   */
  private drawWinners(giveawayId: string, participants: number[], count: number): number[] {
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
   */
  joinKeyboard(giveawayId: string): InlineKeyboard {
    return new InlineKeyboard().text('Participate', `giveaway:${giveawayId}:join`);
  }
}
