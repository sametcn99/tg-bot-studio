import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { MiniApp } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { MiniAppModel } from './mini-app.model';
import { SystemSettingsService } from '../../database/system-settings.service';
import { BotPoolService } from '../../bot-engine/bot-pool.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { calculatePrizeWeights, drawPrizeByRoll } from '../../common/utils/spin.util';
import { StudioException } from '../../common/errors/studio-error';

/**
 * Mini App row shape.
 */
export type MiniAppRow = MiniApp;

/** Allowed Mini App template types. */
const TEMPLATE_TYPES = [
  'ecommerce',
  'loyalty',
  'forms',
  'spin',
  'webview',
  'leaderboard',
  'support',
] as const;

/**
 * Mini App studio service: CRUD, one-click chat menu button publishing,
 * orders, loyalty points with daily check-in, and form submissions.
 * Powered by MiniAppModel and Prisma.
 */
@Injectable()
export class MiniAppsService {
  /**
   * @param {MiniAppModel} miniAppModel - Domain model for mini apps and orders.
   * @param {PrismaService} prisma - Prisma ORM access service.
   * @param {SystemSettingsService} settings - Bot settings key-value store.
   * @param {BotPoolService} pool - Multi-bot runtime pool.
   * @param {WebhooksService} webhooks - Outgoing event dispatch.
   */
  constructor(
    private readonly miniAppModel: MiniAppModel,
    private readonly prisma: PrismaService,
    private readonly settings: SystemSettingsService,
    private readonly pool: BotPoolService,
    private readonly webhooks: WebhooksService,
  ) {}

  /**
   * Lists Mini Apps for a bot with decoded config.
   */
  async list(botId: number): Promise<Array<Record<string, unknown>>> {
    const rows = await this.miniAppModel.list(botId);
    return rows.map((row) => ({
      ...row,
      config: row.configJson ? JSON.parse(row.configJson) : {},
      theme: row.themeJson ? JSON.parse(row.themeJson) : {},
    }));
  }

  /**
   * Creates a Mini App.
   */
  async create(botId: number, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const templateType = String(data.templateType ?? '');
    if (!TEMPLATE_TYPES.includes(templateType as (typeof TEMPLATE_TYPES)[number])) {
      throw new BadRequestException(`templateType must be one of: ${TEMPLATE_TYPES.join(', ')}`);
    }
    const slug = String(data.slug ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-');
    if (!slug) throw new StudioException('SLUG_REQUIRED', 'slug is required');

    const existing = await this.miniAppModel.findBySlug(slug);
    if (existing) {
      throw new StudioException('SLUG_IN_USE', 'slug is already in use');
    }

    const created = await this.miniAppModel.create({
      botId,
      name: String(data.name ?? 'Untitled app'),
      slug,
      templateType,
      title: String(data.title ?? data.name ?? 'Mini App'),
      description: (data.description as string) ?? null,
      iconUrl: (data.iconUrl as string) ?? null,
      configJson: JSON.stringify(data.config ?? {}),
      themeJson: JSON.stringify(data.theme ?? {}),
    });

    return {
      ...created,
      config: data.config ?? {},
      theme: data.theme ?? {},
    };
  }

  /**
   * Updates a Mini App.
   */
  async update(
    botId: number,
    id: number,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const existing = await this.miniAppModel.findById(id);
    if (!existing || existing.botId !== botId) {
      throw new NotFoundException(`Mini app ${id} not found`);
    }

    const updated = await this.miniAppModel.update(botId, id, {
      name: data.name !== undefined ? String(data.name) : undefined,
      title: data.title !== undefined ? String(data.title) : undefined,
      description: data.description !== undefined ? (data.description as string) : undefined,
      iconUrl: data.iconUrl !== undefined ? (data.iconUrl as string) : undefined,
      configJson: data.config ? JSON.stringify(data.config) : undefined,
      themeJson: data.theme ? JSON.stringify(data.theme) : undefined,
      isActive: data.isActive === undefined ? undefined : data.isActive ? 1 : 0,
    });

    return {
      ...updated,
      config: updated.configJson ? JSON.parse(updated.configJson) : {},
      theme: updated.themeJson ? JSON.parse(updated.themeJson) : {},
    };
  }

  /**
   * Deletes a Mini App.
   */
  async remove(botId: number, id: number): Promise<void> {
    const existing = await this.miniAppModel.findById(id);
    if (!existing || existing.botId !== botId) {
      throw new NotFoundException(`Mini app ${id} not found`);
    }
    await this.miniAppModel.delete(id);
  }

  /**
   * Publishes a Mini App by pointing the chat bottom-left menu button at
   * its public URL via `setChatMenuButton`.
   */
  async publish(botId: number, id: number, publicBaseUrl: string): Promise<{ menuUrl: string }> {
    const app = await this.miniAppModel.findById(id);
    if (!app) throw new NotFoundException(`Mini app ${id} not found`);
    const bot = this.pool.getBot(botId);
    if (!bot) throw new StudioException('BOT_NOT_RUNNING', 'Bot is not running');
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
   */
  async getPublicConfig(slug: string): Promise<Record<string, unknown>> {
    const app = await this.miniAppModel.findBySlug(slug);
    if (!app || app.isActive !== 1)
      throw new StudioException('MINI_APP_NOT_FOUND', 'Mini App not found');
    return {
      slug: app.slug,
      templateType: app.templateType,
      title: app.title,
      description: app.description,
      config: app.configJson ? JSON.parse(app.configJson) : {},
      theme: app.themeJson ? JSON.parse(app.themeJson) : {},
    };
  }

  /**
   * Reads loyalty points for a Mini App user (bot-scoped).
   */
  async getLoyalty(botId: number, telegramId: number): Promise<Record<string, unknown>> {
    const user = await this.prisma.botUser.findUnique({
      where: {
        botId_telegramId: {
          botId,
          telegramId: BigInt(telegramId),
        },
      },
      select: { points: true },
    });
    const today = new Date().toISOString().slice(0, 10);
    const lastCheckin = this.settings.getBotJson<string>(botId, `checkin_${telegramId}`);
    return {
      points: user?.points ?? 0,
      checkedInToday: lastCheckin === today,
    };
  }

  /**
   * Points leaderboard for the `leaderboard` Mini App template: top members
   * by points plus the requesting user's own rank when outside the top list.
   */
  async getLeaderboard(
    botId: number,
    telegramId: number,
    limit = 20,
  ): Promise<Record<string, unknown>> {
    const take = Math.max(3, Math.min(50, limit));
    const top = await this.prisma.botUser.findMany({
      where: { botId, points: { gt: 0 } },
      orderBy: [{ points: 'desc' }, { lastSeenAt: 'desc' }],
      take,
    });
    const total = await this.prisma.botUser.count({ where: { botId, points: { gt: 0 } } });
    const entries = top.map((user, index) => ({
      rank: index + 1,
      name: user.firstName ?? user.username ?? `#${user.telegramId}`,
      username: user.username,
      points: user.points,
      isMe: Number(user.telegramId) === telegramId,
    }));
    let myRank: number | null = null;
    if (!entries.some((entry) => entry.isMe)) {
      const mine = await this.prisma.botUser.findUnique({
        where: { botId_telegramId: { botId, telegramId: BigInt(telegramId) } },
        select: { points: true },
      });
      if (mine && mine.points > 0) {
        myRank = await this.prisma.botUser.count({
          where: { botId, points: { gt: mine.points } },
        });
        myRank += 1;
      }
    }
    return { entries, myRank, total, myPoints: entries.find((e) => e.isMe)?.points ?? 0 };
  }

  /**
   * Stores a support request from the `support` Mini App template and, when
   * the support module is configured, relays it to the admin chat.
   */
  async submitSupport(
    botId: number,
    telegramId: number,
    message: string,
    senderName?: string,
  ): Promise<Record<string, unknown>> {
    const clean = message.trim().slice(0, 3_500);
    if (!clean) throw new BadRequestException('Message text is required');

    await this.prisma.supportMessage.create({
      data: {
        botId,
        telegramId: BigInt(telegramId),
        direction: 'user',
        senderName: senderName ?? null,
        messageText: clean,
        createdAt: new Date().toISOString(),
      },
    });

    let relayed = false;
    const supportModule = await this.prisma.botModule.findUnique({
      where: { botId_moduleKey: { botId, moduleKey: 'support' } },
    });
    if (supportModule?.isEnabled === 1 && supportModule.configJson) {
      try {
        const config = JSON.parse(supportModule.configJson) as Record<string, unknown>;
        const adminChatId = Number(config.adminChatId ?? 0);
        if (adminChatId) {
          const bot = this.pool.getBot(botId);
          if (bot) {
            await bot.api.sendMessage(
              adminChatId,
              `🆘 <b>Mini App support request</b>\nFrom: ${senderName ?? telegramId} (<code>${telegramId}</code>)\n\n${clean.replace(/</g, '&lt;')}`,
              { parse_mode: 'HTML' },
            );
            relayed = true;
          }
        }
      } catch {
        // Relay is best-effort; the request is already stored.
      }
    }
    return { success: true, relayed };
  }

  /**
   * Performs the daily check-in, awarding the configured points.
   */
  async checkin(botId: number, telegramId: number): Promise<Record<string, unknown>> {
    const today = new Date().toISOString().slice(0, 10);
    const key = `checkin_${telegramId}`;
    if (this.settings.getBotJson<string>(botId, key) === today) {
      throw new StudioException('ALREADY_CHECKED_IN', 'Already checked in today');
    }
    this.settings.setBotJson(botId, key, today);
    const award = 5;

    await this.prisma.botUser.update({
      where: {
        botId_telegramId: {
          botId,
          telegramId: BigInt(telegramId),
        },
      },
      data: {
        points: { increment: award },
      },
    });

    const loyalty = await this.getLoyalty(botId, telegramId);
    return { awarded: award, ...loyalty };
  }

  /**
   * Performs the daily spin for the gamification wheel using server-side prizes and weights.
   */
  async spin(botId: number, appId: number, telegramId: number): Promise<Record<string, unknown>> {
    const app = await this.miniAppModel.findById(appId);
    if (!app || app.botId !== botId || app.isActive !== 1) {
      throw new StudioException('MINI_APP_NOT_FOUND', 'Mini App not found or inactive');
    }

    let prizes: Array<{ label: string; points: number; weight?: number }> = [];
    if (app.configJson) {
      try {
        const parsed = JSON.parse(app.configJson);
        if (Array.isArray(parsed.prizes)) {
          prizes = parsed.prizes;
        }
      } catch {}
    }

    if (prizes.length === 0) throw new StudioException('NO_PRIZES', 'No prizes configured');
    const today = new Date().toISOString().slice(0, 10);
    const key = `spin_${appId}_${telegramId}`;
    if (this.settings.getBotJson<string>(botId, key) === today) {
      throw new StudioException('ALREADY_SPUN', 'Already spun today');
    }
    this.settings.setBotJson(botId, key, today);

    // Calculate weight: higher points = lower odds (inverse weight), or explicit weight if configured
    const prizeWeights = calculatePrizeWeights(prizes);
    const totalWeight = prizeWeights.reduce((sum, w) => sum + w, 0);
    const roll = Math.random() * totalWeight;
    const drawn = drawPrizeByRoll(prizes, prizeWeights, roll);

    await this.prisma.botUser.update({
      where: {
        botId_telegramId: {
          botId,
          telegramId: BigInt(telegramId),
        },
      },
      data: {
        points: { increment: Math.max(0, drawn.points) },
      },
    });

    const loyalty = await this.getLoyalty(botId, telegramId);
    return { prize: drawn, points: loyalty.points, ...loyalty };
  }

  /**
   * Verifies client-submitted order items against the server-side catalog.
   * @param {Record<string, unknown>} app - Mini App row (configJson parsed here).
   * @param {Array<{id: string; quantity: number}>} clientItems - Client cart.
   * @returns {{verifiedItems: Array<{id: string; title: string; price: number; quantity: number}>, total: number}} Verified cart.
   * @throws {StudioException} When nothing in the cart matches the catalog.
   */
  private verifyCatalogOrder(
    app: { configJson: string | null },
    clientItems: Array<{ id: string; quantity: number }>,
  ): {
    verifiedItems: Array<{ id: string; title: string; price: number; quantity: number }>;
    total: number;
  } {
    let catalog: Array<{ id: string; title: string; price: number }> = [];
    if (app.configJson) {
      try {
        const parsed = JSON.parse(app.configJson);
        if (Array.isArray(parsed.products)) {
          catalog = parsed.products;
        }
      } catch {}
    }

    const verifiedItems: Array<{ id: string; title: string; price: number; quantity: number }> = [];
    let total = 0;

    for (const item of clientItems) {
      const product = catalog.find((p) => String(p.id) === String(item.id));
      if (!product) continue;
      const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
      const price = Math.max(0, Number(product.price) || 0);
      total += price * qty;
      verifiedItems.push({
        id: String(product.id),
        title: String(product.title ?? 'Item'),
        price,
        quantity: qty,
      });
    }

    if (verifiedItems.length === 0) {
      throw new StudioException('ORDER_NO_PRODUCTS', 'No valid products found in order');
    }
    return { verifiedItems, total };
  }

  /**
   * Records a Mini App order with total calculated securely from server-side catalog.
   */
  async createOrder(
    botId: number,
    appId: number,
    telegramId: number,
    clientItems: Array<{ id: string; title?: string; price?: number; quantity: number }>,
  ): Promise<Record<string, unknown>> {
    const app = await this.miniAppModel.findById(appId);
    if (!app || app.botId !== botId || app.isActive !== 1) {
      throw new StudioException('MINI_APP_NOT_FOUND', 'Mini App not found or inactive');
    }

    const { verifiedItems, total } = this.verifyCatalogOrder(app, clientItems);

    const order = await this.miniAppModel.createOrder({
      botId,
      appId,
      telegramId,
      totalAmount: total,
      currency: 'XTR',
      itemsJson: JSON.stringify(verifiedItems),
    });

    void this.webhooks.dispatch(botId, 'order_created', {
      orderId: order.id,
      telegramId,
      total,
      items: verifiedItems,
    });
    return { orderId: order.id, total, currency: 'XTR' };
  }

  /**
   * Creates a Telegram Stars invoice for a verified cart and stores the
   * order as `pending_payment`. The engine's pre-checkout handler validates
   * the payload (`order:<id>`) before Telegram collects the payment.
   * @returns {Promise<{orderId: number, invoiceLink: string, total: number}>} Checkout payload.
   */
  async createStarsCheckout(
    botId: number,
    appId: number,
    telegramId: number,
    clientItems: Array<{ id: string; quantity: number }>,
  ): Promise<{ orderId: number; invoiceLink: string; total: number }> {
    const bot = this.pool.getBot(botId);
    if (!bot) {
      throw new StudioException('BOT_NOT_RUNNING', 'Bot is not running');
    }
    const app = await this.miniAppModel.findById(appId);
    if (!app || app.botId !== botId || app.isActive !== 1) {
      throw new StudioException('MINI_APP_NOT_FOUND', 'Mini App not found or inactive');
    }
    const { verifiedItems, total } = this.verifyCatalogOrder(app, clientItems);

    const order = await this.miniAppModel.createOrder({
      botId,
      appId,
      telegramId,
      totalAmount: total,
      currency: 'XTR',
      itemsJson: JSON.stringify(verifiedItems),
    });
    await this.miniAppModel.updateOrderStatus(order.id, 'pending_payment');

    const invoiceLink = await (
      bot.api.raw as unknown as {
        createInvoiceLink: (args: Record<string, unknown>) => Promise<string>;
      }
    ).createInvoiceLink({
      title: `${app.title} — Order #${order.id}`.slice(0, 32),
      description: verifiedItems
        .map((item) => `${item.quantity}× ${item.title}`)
        .join(', ')
        .slice(0, 255),
      payload: `order:${order.id}`,
      provider_token: '',
      currency: 'XTR',
      prices: [{ label: 'Total', amount: total }],
    });

    void this.webhooks.dispatch(botId, 'order_created', {
      orderId: order.id,
      telegramId,
      total,
      items: verifiedItems,
      status: 'pending_payment',
    });

    return { orderId: order.id, invoiceLink, total };
  }

  /**
   * Marks a paid order and records the charge id (Stars fulfilment).
   * @param {number} orderId - Order id from the invoice payload.
   * @param {string} chargeId - Telegram payment charge id.
   * @returns {Promise<void>}
   */
  async markOrderPaid(orderId: number, chargeId: string): Promise<void> {
    const order = await this.prisma.miniAppOrder.findFirst({
      where: { id: orderId, status: 'pending_payment' },
    });
    if (!order) return;
    await this.miniAppModel.updateOrderStatus(orderId, 'paid');
    void this.webhooks.dispatch(order.botId, 'order_paid', {
      orderId,
      telegramId: Number(order.telegramId),
      chargeId,
      total: order.totalAmount,
      currency: order.currency,
    });
  }

  /**
   * Public order status for the TMA shell after an invoice is opened.
   * Only visible to the owning Telegram user.
   */
  async getOrderStatus(
    botId: number,
    appId: number,
    orderId: number,
    telegramId: number,
  ): Promise<{ id: number; status: string; totalAmount: number } | null> {
    const order = await this.prisma.miniAppOrder.findFirst({
      where: { id: orderId, botId, appId, telegramId: BigInt(telegramId) },
      select: { id: true, status: true, totalAmount: true },
    });
    return order;
  }

  /**
   * Lists orders for a Mini App.
   */
  async listOrders(botId: number, appId: number) {
    return this.miniAppModel.listOrders(botId, appId);
  }

  /**
   * Stores a form submission.
   */
  submitForm(
    botId: number,
    appId: number,
    telegramId: number,
    answers: Record<string, unknown>,
  ): { received: true } {
    const key = `forms_${appId}`;
    const submissions = this.settings.getBotJson<Array<Record<string, unknown>>>(botId, key) ?? [];
    submissions.unshift({ telegramId, answers, at: new Date().toISOString() });
    this.settings.setBotJson(botId, key, submissions.slice(0, 1000));
    void this.webhooks.dispatch(botId, 'form_submitted', { appId, telegramId, answers });
    return { received: true };
  }

  /**
   * Lists form submissions for an app.
   */
  listFormSubmissions(botId: number, appId: number): Array<Record<string, unknown>> {
    return this.settings.getBotJson<Array<Record<string, unknown>>>(botId, `forms_${appId}`) ?? [];
  }
}
