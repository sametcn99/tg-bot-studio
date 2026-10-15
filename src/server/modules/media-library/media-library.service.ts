import { BadRequestException, Injectable } from '@nestjs/common';
import { MediaAssetModel } from './media-asset.model';
import { MEDIA_KINDS } from './media-asset.constants';
import { toMediaAssetRow } from './media-asset.mapper';
import { BotModel } from '../../bots/bot.model';
import { LiveEventsService } from '../../common/live/live-events.service';

/**
 * Shared media library service: per-bot reusable URL / file_id assets for
 * every media-capable composer in the studio (welcome, broadcast, drip,
 * autoresponder, scheduled posts).
 */
@Injectable()
export class MediaLibraryService {
  /**
   * @param {MediaAssetModel} mediaModel - Media asset persistence model.
   * @param {BotModel} botModel - Bot existence checks.
   * @param {LiveEventsService} live - Live change bus for SSE pings.
   */
  constructor(
    private readonly mediaModel: MediaAssetModel,
    private readonly botModel: BotModel,
    private readonly live: LiveEventsService,
  ) {}

  /**
   * Lists the library of a bot.
   * @param {number} botId - Owning bot id.
   * @returns {Promise<object[]>} Asset rows, newest first.
   */
  async list(botId: number) {
    const assets = await this.mediaModel.list(botId);
    return assets.map(toMediaAssetRow);
  }

  /**
   * Adds an asset to the library.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} body - name, source (url|file_id), value,
   * kind, mimeType, fileSize, tags.
   * @returns {Promise<object>} Created asset row.
   */
  async create(botId: number, body: Record<string, unknown>) {
    await this.botModel.findById(botId);
    const name = String(body.name ?? '').trim();
    const value = String(body.value ?? '').trim();
    if (!name) throw new BadRequestException('name is required');
    if (!value) throw new BadRequestException('value is required');

    const source = String(body.source ?? 'url');
    if (source !== 'url' && source !== 'file_id') {
      throw new BadRequestException('source must be url or file_id');
    }
    if (source === 'url' && !/^https?:\/\//i.test(value)) {
      throw new BadRequestException('url assets must start with http(s)://');
    }
    const kind = String(body.kind ?? 'photo');
    if (!(MEDIA_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException(`kind must be one of: ${MEDIA_KINDS.join(', ')}`);
    }

    const created = await this.mediaModel.create({
      botId,
      name,
      source,
      value,
      kind,
      mimeType: body.mimeType ? String(body.mimeType) : null,
      fileSize: Number.isFinite(Number(body.fileSize)) ? Number(body.fileSize) : null,
      tags: body.tags ? String(body.tags) : null,
    });
    this.live.emit('media', botId);
    return toMediaAssetRow(created);
  }

  /**
   * Deletes an asset.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Asset id.
   * @returns {Promise<{success: boolean}>} Confirmation payload.
   */
  async remove(botId: number, id: number) {
    await this.mediaModel.remove(botId, id);
    this.live.emit('media', botId);
    return { success: true };
  }
}
