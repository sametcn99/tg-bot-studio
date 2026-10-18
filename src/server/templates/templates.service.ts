import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { BotTemplateModel } from './bot-template.model';
import { BotsService } from '../bots/bots.service';
import { LiveEventsService } from '../common/live/live-events.service';

/** Client-facing template row with bundle summary. */
export interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  sourceBotName: string | null;
  createdAt: string | null;
  moduleCount: number;
  autoresponderCount: number;
  dripCount: number;
  miniAppCount: number;
}

/**
 * Template gallery service: stores full-bot configuration bundles (same
 * shape as the export/import JSON) and applies them to any bot in one click.
 */
@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  /**
   * @param {BotTemplateModel} templateModel - Template persistence.
   * @param {BotsService} botsService - Reused bot import pipeline.
   * @param {LiveEventsService} live - Live change bus for SSE pings.
   */
  constructor(
    private readonly templateModel: BotTemplateModel,
    private readonly botsService: BotsService,
    private readonly live: LiveEventsService,
  ) {}

  /**
   * Lists every saved template with a bundle summary.
   * @returns {Promise<TemplateRow[]>} Templates, newest first.
   */
  async list(): Promise<TemplateRow[]> {
    const rows = await this.templateModel.list();
    return rows.map((row) => {
      const bundle = this.parseBundle(row.bundleJson);
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        sourceBotName: row.sourceBotName,
        createdAt: row.createdAt,
        moduleCount: Array.isArray(bundle.modules) ? bundle.modules.length : 0,
        autoresponderCount: Array.isArray(bundle.autoresponders) ? bundle.autoresponders.length : 0,
        dripCount: Array.isArray(bundle.dripCampaigns) ? bundle.dripCampaigns.length : 0,
        miniAppCount: Array.isArray(bundle.miniApps) ? bundle.miniApps.length : 0,
      };
    });
  }

  /**
   * Fetches the raw bundle of a template (download support).
   */
  async getBundle(id: string): Promise<Record<string, unknown>> {
    const row = await this.templateModel.findById(id);
    return this.parseBundle(row.bundleJson);
  }

  /**
   * Saves a template from an export bundle.
   * @param {object} body - name, description, bundle, sourceBotName.
   * @returns {Promise<TemplateRow>} Created template summary.
   */
  async create(body: Record<string, unknown>): Promise<TemplateRow> {
    const name = String(body.name ?? '').trim();
    if (!name) throw new BadRequestException('name is required');
    const bundle = body.bundle as Record<string, unknown> | undefined;
    if (!bundle || typeof bundle !== 'object' || !Array.isArray(bundle.modules)) {
      throw new BadRequestException('bundle must be an export JSON with a modules array');
    }
    const created = await this.templateModel.create({
      name,
      description: body.description ? String(body.description) : null,
      bundleJson: JSON.stringify(bundle),
      sourceBotName: body.sourceBotName ? String(body.sourceBotName) : null,
    });
    this.live.emit('templates', '');
    this.logger.log(`Template "${name}" saved (${created.id})`);
    return (await this.list()).find((row) => row.id === created.id)!;
  }

  /**
   * Deletes a template.
   */
  async remove(id: string): Promise<{ success: boolean }> {
    await this.templateModel.remove(id);
    this.live.emit('templates', '');
    return { success: true };
  }

  /**
   * Applies a template to a bot through the standard import pipeline.
   * @param {number} botId - Target bot id.
   * @param {number} templateId - Template id.
   * @returns {Promise<object>} Import result.
   */
  async apply(
    botId: string,
    templateId: string,
  ): Promise<{ success: boolean; importedModules: number }> {
    const row = await this.templateModel.findById(templateId);
    const bundle = this.parseBundle(row.bundleJson);
    const result = await this.botsService.importConfig(botId, bundle);
    this.logger.log(`Template "${row.name}" applied to bot ${botId}`);
    return result;
  }

  /**
   * Parses a stored bundle with a safe fallback.
   */
  private parseBundle(raw: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
}
