import { Injectable } from '@nestjs/common';
import type { MediaAsset } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { BotScopedCrudModel } from '../../database/crud.model';

/**
 * Model managing the shared per-bot media library via Prisma. Retrieval and
 * deletion live in the shared {@link BotScopedCrudModel} skeleton; creation
 * stays here because its field set is library-specific.
 */
@Injectable()
export class MediaAssetModel extends BotScopedCrudModel<MediaAsset> {
  /** @param {PrismaService} prisma - Prisma ORM access service. */
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected override readonly delegate = this.prisma.mediaAsset;

  /**
   * Creates an asset.
   * @param {object} data - Asset fields.
   * @returns {Promise<MediaAsset>} Created row.
   */
  async create(data: {
    botId: string;
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
   */
  async remove(botId: string, id: string): Promise<void> {
    await this.delete(botId, id, 'Media asset');
  }
}
