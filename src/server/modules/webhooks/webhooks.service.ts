import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { SystemSettingsService } from '../../database/system-settings.service';
import { BotPoolService } from '../../bot-engine/bot-pool.service';
import { renderTemplate } from '../../common/utils/template.util';
import { assertPublicHttpUrl } from '../../common/utils/url.util';

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
 * @property {string} hookId - High-entropy path segment of the inbound hook.
 * @property {string} secret - HMAC-SHA256 secret callers must sign payloads with.
 * @property {number | string} targetChatId - Numeric chat id or `@username` receiving rendered messages.
 * @property {string} template - Message template using `{payload.<key>}` placeholders.
 */
export interface InboundAction {
  hookId: string;
  secret: string;
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

/** Inbound rate limit: 30 requests per hook per rolling minute. */
const INBOUND_RATE_LIMIT = 30;
const INBOUND_RATE_WINDOW_MS = 60_000;
/** Outbound delivery timeout — a hanging target must not stall the loop. */
const DISPATCH_TIMEOUT_MS = 10_000;

/**
 * Webhooks Hub service: signed outgoing event delivery to Zapier, Make,
 * n8n, or custom APIs, plus HMAC-verified inbound hooks that render templated
 * messages into a target chat.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly inboundHits = new Map<string, number[]>();

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
   * Creates an outgoing endpoint. The URL must be an absolute http(s) URL
   * pointing at a public host (internal targets need WEBHOOKS_ALLOW_PRIVATE=1).
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} data - url, secret, events.
   * @returns {WebhookEndpoint} Created endpoint.
   * @throws {Error} When the URL fails the public-http validation.
   */
  create(botId: number, data: Record<string, unknown>): WebhookEndpoint {
    const url = String(data.url ?? '');
    const violation = assertPublicHttpUrl(url);
    if (violation) {
      throw new BadRequestException(violation);
    }
    const endpoints = this.list(botId);
    const endpoint: WebhookEndpoint = {
      id: `hook_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
      url,
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
   * signature header (`X-Studio-Signature`) and a hard 10s timeout.
   * @param {number} botId - Owning bot id.
   * @param {string} event - Stable event name.
   * @param {Record<string, unknown>} payload - Event payload.
   * @returns {Promise<void>} Resolves once delivery was attempted everywhere.
   */
  async dispatch(botId: number, event: string, payload: Record<string, unknown>): Promise<void> {
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
          signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
          headers: {
            'Content-Type': 'application/json',
            'X-Studio-Event': event,
            'X-Studio-Signature': signature,
          },
          body,
        });
        this.logDelivery(botId, {
          event,
          url: endpoint.url,
          status: response.status,
          at: new Date().toISOString(),
        });
      } catch (error) {
        this.logger.warn(
          `Webhook delivery to ${endpoint.url} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.logDelivery(botId, {
          event,
          url: endpoint.url,
          status: 'error',
          at: new Date().toISOString(),
        });
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
   * Rolling-minute rate limiter for public inbound hooks (30 req/min per hook).
   * @param {string} hookId - Inbound hook identifier.
   * @returns {boolean} True while the hook is under its rate limit.
   */
  inboundRateAllowed(hookId: string): boolean {
    const now = Date.now();
    const hits = (this.inboundHits.get(hookId) ?? []).filter(
      (ts) => now - ts < INBOUND_RATE_WINDOW_MS,
    );
    if (hits.length >= INBOUND_RATE_LIMIT) {
      this.inboundHits.set(hookId, hits);
      return false;
    }
    hits.push(now);
    this.inboundHits.set(hookId, hits);
    if (this.inboundHits.size > 1000) {
      for (const [key, timestamps] of this.inboundHits) {
        if (timestamps.every((ts) => now - ts >= INBOUND_RATE_WINDOW_MS)) {
          this.inboundHits.delete(key);
        }
      }
    }
    return true;
  }

  /**
   * Verifies the `X-Webhook-Signature` header against the action's secret,
   * computed over the exact raw request bytes.
   * @param {InboundAction} action - Matching inbound action.
   * @param {Buffer | string} rawBody - Raw request body bytes.
   * @param {string | undefined} provided - Signature header value.
   * @returns {boolean} True when the signature matches (constant-time).
   */
  verifyInboundSignature(
    action: InboundAction,
    rawBody: Buffer | string,
    provided: string | undefined,
  ): boolean {
    if (!action.secret || !provided) return false;
    const expected = createHmac('sha256', action.secret)
      .update(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'))
      .digest('hex');
    const providedBuffer = Buffer.from(provided.trim().replace(/^sha256=/, ''), 'hex');
    if (providedBuffer.length !== expected.length / 2) return false;
    return timingSafeEqual(providedBuffer, Buffer.from(expected, 'hex'));
  }

  /**
   * Resolves the hook and verifies its signature in one step.
   * @param {number} botId - Owning bot id.
   * @param {string} hookId - Inbound hook identifier from the URL.
   * @param {Buffer | string} rawBody - Raw request body bytes.
   * @param {string | undefined} provided - Signature header value.
   * @returns {'unknown' | 'invalid' | 'ok'} Verification outcome.
   */
  verifyInboundAction(
    botId: number,
    hookId: string,
    rawBody: Buffer | string | undefined,
    provided: string | undefined,
  ): 'unknown' | 'invalid' | 'ok' {
    const actions = this.settings.getBotJson<InboundAction[]>(botId, 'webhook_inbound') ?? [];
    const action = actions.find((entry) => entry.hookId === hookId);
    if (!action) return 'unknown';
    if (!rawBody) return 'invalid';
    return this.verifyInboundSignature(action, rawBody, provided) ? 'ok' : 'invalid';
  }

  /**
   * Handles a verified inbound webhook by rendering its template with the
   * payload values and sending the message to the target chat.
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
   * Creates an inbound hook action with a high-entropy hook id and a signing
   * secret. Callers must send `X-Webhook-Signature: hex(hmac_sha256(secret, rawBody))`
   * with every request; unsigned calls are rejected.
   * @param {number} botId - Owning bot id.
   * @param {Record<string, unknown>} data - targetChatId, template.
   * @returns {InboundAction & {url: string}} Created action with its URL and secret.
   */
  createInbound(botId: number, data: Record<string, unknown>): InboundAction & { url: string } {
    const actions = this.listInbound(botId);
    // Connections may reference public chats by @username; numeric ids stay numbers.
    const rawTarget = data.targetChatId;
    const targetChatId =
      typeof rawTarget === 'string' && rawTarget.startsWith('@')
        ? rawTarget
        : Number(rawTarget ?? 0);
    const action: InboundAction = {
      hookId: `in_${randomUUID().replaceAll('-', '')}`,
      secret: randomUUID().replaceAll('-', ''),
      targetChatId,
      template: String(data.template ?? 'Event received: {payload.event}'),
    };
    actions.push(action);
    this.settings.setBotJson(botId, 'webhook_inbound', actions);
    return {
      ...action,
      url: `/api/hooks/${botId}/${action.hookId}`,
    };
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
