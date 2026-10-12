import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { SystemSettingsService } from '../../database/system-settings.service';
import { BotPoolService } from '../../bot-engine/bot-pool.service';
import { WebhooksService } from '../webhooks/webhooks.service';

/**
 * Mini App row in the `mini_apps` table.
 * @interface MiniAppRow
 * @property {number} id - App identifier.
 * @property {number} bot_id - Owning bot id.
 * @property {string} name - Operator-chosen name.
 * @property {string} slug - URL segment under `/tma/`.
 * @property {string} template_type - One of the five template types.
 * @property {string} title - In-app display title.
 * @property {string} [description] - In-app description.
 * @property {string} [icon_url] - Optional icon URL.
 * @property {string} [config_json] - Template configuration.
 * @property {string} [theme_json] - Theme overrides.
 * @property {number} is_active - Enabled flag.
 */
export interface MiniAppRow {
  id: number;
  bot_id: number;
  name: string;
  slug: string;
  template_type: string;
  title: string;
  description: string | null;
  icon_url: string | null;
  config_json: string | null;
  theme_json: string | null;
  is_active: number;
  created_at: string | null;
  updated_at: string | null;
}

/** Allowed Mini App template types. */
const TEMPLATE_TYPES = ['ecommerce', 'loyalty', 'forms', 'spin', 'webview'] as const;

/**
 * Mini App studio service: CRUD, one-click chat menu button publishing,
 * orders, loyalty points with daily check-in, and form submissions.
 */
@Injectable()
export class MiniAppsService {
  /**
   * @param {DatabaseService} db - SQLite access service.
   * @param {SystemSettingsService} settings - Bot settings key-value store.
   * @param {BotPoolService} pool - Multi-bot runtime pool.
   * @param {WebhooksService} webhooks - Outgoing event dispatch.
   */
  constructor(
    private readonly db: DatabaseService,
    private readonly settings: SystemSettingsService,
    private readonly pool: BotPoolService,
    private readonly webhooks: WebhooksService,
  ) {}

  /**
   * Lists Mini Apps for a bot with decoded config.
   * @param {number} botId - Owning bot id.
   * @returns {Array<object>} App rows with parsed config and theme.
   */
  list(botId: number): Array<Record<string, unknown>> {
    const rows = this.db.query<MiniAppRow>(
      'SELECT * FROM mini_apps WHERE bot_id = ? ORDER BY id',
      botId,
    );
    return rows.map((row) => ({
      ...row,
      config: row.config_json ? JSON.parse(row.config_json) : {},
      theme: row.theme_json ? JSON.parse(row.theme_json) : {},
    }));
  }

  /**
   * Creates a Mini App.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} data - name, slug, templateType, title, description, config, theme.
   * @returns {Promise<object>} Created app.
   * @throws {BadRequestException} On invalid template type or duplicate slug.
   */
  async create(botId: number, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const templateType = String(data.templateType ?? '');
    if (!TEMPLATE_TYPES.includes(templateType as (typeof TEMPLATE_TYPES)[number])) {
      throw new BadRequestException(
        `templateType must be one of: ${TEMPLATE_TYPES.join(', ')}`,
      );
    }
    const slug = String(data.slug ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-');
    if (!slug) throw new BadRequestException('slug is required');
    if (this.db.get('SELECT 1 FROM mini_apps WHERE slug = ?', slug)) {
      throw new BadRequestException('slug is already in use');
    }
    const now = new Date().toISOString();
    const result = this.db.run(
      `INSERT INTO mini_apps (bot_id, name, slug, template_type, title, description, icon_url, config_json, theme_json, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      botId,
      String(data.name ?? 'Untitled app'),
      slug,
      templateType,
      String(data.title ?? data.name ?? 'Mini App'),
      (data.description as string) ?? null,
      (data.iconUrl as string) ?? null,
      JSON.stringify(data.config ?? {}),
      JSON.stringify(data.theme ?? {}),
      now,
      now,
    );
    return this.list(botId).find((row) => row.id === Number(result.lastInsertRowid))!;
  }

  /**
   * Updates a Mini App.
   * @param {number} botId - Owning bot id.
   * @param {number} id - App identifier.
   * @param {Record<string, unknown>} data - Patch fields.
   * @returns {Promise<object>} Updated app.
   * @throws {NotFoundException} When the app does not exist.
   */
  async update(
    botId: number,
    id: number,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const existing = this.db.get<MiniAppRow>(
      'SELECT * FROM mini_apps WHERE bot_id = ? AND id = ?',
      botId,
      id,
    );
    if (!existing) throw new NotFoundException(`Mini app ${id} not found`);
    this.db.run(
      'UPDATE mini_apps SET name = ?, title = ?, description = ?, icon_url = ?, config_json = ?, theme_json = ?, is_active = ?, updated_at = ? WHERE id = ?',
      String(data.name ?? existing.name),
      String(data.title ?? existing.title),
      (data.description as string) ?? existing.description,
      (data.iconUrl as string) ?? existing.icon_url,
      data.config ? JSON.stringify(data.config) : existing.config_json,
      data.theme ? JSON.stringify(data.theme) : existing.theme_json,
      data.isActive === undefined ? existing.is_active : data.isActive ? 1 : 0,
      new Date().toISOString(),
      id,
    );
    return this.list(botId).find((row) => row.id === id)!;
  }

  /**
   * Deletes a Mini App.
   * @param {number} botId - Owning bot id.
   * @param {number} id - App identifier.
   * @returns {void}
   * @throws {NotFoundException} When the app does not exist.
   */
  remove(botId: number, id: number): void {
    if (!this.db.get('SELECT id FROM mini_apps WHERE bot_id = ? AND id = ?', botId, id)) {
      throw new NotFoundException(`Mini app ${id} not found`);
    }
    this.db.run('DELETE FROM mini_apps WHERE id = ?', id);
  }

  /**
   * Publishes a Mini App by pointing the chat bottom-left menu button at
   * its public URL via `setChatMenuButton`.
   * @param {number} botId - Owning bot id.
   * @param {number} id - App identifier.
   * @param {string} publicBaseUrl - Publicly reachable base URL of the studio.
   * @returns {Promise<{menuUrl: string}>} The configured menu button URL.
   * @throws {BadRequestException} When the bot is offline or Telegram rejects the call.
   */
  async publish(
    botId: number,
    id: number,
    publicBaseUrl: string,
  ): Promise<{ menuUrl: string }> {
    const app = this.db.get<MiniAppRow>('SELECT * FROM mini_apps WHERE id = ?', id);
    if (!app) throw new NotFoundException(`Mini app ${id} not found`);
    const bot = this.pool.getBot(botId);
    if (!bot) throw new BadRequestException('Bot is not running');
    const base = publicBaseUrl.replace(/\/+$/, '');
    const menuUrl = `${base}/tma/${app.slug}`;
    try {
      await bot.api.setChatMenuButton({
        menu_button: { type: 'web_app', text: app.title.slice(0, 64), web_app: { url: menuUrl } },
      });
    } catch (error) {
      throw new BadRequestException(
        `setChatMenuButton failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { menuUrl };
  }

  /**
   * Fetches the public runtime config for the TMA shell (no secrets).
   * @param {string} slug - Mini App slug.
   * @returns {Record<string, unknown>} Template type, title, config, theme.
   * @throws {NotFoundException} When the app is unknown or inactive.
   */
  getPublicConfig(slug: string): Record<string, unknown> {
    const app = this.db.get<MiniAppRow>(
      'SELECT * FROM mini_apps WHERE slug = ? AND is_active = 1',
      slug,
    );
    if (!app) throw new NotFoundException('Mini App not found');
    return {
      slug: app.slug,
      templateType: app.template_type,
      title: app.title,
      description: app.description,
      config: app.config_json ? JSON.parse(app.config_json) : {},
      theme: app.theme_json ? JSON.parse(app.theme_json) : {},
    };
  }

  /**
   * Reads loyalty points for a Mini App user (bot-scoped).
   * @param {number} botId - Owning bot id.
   * @param {number} telegramId - User Telegram id.
   * @returns {object} Balance and check-in status.
   */
  getLoyalty(botId: number, telegramId: number): Record<string, unknown> {
    const user = this.db.get<{ points: number }>(
      'SELECT points FROM bot_users WHERE bot_id = ? AND telegram_id = ?',
      botId,
      telegramId,
    );
    const today = new Date().toISOString().slice(0, 10);
    const lastCheckin = this.settings.getBotJson<string>(
      botId,
      `checkin_${telegramId}`,
    );
    return {
      points: user?.points ?? 0,
      checkedInToday: lastCheckin === today,
    };
  }

  /**
   * Performs the daily check-in, awarding the configured points.
   * @param {number} botId - Owning bot id.
   * @param {number} telegramId - User Telegram id.
   * @returns {object} Updated balance and award.
   * @throws {BadRequestException} When already checked in today.
   */
  checkin(botId: number, telegramId: number): Record<string, unknown> {
    const today = new Date().toISOString().slice(0, 10);
    const key = `checkin_${telegramId}`;
    if (this.settings.getBotJson<string>(botId, key) === today) {
      throw new BadRequestException('Already checked in today');
    }
    this.settings.setBotJson(botId, key, today);
    const award = 5;
    this.db.run(
      'UPDATE bot_users SET points = points + ? WHERE bot_id = ? AND telegram_id = ?',
      award,
      botId,
      telegramId,
    );
    return { awarded: award, ...this.getLoyalty(botId, telegramId) };
  }

  /**
   * Performs the daily spin for the gamification wheel, awarding the drawn
   * prize's points (daily gate is independent from the check-in gate).
   * @param {number} botId - Owning bot id.
   * @param {number} telegramId - User Telegram id.
   * @param {Array<{label: string; points: number}>} prizes - Prize table from app config.
   * @returns {object} Drawn prize and updated balance.
   * @throws {BadRequestException} When already spun today or no prizes exist.
   */
  spin(
    botId: number,
    telegramId: number,
    prizes: Array<{ label: string; points: number }>,
  ): Record<string, unknown> {
    if (prizes.length === 0) throw new BadRequestException('No prizes configured');
    const today = new Date().toISOString().slice(0, 10);
    const key = `spin_${telegramId}`;
    if (this.settings.getBotJson<string>(botId, key) === today) {
      throw new BadRequestException('Already spun today');
    }
    this.settings.setBotJson(botId, key, today);

    const totalWeight = prizes.reduce((sum, prize) => sum + Math.max(1, prize.points), 0);
    let roll = Math.random() * totalWeight;
    let drawn = prizes[0]!;
    for (const prize of prizes) {
      roll -= Math.max(1, prize.points);
      if (roll <= 0) {
        drawn = prize;
        break;
      }
    }
    this.db.run(
      'UPDATE bot_users SET points = points + ? WHERE bot_id = ? AND telegram_id = ?',
      Math.max(0, drawn.points),
      botId,
      telegramId,
    );
    return { prize: drawn, ...this.getLoyalty(botId, telegramId) };
  }

  /**
   * Records a Mini App order.
   * @param {number} botId - Owning bot id.
   * @param {number} appId - Mini App identifier.
   * @param {number} telegramId - Buyer Telegram id.
   * @param {Array<{id: string; title: string; price: number; quantity: number}>} items - Cart items.
   * @returns {object} Created order.
   */
  createOrder(
    botId: number,
    appId: number,
    telegramId: number,
    items: Array<{ id: string; title: string; price: number; quantity: number }>,
  ): Record<string, unknown> {
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const result = this.db.run(
      `INSERT INTO mini_app_orders (bot_id, app_id, telegram_id, total_amount, currency, items_json, status, created_at)
       VALUES (?, ?, ?, ?, 'XTR', ?, 'pending', ?)`,
      botId,
      appId,
      telegramId,
      total,
      JSON.stringify(items),
      new Date().toISOString(),
    );
    void this.webhooks.dispatch(botId, 'order_created', {
      orderId: Number(result.lastInsertRowid),
      telegramId,
      total,
      items,
    });
    return { orderId: Number(result.lastInsertRowid), total, currency: 'XTR' };
  }

  /**
   * Lists orders for a Mini App.
   * @param {number} botId - Owning bot id.
   * @param {number} appId - Mini App identifier.
   * @returns {object[]} Order rows.
   */
  listOrders(botId: number, appId: number): Array<Record<string, unknown>> {
    return this.db.query(
      'SELECT * FROM mini_app_orders WHERE bot_id = ? AND app_id = ? ORDER BY id DESC LIMIT 500',
      botId,
      appId,
    );
  }

  /**
   * Stores a form submission (capped at 1000 per app) and dispatches the
   * outgoing webhook event.
   * @param {number} botId - Owning bot id.
   * @param {number} appId - Mini App identifier.
   * @param {number} telegramId - Submitter Telegram id.
   * @param {Record<string, unknown>} answers - Field answers.
   * @returns {{received: true}} Acknowledgement.
   */
  submitForm(
    botId: number,
    appId: number,
    telegramId: number,
    answers: Record<string, unknown>,
  ): { received: true } {
    const key = `forms_${appId}`;
    const submissions =
      this.settings.getBotJson<Array<Record<string, unknown>>>(botId, key) ?? [];
    submissions.unshift({ telegramId, answers, at: new Date().toISOString() });
    this.settings.setBotJson(botId, key, submissions.slice(0, 1000));
    void this.webhooks.dispatch(botId, 'form_submitted', { appId, telegramId, answers });
    return { received: true };
  }

  /**
   * Lists form submissions for an app.
   * @param {number} botId - Owning bot id.
   * @param {number} appId - Mini App identifier.
   * @returns {Array<object>} Stored submissions.
   */
  listFormSubmissions(botId: number, appId: number): Array<Record<string, unknown>> {
    return this.settings.getBotJson<Array<Record<string, unknown>>>(botId, `forms_${appId}`) ?? [];
  }
}
