import { Injectable, NotFoundException } from '@nestjs/common';
import type { MediaAsset } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * Model managing the shared per-bot media library via Prisma.
 */
@Injectable()
export class MediaAssetModel {
  /**
   * @param {PrismaService} prisma - Prisma ORM access service.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lists every asset of a bot, newest first.
   * @param {number} botId - Owning bot id.
   * @returns {Promise<MediaAsset[]>} Asset rows.
   */
  async list(botId: number): Promise<MediaAsset[]> {
    return this.prisma.mediaAsset.findMany({
      where: { botId },
      orderBy: { id: 'desc' },
    });
  }

  /**
   * Creates an asset.
   * @param {object} data - Asset fields.
   * @returns {Promise<MediaAsset>} Created row.
   */
  async create(data: {
    botId: number;
    name: string;
    source: string;
    value: string;
    kind: string;
    mimeType?: string | null;
    fileSize?: number | null;
    tags?: string | null;
  }): Promise<MediaAsset> {
    return this.prisma.mediaAsset.create({
      data: {
        botId: data.botId,
        name: data.name,
        source: data.source,
        value: data.value,
        kind: data.kind,
        mimeType: data.mimeType ?? null,
        fileSize: data.fileSize ?? null,
        tags: data.tags ?? null,
        createdAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Deletes an asset scoped to its bot.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Asset id.
   * @returns {Promise<void>} Resolves once removed.
   * @throws {NotFoundException} When the asset does not exist for the bot.
   */
  async remove(botId: number, id: number): Promise<void> {
    const existing = await this.prisma.mediaAsset.findFirst({ where: { id, botId } });
    if (!existing) throw new NotFoundException(`Media asset ${id} not found`);
    await this.prisma.mediaAsset.delete({ where: { id } });
  }
}
