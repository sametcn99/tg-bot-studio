import { Injectable, NotFoundException } from '@nestjs/common';
import { AutoresponderModel } from './autoresponder.model';
import { toAutoresponderRow } from './autoresponder.mapper';
import { type AutoresponderRow } from './autoresponder.entity';

export { AutoresponderRow };

function parseMediaPayload(data: Record<string, unknown>): {
  mediaBuffer?: Buffer | null;
  mediaMime?: string | null;
  mediaFileName?: string | null;
} {
  const rawData = data.mediaData !== undefined ? data.mediaData : data.media_data;
  const rawMime = data.mediaMime !== undefined ? data.mediaMime : data.media_mime;
  const rawName = data.mediaFileName !== undefined ? data.mediaFileName : data.media_file_name;

  let mediaBuffer: Buffer | null | undefined = undefined;
  let mediaMime = rawMime ? String(rawMime) : null;
  let mediaFileName = rawName ? String(rawName) : null;

  if (rawData === null || rawData === '') {
    mediaBuffer = null;
    mediaMime = null;
    mediaFileName = null;
  } else if (typeof rawData === 'string' && rawData.trim()) {
    const trimmed = rawData.trim();
    const match = trimmed.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      if (!mediaMime) mediaMime = match[1];
      mediaBuffer = Buffer.from(match[2], 'base64');
    } else {
      mediaBuffer = Buffer.from(trimmed, 'base64');
    }
  } else if (Buffer.isBuffer(rawData)) {
    mediaBuffer = rawData;
  } else if (rawData instanceof Uint8Array) {
    mediaBuffer = Buffer.from(rawData);
  }

  return { mediaBuffer, mediaMime, mediaFileName };
}

/**
 * CRUD service for custom commands and keyword auto-responders.
 */
@Injectable()
export class AutoresponderService {
  constructor(private readonly autoresponderModel: AutoresponderModel) {}

  /**
   * Lists autoresponder rules for a bot.
   */
  async list(botId: string): Promise<AutoresponderRow[]> {
    const list = await this.autoresponderModel.list(botId);
    return list.map(toAutoresponderRow);
  }

  /**
   * Creates a rule.
   */
  async create(botId: string, data: Record<string, unknown>): Promise<AutoresponderRow> {
    const rawChatId = data.chatId !== undefined ? data.chatId : data.chat_id;
    const { mediaBuffer, mediaMime, mediaFileName } = parseMediaPayload(data);
    const item = await this.autoresponderModel.create({
      botId,
      command: String(data.command ?? ''),
      responseText: String(data.responseText ?? data.response_text ?? ''),
      mediaUrl: (data.mediaUrl as string) ?? (data.media_url as string) ?? null,
      buttonsJson: data.buttons
        ? JSON.stringify(data.buttons)
        : ((data.buttonsJson as string) ?? (data.buttons_json as string) ?? null),
      isActive: data.isActive === false || data.is_active === 0 ? 0 : 1,
      chatId:
        rawChatId !== undefined && rawChatId !== null && String(rawChatId).trim() !== ''
          ? String(rawChatId).trim()
          : null,
      scope: String(data.scope ?? 'all'),
      matchMode: String(data.matchMode ?? data.match_mode ?? 'keyword'),
      adminOnly: data.adminOnly === true || data.adminOnly === 1 || data.admin_only === 1 ? 1 : 0,
      repeatSeconds: Number(data.repeatSeconds ?? data.repeat_seconds ?? 0),
      deletePreviousResponse:
        data.deletePreviousResponse === true ||
        data.deletePreviousResponse === 1 ||
        data.delete_previous_response === 1 ||
        data.delete_previous_response === true
          ? 1
          : 0,
      replyToMessage:
        data.replyToMessage === true ||
        data.replyToMessage === 1 ||
        data.reply_to_message === 1 ||
        data.reply_to_message === true
          ? 1
          : 0,
      mediaData: mediaBuffer ?? null,
      mediaMime: mediaMime ?? null,
      mediaFileName: mediaFileName ?? null,
    });
    return toAutoresponderRow(item);
  }

  /**
   * Updates a rule.
   */
  async update(
    botId: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<AutoresponderRow> {
    const existing = await this.findOne(botId, id);
    const rawChatId = data.chatId !== undefined ? data.chatId : data.chat_id;
    const { mediaBuffer, mediaMime, mediaFileName } = parseMediaPayload(data);
    const updated = await this.autoresponderModel.update(id, {
      command: data.command !== undefined ? String(data.command) : existing.command,
      responseText:
        data.responseText !== undefined
          ? String(data.responseText)
          : data.response_text !== undefined
            ? String(data.response_text)
            : existing.response_text,
      mediaUrl:
        data.mediaUrl !== undefined
          ? (data.mediaUrl as string) || null
          : data.media_url !== undefined
            ? (data.media_url as string) || null
            : existing.media_url,
      buttonsJson:
        data.buttons !== undefined
          ? JSON.stringify(data.buttons)
          : data.buttonsJson !== undefined
            ? (data.buttonsJson as string)
            : data.buttons_json !== undefined
              ? (data.buttons_json as string)
              : existing.buttons_json,
      isActive:
        data.isActive !== undefined
          ? data.isActive
            ? 1
            : 0
          : data.is_active !== undefined
            ? data.is_active
              ? 1
              : 0
            : existing.is_active,
      chatId:
        rawChatId !== undefined
          ? rawChatId !== null && String(rawChatId).trim() !== ''
            ? String(rawChatId).trim()
            : null
          : existing.chat_id,
      scope: data.scope !== undefined ? String(data.scope) : existing.scope,
      matchMode:
        data.matchMode !== undefined
          ? String(data.matchMode)
          : data.match_mode !== undefined
            ? String(data.match_mode)
            : existing.match_mode,
      adminOnly:
        data.adminOnly !== undefined
          ? data.adminOnly === true || data.adminOnly === 1
            ? 1
            : 0
          : data.admin_only !== undefined
            ? data.admin_only === 1
              ? 1
              : 0
            : existing.admin_only,
      repeatSeconds:
        data.repeatSeconds !== undefined
          ? Number(data.repeatSeconds)
          : data.repeat_seconds !== undefined
            ? Number(data.repeat_seconds)
            : existing.repeat_seconds,
      deletePreviousResponse:
        data.deletePreviousResponse !== undefined
          ? data.deletePreviousResponse === true || data.deletePreviousResponse === 1
            ? 1
            : 0
          : data.delete_previous_response !== undefined
            ? data.delete_previous_response === 1 || data.delete_previous_response === true
              ? 1
              : 0
            : existing.delete_previous_response,
      replyToMessage:
        data.replyToMessage !== undefined
          ? data.replyToMessage === true || data.replyToMessage === 1
            ? 1
            : 0
          : data.reply_to_message !== undefined
            ? data.reply_to_message === true || data.reply_to_message === 1
              ? 1
              : 0
            : existing.reply_to_message,
      ...(mediaBuffer !== undefined
        ? {
            mediaData: mediaBuffer,
            mediaMime,
            mediaFileName,
          }
        : {}),
    });
    return toAutoresponderRow(updated);
  }

  /**
   * Fetches raw media bytes or URL for a rule.
   */
  async getMediaFile(
    botId: string,
    id: string,
  ): Promise<{ data: Buffer | null; mime: string | null; url: string | null } | null> {
    const item = await this.autoresponderModel.findById(botId, id);
    if (!item) return null;
    if (item.mediaData && (item.mediaData as Buffer).length > 0) {
      return {
        data: Buffer.from(item.mediaData),
        mime: item.mediaMime || 'image/jpeg',
        url: null,
      };
    }
    if (item.mediaUrl) {
      return {
        data: null,
        mime: item.mediaMime || null,
        url: item.mediaUrl,
      };
    }
    return null;
  }

  /**
   * Deletes a rule.
   */
  async remove(botId: string, id: string): Promise<void> {
    await this.findOne(botId, id);
    await this.autoresponderModel.delete(id);
  }

  /**
   * Fetches one rule scoped to a bot.
   */
  async findOne(botId: string, id: string): Promise<AutoresponderRow> {
    const item = await this.autoresponderModel.findById(botId, id);
    if (!item) throw new NotFoundException(`Autoresponder ${id} not found`);
    return toAutoresponderRow(item);
  }
}
