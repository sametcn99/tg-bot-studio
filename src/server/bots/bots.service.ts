import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { BotPoolService } from '../bot-engine/bot-pool.service';
import { MODULE_REGISTRY, findModule } from '../bot-engine/module-registry';
import { callGetMe } from '../common/utils/telegram.util';
import { AiAssistantService } from '../modules/ai-assistant/ai-assistant.service';
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
    private readonly aiService: AiAssistantService,
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
      'autoresponders', 'vip_subscriptions', 'chat_activity', 'score_schedules',
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

  /**
   * Runs diagnostic health checks on bot permissions and runtime status.
   * @param {number} botId - Studio bot identifier.
   * @returns {Promise<object>} Diagnostic report with actionable recommendations.
   */
  async getDiagnostics(botId: number): Promise<Record<string, unknown>> {
    const row = this.db.get<{ id: number; name: string; token: string; is_active: number }>(
      'SELECT id, name, token, is_active FROM bots WHERE id = ?',
      botId,
    );
    if (!row) throw new NotFoundException(`Bot ${botId} not found`);

    const check = await callGetMe(row.token);
    const runtimeStatus = this.pool.getStatus(botId, row.is_active === 1);
    const groupCount =
      this.db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM chat_connections WHERE bot_id = ? AND is_active = 1',
        botId,
      )?.count ?? 0;
    const activeModules = this.listModules(botId).filter((m) => m.isEnabled);

    const checks: Array<{ key: string; title: string; status: 'pass' | 'warning' | 'error' | 'info'; details: string }> = [];
    const recommendations: string[] = [];

    // 1. Telegram API connectivity
    if (check.ok && check.bot) {
      checks.push({
        key: 'token',
        title: 'Telegram API Connectivity',
        status: 'pass',
        details: `@${check.bot.username} is responsive to Telegram API.`,
      });
    } else {
      checks.push({
        key: 'token',
        title: 'Telegram API Connectivity',
        status: 'error',
        details: check.description || 'Bot token rejected or Telegram API unreachable.',
      });
      recommendations.push('Verify your BotFather token or generate a new one via @BotFather.');
    }

    // 2. Runtime engine status
    if (runtimeStatus === 'active') {
      checks.push({
        key: 'runtime',
        title: 'Studio Runtime Poller',
        status: 'pass',
        details: 'Long-polling engine is running and processing updates in real-time.',
      });
    } else {
      checks.push({
        key: 'runtime',
        title: 'Studio Runtime Poller',
        status: 'warning',
        details: `Poller status is "${runtimeStatus}". Updates are currently paused.`,
      });
      recommendations.push('Toggle the bot status switch to Active in the overview.');
    }

    // 3. Group privacy mode
    const canReadAll = Boolean(check.bot?.can_read_all_group_messages);
    const needsAll = activeModules.some((m) =>
      ['message-score', 'moderation', 'welcome'].includes(String(m.key)),
    );
    if (canReadAll) {
      checks.push({
        key: 'privacy_mode',
        title: 'Group Privacy Mode',
        status: 'pass',
        details: 'Privacy Mode is disabled. Bot sees all member messages in groups.',
      });
    } else {
      checks.push({
        key: 'privacy_mode',
        title: 'Group Privacy Mode',
        status: needsAll ? 'warning' : 'info',
        details: 'Privacy Mode is enabled. Bot only sees messages mentioning it unless admin.',
      });
      if (needsAll) {
        recommendations.push(
          'For Message Score and Moderation modules: open @BotFather -> /setprivacy -> Choose bot -> Disable.',
        );
      }
    }

    // 4. Chat connections
    if (groupCount > 0) {
      checks.push({
        key: 'connections',
        title: 'Chat Connections Address Book',
        status: 'pass',
        details: `${groupCount} group(s)/channel(s) connected and available for targeting.`,
      });
    } else {
      checks.push({
        key: 'connections',
        title: 'Chat Connections Address Book',
        status: 'warning',
        details: 'No channels or groups connected yet. Schedulers and Giveaways need target chats.',
      });
      recommendations.push('Add your channels or press "Sync from bot" in Chat Connections.');
    }

    return {
      ok: true,
      botId,
      botInfo: check.bot,
      runtimeStatus,
      checks,
      recommendations,
    };
  }

  /**
   * Applies a coordinated starter feature bundle in one click.
   * @param {number} botId - Studio bot identifier.
   * @param {string} presetKey - Bundle key (ecommerce/community/support/growth).
   * @returns {Promise<object>} Result and enabled module keys.
   */
  async applyPreset(botId: number, presetKey: string): Promise<Record<string, unknown>> {
    if (!this.db.get('SELECT 1 FROM bots WHERE id = ?', botId)) {
      throw new NotFoundException(`Bot ${botId} not found`);
    }

    const presetBundles: Record<string, string[]> = {
      ecommerce: ['start-menu', 'mini-apps', 'support', 'paid-media'],
      community: ['welcome', 'captcha', 'moderation', 'message-score', 'giveaways'],
      support: ['support', 'ai-assistant', 'autoresponder'],
      growth: ['referrals', 'broadcast', 'drip', 'quizzes'],
    };

    const modulesToEnable = presetBundles[presetKey];
    if (!modulesToEnable) {
      throw new BadRequestException(`Unknown preset bundle: ${presetKey}`);
    }

    for (const key of modulesToEnable) {
      const definition = findModule(key);
      this.db.run(
        `INSERT INTO bot_modules (bot_id, module_key, is_enabled, config_json) VALUES (?, ?, 1, ?)
         ON CONFLICT(bot_id, module_key) DO UPDATE SET is_enabled = 1`,
        botId,
        key,
        JSON.stringify(definition?.defaultConfig ?? {}),
      );
    }

    await this.pool.restartBot(botId);
    return {
      success: true,
      presetKey,
      enabledModules: modulesToEnable,
    };
  }

  /**
   * Simulates an incoming Telegram message dispatch for in-studio sandbox testing.
   * @param {number} botId - Studio bot identifier.
   * @param {string} text - Message text or command.
   * @returns {Promise<object>} Simulated bot response (text, photo, buttons).
   */
  async simulateMessage(botId: number, text: string): Promise<{
    text: string;
    mediaUrl?: string | null;
    buttons?: Array<{ text: string; url?: string }>;
  }> {
    const row = this.db.get<{ id: number; token: string; name: string }>(
      'SELECT id, token, name FROM bots WHERE id = ?',
      botId,
    );
    if (!row) throw new NotFoundException(`Bot ${botId} not found`);

    const trimmed = text.trim();
    const lower = trimmed.toLowerCase();

    // 1. Check Start Menu (/start or /menu)
    if (trimmed.startsWith('/start') || trimmed.startsWith('/menu')) {
      const startMenuModule = this.db.get<{ is_enabled: number; config_json: string | null }>(
        "SELECT is_enabled, config_json FROM bot_modules WHERE bot_id = ? AND module_key = 'start-menu'",
        botId,
      );
      if (startMenuModule?.is_enabled) {
        const config = startMenuModule.config_json ? (JSON.parse(startMenuModule.config_json) as Record<string, unknown>) : {};
        const menuItems = this.db.query<{ title: string; url: string; type: string }>(
          'SELECT title, url, type FROM links WHERE bot_id = ? AND is_active = 1 ORDER BY order_index ASC',
          botId,
        );
        const startMessage = String(config.startMessage || `Welcome to ${row.name}! Choose an option below:`);
        const buttons = menuItems.map((item) => ({
          text: item.title,
          url: item.url,
        }));
        return {
          text: startMessage.replace('{first_name}', 'Tester').replace('{username}', 'studio_test'),
          buttons,
        };
      }
    }

    // 2. Check Autoresponder (slash commands and keyword triggers)
    const autoresponderModule = this.db.get<{ is_enabled: number }>(
      "SELECT is_enabled FROM bot_modules WHERE bot_id = ? AND module_key = 'autoresponder'",
      botId,
    );
    if (autoresponderModule?.is_enabled) {
      const rules = this.db.query<{
        command: string;
        response_text: string;
        media_url: string | null;
        buttons_json: string | null;
      }>(
        'SELECT command, response_text, media_url, buttons_json FROM autoresponders WHERE bot_id = ? AND is_active = 1',
        botId,
      );
      const cmdText = trimmed.split(/[\s@]/)[0].toLowerCase();
      const matched =
        rules.find((r) => r.command.startsWith('/') && r.command.toLowerCase() === cmdText) ??
        rules.find((r) => !r.command.startsWith('/') && lower.includes(r.command.toLowerCase()));

      if (matched) {
        let buttons: Array<{ text: string; url?: string }> = [];
        if (matched.buttons_json) {
          try {
            buttons = JSON.parse(matched.buttons_json) as Array<{ text: string; url?: string }>;
          } catch {
            // ignore
          }
        }
        return {
          text: matched.response_text.replace('{first_name}', 'Tester').replace('{username}', 'studio_test'),
          mediaUrl: matched.media_url,
          buttons,
        };
      }
    }

    // 3. Check AI Assistant (with RAG retrieval)
    const aiModule = this.db.get<{ is_enabled: number; config_json: string | null }>(
      "SELECT is_enabled, config_json FROM bot_modules WHERE bot_id = ? AND module_key = 'ai-assistant'",
      botId,
    );
    if (aiModule?.is_enabled) {
      const config = aiModule.config_json ? (JSON.parse(aiModule.config_json) as Record<string, unknown>) : {};
      if (config.apiKey) {
        try {
          const reply = await this.aiService.completeWithContext(
            botId,
            999999, // sandbox simulator user id
            config as any,
            [{ role: 'user', content: trimmed }],
          );
          return { text: reply };
        } catch (err: unknown) {
          return { text: `[AI Error]: ${err instanceof Error ? err.message : String(err)}` };
        }
      } else {
        return { text: 'AI Assistant module is enabled, but no API key is set in configuration.' };
      }
    }

    // 4. Default echo response
    return {
      text: `Message received: "${trimmed}". (No matching command, auto-responder, or AI rule found). Try typing /start.`,
    };
  }
}

