import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * Autoresponder row in the `autoresponders` table.
 * @interface AutoresponderRow
 * @property {number} id - Rule identifier.
 * @property {number} bot_id - Owning bot id.
 * @property {string} command - `/command` or plain keyword trigger.
 * @property {string} response_text - Rendered reply text (placeholders allowed).
 * @property {string} [media_url] - Optional photo URL sent with the reply.
 * @property {string} [buttons_json] - JSON rows of `{text, url}` buttons.
 * @property {number} is_active - Enabled flag.
 */
export interface AutoresponderRow {
  id: number;
  bot_id: number;
  command: string;
  response_text: string;
  media_url: string | null;
  buttons_json: string | null;
  is_active: number;
}

/**
 * CRUD service for custom commands and keyword auto-responders.
 */
@Injectable()
export class AutoresponderService {
  /**
   * @param {DatabaseService} db - SQLite access service.
   */
  constructor(private readonly db: DatabaseService) {}

  /**
   * Lists autoresponder rules for a bot.
   * @param {number} botId - Owning bot id.
   * @returns {AutoresponderRow[]} All rules.
   */
  list(botId: number): AutoresponderRow[] {
    return this.db.query<AutoresponderRow>(
      'SELECT * FROM autoresponders WHERE bot_id = ? ORDER BY id',
      botId,
    );
  }

  /**
   * Creates a rule.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} data - command, responseText, mediaUrl, buttons.
   * @returns {AutoresponderRow} Created rule.
   */
  create(botId: number, data: Record<string, unknown>): AutoresponderRow {
    const result = this.db.run(
      'INSERT INTO autoresponders (bot_id, command, response_text, media_url, buttons_json, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      botId,
      String(data.command ?? ''),
      String(data.responseText ?? ''),
      (data.mediaUrl as string) || null,
      data.buttons ? JSON.stringify(data.buttons) : null,
      data.isActive === false ? 0 : 1,
    );
    return this.findOne(botId, Number(result.lastInsertRowid));
  }

  /**
   * Updates a rule.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Rule identifier.
   * @param {Record<string, unknown>} data - Patch fields.
   * @returns {AutoresponderRow} Updated rule.
   * @throws {NotFoundException} When the rule does not exist.
   */
  update(botId: number, id: number, data: Record<string, unknown>): AutoresponderRow {
    const existing = this.findOne(botId, id);
    this.db.run(
      'UPDATE autoresponders SET command = ?, response_text = ?, media_url = ?, buttons_json = ?, is_active = ? WHERE id = ?',
      String(data.command ?? existing.command),
      String(data.responseText ?? existing.response_text),
      (data.mediaUrl as string) ?? existing.media_url,
      data.buttons ? JSON.stringify(data.buttons) : existing.buttons_json,
      data.isActive === undefined ? existing.is_active : data.isActive ? 1 : 0,
      id,
    );
    return this.findOne(botId, id);
  }

  /**
   * Deletes a rule.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Rule identifier.
   * @returns {void}
   * @throws {NotFoundException} When the rule does not exist.
   */
  remove(botId: number, id: number): void {
    this.findOne(botId, id);
    this.db.run('DELETE FROM autoresponders WHERE id = ?', id);
  }

  /**
   * Fetches one rule scoped to a bot.
   * @param {number} botId - Owning bot id.
   * @param {number} id - Rule identifier.
   * @returns {AutoresponderRow} The rule row.
   * @throws {NotFoundException} When not found.
   */
  findOne(botId: number, id: number): AutoresponderRow {
    const row = this.db.get<AutoresponderRow>(
      'SELECT * FROM autoresponders WHERE bot_id = ? AND id = ?',
      botId,
      id,
    );
    if (!row) throw new NotFoundException(`Autoresponder ${id} not found`);
    return row;
  }
}
