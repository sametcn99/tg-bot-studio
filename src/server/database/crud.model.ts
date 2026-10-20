import { NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Shared CRUD skeleton for bot-scoped models. Every module model repeats the
 * same list/findById/require/delete shape against a Prisma delegate; new
 * models extend this instead of hand-rolling the fifth copy.
 *
 * Subclasses provide the delegate (`protected override readonly delegate =
 * this.prisma.mediaAsset;`) and keep their custom create/update methods —
 * those differ per module, the retrieval/lifecycle shape does not.
 */
export abstract class BotScopedCrudModel<Row extends { id: string }> {
  protected readonly prisma: PrismaService;
  protected abstract readonly delegate: any;
  protected readonly defaultOrder: Record<string, 'asc' | 'desc'> = { createdAt: 'desc' };

  /**
   * @param {PrismaService} prisma - Prisma ORM access service.
   */
  constructor(prisma: PrismaService) {
    this.prisma = prisma;
  }

  /**
   * Lists rows of a bot, newest first (or by the subclass ordering).
   * @param {number} botId - Owning bot id.
   * @param {number} [take] - Optional row cap.
   * @returns {Promise<Row[]>} Rows.
   */
  list(botId: string, take?: number): Promise<Row[]> {
    return this.delegate.findMany({
      where: { botId },
      orderBy: this.defaultOrder,
      ...(take !== undefined ? { take } : {}),
    });
  }

  /**
   * Finds one row scoped to its bot.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Row id.
   * @returns {Promise<Row | null>} Row when found.
   */
  async findById(botId: string, id: string): Promise<Row | null> {
    return (await this.delegate.findFirst({ where: { id, botId } })) as Row | null;
  }

  /**
   * Finds one row or throws the shared not-found error.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Row id.
   * @param {string} [label] - Entity label for the error message.
   * @returns {Promise<Row>} The row.
   * @throws {NotFoundException} When the row does not exist for the bot.
   */
  async require(botId: string, id: string, label = 'Entity'): Promise<Row> {
    const row = await this.findById(botId, id);
    if (!row) throw new NotFoundException(`${label} ${id} not found`);
    return row;
  }

  /**
   * Deletes a row scoped to its bot.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Row id.
   * @param {string} [label] - Entity label for the error message.
   * @returns {Promise<void>} Resolves once removed.
   * @throws {NotFoundException} When the row does not exist for the bot.
   */
  async delete(botId: string, id: string, label = 'Entity'): Promise<void> {
    await this.require(botId, id, label);
    await this.delegate.delete({ where: { id } });
  }
}
