import { Injectable, NotFoundException } from '@nestjs/common';
import { AutoresponderModel } from './autoresponder.model';
import { toAutoresponderRow } from './autoresponder.mapper';
import { type AutoresponderRow } from './autoresponder.entity';

export { AutoresponderRow };

/**
 * CRUD service for custom commands and keyword auto-responders.
 */
@Injectable()
export class AutoresponderService {
  constructor(private readonly autoresponderModel: AutoresponderModel) {}

  /**
   * Lists autoresponder rules for a bot.
   */
  async list(botId: number): Promise<AutoresponderRow[]> {
    const list = await this.autoresponderModel.list(botId);
    return list.map(toAutoresponderRow);
  }

  /**
   * Creates a rule.
   */
  async create(botId: number, data: Record<string, unknown>): Promise<AutoresponderRow> {
    const item = await this.autoresponderModel.create({
      botId,
      command: String(data.command ?? ''),
      responseText: String(data.responseText ?? data.response_text ?? ''),
      mediaUrl: (data.mediaUrl as string) ?? (data.media_url as string) ?? null,
      buttonsJson: data.buttons
        ? JSON.stringify(data.buttons)
        : ((data.buttonsJson as string) ?? (data.buttons_json as string) ?? null),
      isActive: data.isActive === false || data.is_active === 0 ? 0 : 1,
    });
    return toAutoresponderRow(item);
  }

  /**
   * Updates a rule.
   */
  async update(
    botId: number,
    id: number,
    data: Record<string, unknown>,
  ): Promise<AutoresponderRow> {
    const existing = await this.findOne(botId, id);
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
    });
    return toAutoresponderRow(updated);
  }

  /**
   * Deletes a rule.
   */
  async remove(botId: number, id: number): Promise<void> {
    await this.findOne(botId, id);
    await this.autoresponderModel.delete(id);
  }

  /**
   * Fetches one rule scoped to a bot.
   */
  async findOne(botId: number, id: number): Promise<AutoresponderRow> {
    const item = await this.autoresponderModel.findById(botId, id);
    if (!item) throw new NotFoundException(`Autoresponder ${id} not found`);
    return toAutoresponderRow(item);
  }
}
