import { Injectable, Logger } from '@nestjs/common';
import { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { PrismaService } from '../database/prisma.service';
import { ModuleHandlerRegistry } from './module-handler-registry';
import { findModule } from './module-registry';

/** Reserved Telegram user id representing the sandbox tester (int32-safe). */
export const SIMULATOR_TELEGRAM_ID = 2_000_000_000;

/** Outgoing Telegram API call captured from the simulated bot. */
interface CapturedCall {
  method: string;
  payload: Record<string, unknown>;
}

/** Result shape consumed by the dashboard simulator drawer. */
export interface SimulationResult {
  text: string;
  mediaUrl?: string | null;
  buttons?: Array<{ text: string; url?: string; callback_data?: string }>;
  /** True when no enabled module produced a reply. */
  unmatched: boolean;
}

/** Methods that carry user-visible outgoing messages. */
const MESSAGE_METHODS = new Set([
  'sendMessage',
  'sendPhoto',
  'sendVideo',
  'sendAnimation',
  'sendAudio',
  'sendDocument',
  'sendVoice',
]);

/** Methods the fake API answers with a full result object. */
const OBJECT_RESULTS: Record<string, (payload: Record<string, unknown>) => unknown> = {
  sendMessage: () => ({ message_id: 1, date: 0, chat: { id: SIMULATOR_TELEGRAM_ID } }),
  sendPhoto: () => ({ message_id: 1, date: 0, chat: { id: SIMULATOR_TELEGRAM_ID } }),
  sendVideo: () => ({ message_id: 1, date: 0, chat: { id: SIMULATOR_TELEGRAM_ID } }),
  sendChatAction: () => true,
  answerCallbackQuery: () => true,
  answerPreCheckoutQuery: () => true,
};

/**
 * In-studio bot simulator: drives a REAL grammY middleware chain (every
 * enabled module runtime attached, exactly like production) against a fake
 * Telegram API so sandbox messages exercise the same code paths as live
 * traffic — without touching the network.
 */
@Injectable()
export class SimulatorService {
  private readonly logger = new Logger(SimulatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly handlerRegistry: ModuleHandlerRegistry,
  ) {}

  /**
   * Sends a sandbox text message or callback press through the bot's real
   * module middleware chain.
   * @param {number} botId - Studio bot id.
   * @param {object} input - Sandbox input (text and/or callback data).
   * @returns {Promise<SimulationResult>} First captured outgoing message.
   */
  async send(
    botId: number,
    input: { text?: string; callbackData?: string },
  ): Promise<SimulationResult> {
    const row = await this.prisma.bot.findUnique({ where: { id: botId } });
    if (!row) {
      return { text: `Bot ${botId} not found`, unmatched: true };
    }

    // Cast keeps this resilient across grammy/@grammyjs/types versions; the
    // sandbox never talks to the network, so only identity fields matter.
    const botInfo = {
      id: 42,
      is_bot: true,
      first_name: row.firstName || row.name,
      username: row.username ?? 'simulator_bot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
    } as UserFromGetMe;

    const simBot = new Bot(row.token);
    simBot.botInfo = botInfo; // never call init(): no network
    simBot.catch(() => undefined);

    const captured: CapturedCall[] = [];
    simBot.api.config.use((_prev, method, payload) => {
      captured.push({ method, payload: payload as Record<string, unknown> });
      const builder = OBJECT_RESULTS[method];
      // Transformers must return an ApiResponse envelope.
      return Promise.resolve({
        ok: true,
        result: builder ? (builder(payload as Record<string, unknown>) as never) : (true as never),
      });
    });

    await this.attachEnabledModules(simBot, botId);

    const baseFrom = {
      id: SIMULATOR_TELEGRAM_ID,
      is_bot: false,
      first_name: 'Tester',
      username: 'studio_test',
    };
    const baseChat = { id: SIMULATOR_TELEGRAM_ID, type: 'private' as const, first_name: 'Tester' };

    try {
      if (input.callbackData !== undefined) {
        await simBot.handleUpdate({
          update_id: Date.now(),
          callback_query: {
            id: String(Date.now()),
            from: baseFrom,
            message: { message_id: 2, date: Math.floor(Date.now() / 1000), chat: baseChat },
            chat_instance: 'sim',
            data: input.callbackData,
          },
        } as never);
      } else {
        await simBot.handleUpdate({
          update_id: Date.now(),
          message: {
            message_id: 1,
            from: baseFrom,
            chat: baseChat,
            date: Math.floor(Date.now() / 1000),
            text: input.text ?? '',
          },
        } as never);
      }
    } catch (error) {
      this.logger.warn(
        `Simulation error on bot ${botId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        text: `⚠️ Simulation error: ${error instanceof Error ? error.message : String(error)}`,
        unmatched: true,
      };
    }

    // First message addressed to the sandbox chat is the visible reply.
    const replyCall = captured.find((call) => {
      if (!MESSAGE_METHODS.has(call.method)) return false;
      const chatTarget =
        (call.payload as { chat_id?: unknown; chat?: { id?: unknown } }).chat_id ??
        (call.payload as { chat?: { id?: unknown } }).chat?.id;
      return Number(chatTarget ?? 0) === SIMULATOR_TELEGRAM_ID;
    });
    if (!replyCall) {
      return {
        text:
          input.callbackData !== undefined
            ? '(no reply to this button)'
            : 'Message received. (No enabled module responded — try /start or enable a module.)',
        unmatched: true,
      };
    }

    const payload = replyCall.payload;
    let mediaUrl: string | null = null;
    if (replyCall.method === 'sendPhoto') mediaUrl = String(payload.photo ?? '') || null;
    if (replyCall.method === 'sendVideo') mediaUrl = String(payload.video ?? '') || null;

    let buttons: Array<{ text: string; url?: string; callback_data?: string }> = [];
    const markup = payload.reply_markup as
      { inline_keyboard?: Array<Array<Record<string, unknown>>> } | undefined;
    if (markup?.inline_keyboard) {
      buttons = markup.inline_keyboard.flat().map((button) => ({
        text: String(button.text ?? ''),
        url: button.url === undefined ? undefined : String(button.url),
        callback_data:
          button.callback_data === undefined ? undefined : String(button.callback_data),
      }));
    }

    return {
      text: String(payload.caption ?? payload.text ?? ''),
      mediaUrl,
      buttons: buttons.length > 0 ? buttons : undefined,
      unmatched: false,
    };
  }

  /**
   * Attaches every enabled module runtime to the sandbox bot, mirroring
   * production's attachModules order and config merge.
   * @param {Bot} simBot - Sandbox grammY instance.
   * @param {number} botId - Studio bot id.
   * @returns {Promise<void>} Resolves once all handlers attached.
   */
  private async attachEnabledModules(simBot: Bot, botId: number): Promise<void> {
    const rows = await this.prisma.botModule.findMany({
      where: { botId, isEnabled: 1 },
    });
    for (const row of rows) {
      const handler = this.handlerRegistry.get(row.moduleKey);
      const definition = findModule(row.moduleKey);
      if (!handler || !definition) continue;
      const stored = row.configJson ? (JSON.parse(row.configJson) as Record<string, unknown>) : {};
      const config = { ...definition.defaultConfig, ...stored };
      try {
        await handler.register({ bot: simBot, botId, config });
      } catch (error) {
        this.logger.warn(
          `Simulator: module ${row.moduleKey} failed to attach: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
