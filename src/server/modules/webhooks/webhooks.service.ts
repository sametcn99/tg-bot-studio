import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { SystemSettingsService } from '../../database/system-settings.service';
import { BotPoolService } from '../../bot-engine/bot-pool.service';
import { renderTemplate } from '../../common/utils/template.util';

/**
 * Outgoing webhook endpoint definition.
 * @interface WebhookEndpoint
 * @property {string} id - Unique endpoint identifier.
 * @property {string} url - Target URL receiving signed POST payloads.
 * @property {string} secret - HMAC-SHA256 signing secret.
 * @property {string[]} events - Subscribed event names (empty = all).
 */
export interface WebhookEndpoint {
  id: string;
  url: string;
  secret: string;
  events: string[];
}

/**
 * Inbound webhook action configuration.
 * @interface InboundAction
 * @property {string} hookId - Secret path segment of the inbound hook.
 * @property {number | string} targetChatId - Numeric chat id or `@username` receiving rendered messages.
 * @property {string} template - Message template using `{payload.<key>}` placeholders.
 */
interface InboundAction {
  hookId: string;
  targetChatId: number | string;
  template: string;
}

/** Delivery log entry (most recent 100 per bot). */
interface DeliveryLog {
  event: string;
  url: string;
  status: number | 'error';
  at: string;
}

/**
 * Webhooks Hub service: signed outgoing event delivery to Zapier, Make,
 * n8n, or custom APIs, plus inbound hooks that render templated messages
 * into a target chat.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  /**
   * @param {SystemSettingsService} settings - Bot settings key-value store.
   * @param {BotPoolService} pool - Multi-bot runtime pool.
   */
  constructor(
    private readonly settings: SystemSettingsService,
    private readonly pool: BotPoolService,
  ) {}

  /**
   * Lists configured outgoing endpoints.
   * @param {number} botId - Owning bot id.
   * @returns {WebhookEndpoint[]} Endpoint definitions.
   */
  list(botId: number): WebhookEndpoint[] {
    return this.settings.getBotJson<WebhookEndpoint[]>(botId, 'webhook_endpoints') ?? [];
  }

  /**
   * Creates an outgoing endpoint.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} data - url, secret, events.
   * @returns {WebhookEndpoint} Created endpoint.
   */
  create(botId: number, data: Record<string, unknown>): WebhookEndpoint {
    const endpoints = this.list(botId);
    const endpoint: WebhookEndpoint = {
      id: `hook_${Date.now().toString(36)}`,
      url: String(data.url ?? ''),
      secret: String(data.secret ?? ''),
      events: (data.events as string[]) ?? [],
    };
    endpoints.push(endpoint);
    this.settings.setBotJson(botId, 'webhook_endpoints', endpoints);
    return endpoint;
  }

  /**
   * Deletes an outgoing endpoint.
   * @param {number} botId - Owning bot id.
   * @param {string} id - Endpoint identifier.
   * @returns {void}
   */
  remove(botId: number, id: string): void {
    this.settings.setBotJson(
      botId,
      'webhook_endpoints',
      this.list(botId).filter((endpoint) => endpoint.id !== id),
    );
  }

  /**
   * Dispatches an event to all matching endpoints with an HMAC-SHA256
   * signature header (`X-Studio-Signature`).
   * @param {number} botId - Owning bot id.
   * @param {string} event - Stable event name.
   * @param {Record<string, unknown>} payload - Event payload.
   * @returns {Promise<void>} Resolves once delivery was attempted everywhere.
   */
  async dispatch(
    botId: number,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const endpoints = this.list(botId).filter(
      (endpoint) => endpoint.events.length === 0 || endpoint.events.includes(event),
    );
    if (endpoints.length === 0) return;

    const body = JSON.stringify({ event, botId, payload, at: new Date().toISOString() });
    for (const endpoint of endpoints) {
      try {
        const signature = createHmac('sha256', endpoint.secret).update(body).digest('hex');
        const response = await fetch(endpoint.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Studio-Event': event,
            'X-Studio-Signature': signature,
          },
          body,
        });
        this.logDelivery(botId, { event, url: endpoint.url, status: response.status, at: new Date().toISOString() });
      } catch (error) {
        this.logger.warn(
          `Webhook delivery to ${endpoint.url} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.logDelivery(botId, { event, url: endpoint.url, status: 'error', at: new Date().toISOString() });
      }
    }
  }

  /**
   * Appends a delivery log entry (capped at 100).
   * @param {number} botId - Owning bot id.
   * @param {DeliveryLog} entry - Delivery outcome.
   * @returns {void}
   */
  private logDelivery(botId: number, entry: DeliveryLog): void {
    const log = this.settings.getBotJson<DeliveryLog[]>(botId, 'webhook_delivery_log') ?? [];
    log.unshift(entry);
    this.settings.setBotJson(botId, 'webhook_delivery_log', log.slice(0, 100));
  }

  /**
   * Returns the recent delivery log.
   * @param {number} botId - Owning bot id.
   * @returns {DeliveryLog[]} Newest entries first.
   */
  deliveryLog(botId: number): DeliveryLog[] {
    return this.settings.getBotJson<DeliveryLog[]>(botId, 'webhook_delivery_log') ?? [];
  }

  /**
   * Handles an authenticated inbound webhook by rendering its template with
   * the payload values and sending the message to the target chat.
   * @param {number} botId - Owning bot id.
   * @param {string} hookId - Inbound hook identifier from the URL.
   * @param {Record<string, unknown>} payload - Arbitrary JSON payload.
   * @returns {Promise<boolean>} True when an action matched and was attempted.
   */
  async handleInbound(
    botId: number,
    hookId: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const actions = this.settings.getBotJson<InboundAction[]>(botId, 'webhook_inbound') ?? [];
    const action = actions.find((entry) => entry.hookId === hookId);
    if (!action) return false;

    const flattened: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload)) {
      flattened[`payload.${key}`] = String(value);
    }
    const text = renderTemplate(action.template, flattened);
    const bot = this.pool.getBot(botId);
    if (bot) {
      await bot.api.sendMessage(action.targetChatId, text).catch(() => undefined);
    }
    return true;
  }

  /**
   * Lists inbound hook actions.
   * @param {number} botId - Owning bot id.
   * @returns {InboundAction[]} Configured actions.
   */
  listInbound(botId: number): InboundAction[] {
    return this.settings.getBotJson<InboundAction[]>(botId, 'webhook_inbound') ?? [];
  }

  /**
   * Creates an inbound hook action.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} data - targetChatId, template.
   * @returns {InboundAction & {url: string}} Created action with its URL.
   */
  createInbound(botId: number, data: Record<string, unknown>): InboundAction & { url: string } {
    const actions = this.listInbound(botId);
    // Connections may reference public chats by @username; numeric ids stay numbers.
    const rawTarget = data.targetChatId;
    const targetChatId =
      typeof rawTarget === 'string' && rawTarget.startsWith('@') ? rawTarget : Number(rawTarget ?? 0);
    const action: InboundAction = {
      hookId: `in_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
      targetChatId,
      template: String(data.template ?? 'Event received: {payload.event}'),
    };
    actions.push(action);
    this.settings.setBotJson(botId, 'webhook_inbound', actions);
    return { ...action, url: `/api/hooks/${botId}/${action.hookId}` };
  }

  /**
   * Deletes an inbound hook action.
   * @param {number} botId - Owning bot id.
   * @param {string} hookId - Inbound hook identifier.
   * @returns {void}
   */
  removeInbound(botId: number, hookId: string): void {
    this.settings.setBotJson(
      botId,
      'webhook_inbound',
      this.listInbound(botId).filter((action) => action.hookId !== hookId),
    );
  }
}
