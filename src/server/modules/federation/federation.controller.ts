import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { FederationService } from './federation.service';

/**
 * Dashboard endpoints for the federation manager: list feds with counts,
 * their bans and joined chats, add bans manually, and import ban lists.
 */
@Controller('bots/:botId/federation')
export class FederationController {
  /**
   * @param {PrismaService} prisma - Prisma ORM access service.
   * @param {FederationService} federation - Fed data + enforcement layer.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly federation: FederationService,
  ) {}

  /**
   * Lists every federation with chat/ban/admin counts.
   * @param {number} botId - Studio bot id (scope for chat memberships).
   * @returns {Promise<object[]>} Federation summaries.
   */
  @Get()
  async list(@Param('botId') botId: string) {
    const feds = await this.prisma.fed.findMany({ orderBy: { createdAt: 'asc' } });
    return Promise.all(
      feds.map(async (fed) => ({
        id: fed.id,
        name: fed.name,
        ownerTelegramId: fed.ownerTelegramId.toString(),
        createdAt: fed.createdAt,
        chatCount: await this.prisma.fedChat.count({ where: { fedId: fed.id, botId } }),
        totalChatCount: await this.prisma.fedChat.count({ where: { fedId: fed.id } }),
        banCount: await this.prisma.fedBan.count({ where: { fedId: fed.id } }),
        adminCount: await this.prisma.fedAdmin.count({ where: { fedId: fed.id } }),
      })),
    );
  }

  /**
   * Lists the bans of a federation.
   * @param {number} botId - Studio bot id.
   * @param {string} fedId - Federation id.
   * @returns {Promise<object[]>} Ban rows.
   */
  @Get(':fedId/bans')
  async bans(@Param('botId') botId: string, @Param('fedId') fedId: string) {
    void botId;
    const rows = await this.prisma.fedBan.findMany({
      where: { fedId },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map((row) => ({
      id: row.telegramId.toString(),
      telegramId: row.telegramId.toString(),
      reason: row.reason,
      bannedBy: row.bannedBy.toString(),
      createdAt: row.createdAt,
    }));
  }

  /**
   * Lists the chats joined to a federation for this bot.
   * @param {number} botId - Studio bot id.
   * @param {string} fedId - Federation id.
   * @returns {Promise<object[]>} Membership rows.
   */
  @Get(':fedId/chats')
  async chats(@Param('botId') botId: string, @Param('fedId') fedId: string) {
    const rows = await this.prisma.fedChat.findMany({ where: { fedId, botId } });
    return rows.map((row) => ({
      chatId: row.chatId,
      quiet: row.quiet === 1,
      joinedAt: row.joinedAt,
    }));
  }

  /**
   * Manually adds a fed ban (dashboard-driven fban).
   * @param {number} botId - Studio bot id.
   * @param {string} fedId - Federation id.
   * @param {Record<string, unknown>} body - `{ telegramId, reason }`.
   * @returns {Promise<object>} Result with propagation count.
   */
  @Post(':fedId/bans')
  async addBan(
    @Param('botId') botId: string,
    @Param('fedId') fedId: string,
    @Body() body: Record<string, unknown>,
  ) {
    void botId;
    const telegramId = Number(body.telegramId);
    const reason = String(body.reason ?? 'Banned from dashboard');
    const result = await this.federation.fban(fedId, telegramId, reason, 0);
    return result;
  }

  /**
   * Imports a ban list (CSV with `id,reason` header or NDJSON with
   * `user_id`), reference-compatible.
   * @param {number} botId - Studio bot id.
   * @param {string} fedId - Federation id.
   * @param {Record<string, unknown>} body - `{ content }` raw file text.
   * @returns {Promise<{imported: number}>} Count of imported bans.
   */
  @Post(':fedId/import')
  async importList(
    @Param('botId') botId: string,
    @Param('fedId') fedId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const content = String(body.content ?? '');
    const imported = await this.federation.importBans(fedId, content, 0);
    return { imported };
  }
}
