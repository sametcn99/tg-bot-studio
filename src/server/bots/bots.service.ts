import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { BotPoolService } from '../bot-engine/bot-pool.service';
import { MODULE_REGISTRY, findModule } from '../bot-engine/module-registry';
import { callGetMe } from '../common/utils/telegram.util';
import type { CreateBotDto, UpdateBotDto, UpdateModuleStateDto } from './dto/bots.dto';

/**
 * Bot row with runtime enrichment for the dashboard.
 * @interface BotWithStatus
 * @property {number} id - Studio bot identifier.
 * @property {string} name - Display name.
 * @property {string} username - Bot @username.
 * @property {number} is_active - Enabled flag.
 * @property {string} created_at - ISO creation timestamp.
 * @property {string} status - Runtime health (active/failed/inactive/...).
 * @property {number} activeModules - Count of enabled modules.
 * @property {number} miniApps - Count of hosted Mini Apps.
 * @property {number} subscribers - Rows in bot_users.
 * @property {number} dailyVolume - Messages in the current UTC day.
 */
export interface BotWithStatus {
  id: number;
  name: string;
  token: string;
  username: string | null;
  first_name: string | null;
  is_active: number;
  created_at: string | null;
  status: string;
  activeModules: number;
  miniApps: number;
  subscribers: number;
  dailyVolume: number;
}

/**
 * Bot CRUD and per-bot module toggle management.
 */
@Injectable()
export class BotsService {
  /**
   * @param {DatabaseService} db - SQLite access service.
   * @param {BotPoolService} pool - Multi-bot runtime pool.
   */
  constructor(
    private readonly db: DatabaseService,
    private readonly pool: BotPoolService,
  ) {}

  /**
   * Lists all bots enriched with runtime status and audience metrics.
   * @returns {BotWithStatus[]} All registered bots.
   */
  findAll(): BotWithStatus[] {
    const rows = this.db.query<{
      id: number;
      name: string;
      token: string;
      username: string | null;
      first_name: string | null;
      is_active: number;
      created_at: string | null;
    }>('SELECT * FROM bots ORDER BY id');

    return rows.map((row) => {
      const activeModules =
        this.db.get<{ count: number }>(
          'SELECT COUNT(*) as count FROM bot_modules WHERE bot_id = ? AND is_enabled = 1',
          row.id,
        )?.count ?? 0;
      const miniApps =
        this.db.get<{ count: number }>(
          'SELECT COUNT(*) as count FROM mini_apps WHERE bot_id = ?',
          row.id,
        )?.count ?? 0;
      const subscribers =
        this.db.get<{ count: number }>(
          'SELECT COUNT(*) as count FROM bot_users WHERE bot_id = ?',
          row.id,
        )?.count ?? 0;
      return {
        ...row,
        status: this.pool.getStatus(row.id, row.is_active === 1),
        activeModules,
        miniApps,
        subscribers,
        dailyVolume: this.pool.getDailyVolume(row.id),
      };
    });
  }

  /**
   * Fetches a single bot with metrics.
   * @param {number} id - Studio bot identifier.
   * @returns {BotWithStatus} Enriched bot record.
   * @throws {NotFoundException} When the bot does not exist.
   */
  findOne(id: number): BotWithStatus {
    return this.findAll().find((bot) => bot.id === id) ?? this.throwNotFound(id);
  }

  /**
   * Throws the shared not-found error for a bot id.
   * @param {number} id - Studio bot identifier.
   * @throws {NotFoundException} Always.
   */
  private throwNotFound(id: number): never {
    throw new NotFoundException(`Bot ${id} not found`);
  }

  /**
   * Registers a bot after validating its token against Telegram `getMe`.
   * @param {CreateBotDto} dto - Token and optional display name.
   * @returns {Promise<BotWithStatus>} The created bot with metrics.
   * @throws {BadRequestException} When Telegram rejects the token.
   */
  async create(dto: CreateBotDto): Promise<BotWithStatus> {
    const check = await callGetMe(dto.token);
    if (!check.ok || !check.bot) {
      throw new BadRequestException(
        `Telegram rejected the token: ${check.description ?? 'unknown error'}`,
      );
    }
    if (this.db.get('SELECT 1 FROM bots WHERE token = ?', dto.token)) {
      throw new BadRequestException('This bot token is already registered');
    }
    const now = new Date().toISOString();
    const result = this.db.run(
      'INSERT INTO bots (name, token, username, first_name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
      dto.name || check.bot.first_name,
      dto.token,
      check.bot.username,
      check.bot.first_name,
      now,
      now,
    );
    const id = Number(result.lastInsertRowid);
    await this.pool.restartBot(id);
    return this.findOne(id);
  }

  /**
   * Updates bot metadata or enabled state, restarting the poller as needed.
   * @param {number} id - Studio bot identifier.
   * @param {UpdateBotDto} dto - Patch fields.
   * @returns {Promise<BotWithStatus>} Updated bot record.
   * @throws {NotFoundException} When the bot does not exist.
   */
  async update(id: number, dto: UpdateBotDto): Promise<BotWithStatus> {
    const row = this.db.get('SELECT id FROM bots WHERE id = ?', id);
    if (!row) throw new NotFoundException(`Bot ${id} not found`);
    if (dto.name !== undefined) {
      this.db.run('UPDATE bots SET name = ?, updated_at = ? WHERE id = ?', dto.name, new Date().toISOString(), id);
    }
    if (dto.isActive !== undefined) {
      this.db.run('UPDATE bots SET is_active = ?, updated_at = ? WHERE id = ?', dto.isActive ? 1 : 0, new Date().toISOString(), id);
    }
    await this.pool.restartBot(id);
    return this.findOne(id);
  }

  /**
   * Deletes a bot, stops its poller, and purges every bot-scoped row.
   * @param {number} id - Studio bot identifier.
   * @returns {Promise<void>} Resolves once fully removed.
   */
  async remove(id: number): Promise<void> {
    this.pool.destroyBot(id);
    const tables = [
      'bot_modules', 'mini_apps', 'mini_app_orders', 'bot_settings', 'bot_users',
      'links', 'broadcasts', 'support_messages', 'drip_campaigns', 'drip_subscribers',
      'giveaways', 'scheduled_posts', 'blocked_users', 'bot_groups', 'chat_connections',
      'autoresponders', 'vip_subscriptions',
    ] as const;
    for (const table of tables) {
      this.db.run(`DELETE FROM ${table} WHERE bot_id = ?`, id);
    }
    this.db.run('DELETE FROM bots WHERE id = ?', id);
  }

  /**
   * Lists every module with its effective state and config for a bot.
   * @param {number} botId - Studio bot identifier.
   * @returns {Array<object>} Registry entries merged with persisted state.
   */
  listModules(botId: number): Array<Record<string, unknown>> {
    const rows = this.db.query<{ module_key: string; is_enabled: number; config_json: string | null }>(
      'SELECT module_key, is_enabled, config_json FROM bot_modules WHERE bot_id = ?',
      botId,
    );
    const byKey = new Map(rows.map((row) => [row.module_key, row]));
    return MODULE_REGISTRY.map((definition) => {
      const row = byKey.get(definition.key);
      const stored = row?.config_json ? (JSON.parse(row.config_json) as Record<string, unknown>) : {};
      return {
        key: definition.key,
        name: definition.name,
        category: definition.category,
        description: definition.description,
        isEnabled: Boolean(row?.is_enabled),
        config: { ...definition.defaultConfig, ...stored },
      };
    });
  }

  /**
   * Toggles or reconfigures a module and hot-reloads the bot runtime.
   * @param {number} botId - Studio bot identifier.
   * @param {string} moduleKey - Module registry key.
   * @param {UpdateModuleStateDto} dto - Enabled flag and config payload.
   * @returns {Promise<object>} Updated module descriptor.
   * @throws {NotFoundException} When bot or module key is unknown.
   */
  async updateModule(
    botId: number,
    moduleKey: string,
    dto: UpdateModuleStateDto,
  ): Promise<Record<string, unknown>> {
    if (!this.db.get('SELECT 1 FROM bots WHERE id = ?', botId)) {
      throw new NotFoundException(`Bot ${botId} not found`);
    }
    const definition = findModule(moduleKey);
    if (!definition) throw new NotFoundException(`Module ${moduleKey} not found`);

    this.db.run(
      `INSERT INTO bot_modules (bot_id, module_key, is_enabled, config_json) VALUES (?, ?, ?, ?)
       ON CONFLICT(bot_id, module_key) DO UPDATE SET is_enabled = excluded.is_enabled, config_json = excluded.config_json`,
      botId,
      moduleKey,
      dto.isEnabled ? 1 : 0,
      JSON.stringify(dto.config ?? {}),
    );
    await this.pool.restartBot(botId);
    return this.listModules(botId).find((module) => module.key === moduleKey)!;
  }
}
