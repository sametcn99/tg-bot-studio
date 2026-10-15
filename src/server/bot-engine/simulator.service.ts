import { Injectable, Logger } from '@nestjs/common';
import { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { PrismaService } from '../database/prisma.service';
import { ModuleHandlerRegistry } from './module-handler-registry';
import { findModule } from './module-registry';

/** Reserved Telegram user id representing the sandbox tester (int32-safe). */
export const SIMULATOR_TELEGRAM_ID = 2_000_000_000;

/** Reserved chat id representing the sandbox supergroup (int32-safe). */
export const SIMULATOR_GROUP_ID = -100_200_000_000;

/** What the sandbox should synthesize for this run. */
export type SimulationEvent = 'message' | 'join' | 'leave' | 'chat_member';

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
  /** Chat surface the visible reply was addressed to. */
  sentTo?: 'private' | 'group';
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
  sendMessage: (payload) => ({
    message_id: 1,
    date: 0,
    chat: { id: Number(payload.chat_id ?? SIMULATOR_TELEGRAM_ID) },
  }),
  sendPhoto: (payload) => ({
    message_id: 1,
    date: 0,
    chat: { id: Number(payload.chat_id ?? SIMULATOR_TELEGRAM_ID) },
  }),
  sendVideo: (payload) => ({
    message_id: 1,
    date: 0,
    chat: { id: Number(payload.chat_id ?? SIMULATOR_TELEGRAM_ID) },
  }),
  sendChatAction: () => true,
  answerCallbackQuery: () => true,
  answerPreCheckoutQuery: () => true,
  // Sandbox assumes the tester administrates the sandbox group so group
  // moderation commands can be exercised without a live Telegram chat.
  getChatAdministrators: () => [
    {
      status: 'creator',
      user: { id: SIMULATOR_TELEGRAM_ID, is_bot: false, first_name: 'Tester' },
    },
  ],
  getChatMember: () => ({ status: 'member', user: { id: SIMULATOR_TELEGRAM_ID, is_bot: false } }),
  getChat: (payload) => ({
    id: Number(payload.chat_id ?? SIMULATOR_TELEGRAM_ID),
    type: 'supergroup',
    title: 'Sandbox Group',
    permissions: { can_send_messages: true },
  }),
};

/**
 * In-studio bot simulator: drives a REAL grammY middleware chain (every
 * enabled module runtime attached, exactly like production) against a fake
 * Telegram API so sandbox messages exercise the same code paths as live
 * traffic — without touching the network. Supports private and group
 * surfaces, joins/leaves, and raw `chat_member` transitions.
 */
@Injectable()
export class SimulatorService {
  private readonly logger = new Logger(SimulatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly handlerRegistry: ModuleHandlerRegistry,
  ) {}

  /**
   * Sends a sandbox update through the bot's real module middleware chain.
   *
   * @param {number} botId - Studio bot id.
   * @param {object} input - Sandbox input: text/callback data, target surface
   * (`chatType`), and optional synthetic event (`join`, `leave`, `chat_member`).
   * @returns {Promise<SimulationResult>} First captured outgoing message.
   */
  async send(
    botId: number,
    input: {
      text?: string;
      callbackData?: string;
      chatType?: 'private' | 'supergroup' | 'group';
      event?: SimulationEvent;
    },
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

    const inGroup = input.chatType === 'supergroup' || input.chatType === 'group';
    const targetChatId = inGroup ? SIMULATOR_GROUP_ID : SIMULATOR_TELEGRAM_ID;

    const baseFrom = {
      id: SIMULATOR_TELEGRAM_ID,
      is_bot: false,
      first_name: 'Tester',
      username: 'studio_test',
    };
    const privateChat = {
      id: SIMULATOR_TELEGRAM_ID,
      type: 'private' as const,
      first_name: 'Tester',
    };
    const groupChat = {
      id: SIMULATOR_GROUP_ID,
      type: 'supergroup' as const,
      title: 'Sandbox Group',
    };
    const baseChat = inGroup ? groupChat : privateChat;
    const now = Math.floor(Date.now() / 1000);

    try {
      const event = input.event ?? 'message';
      if (input.callbackData !== undefined) {
        await simBot.handleUpdate({
          update_id: Date.now(),
          callback_query: {
            id: String(Date.now()),
            from: baseFrom,
            message: { message_id: 2, date: now, chat: baseChat },
            chat_instance: 'sim',
            data: input.callbackData,
          },
        } as never);
      } else if (event === 'chat_member') {
        await simBot.handleUpdate({
          update_id: Date.now(),
          chat_member: {
            chat: groupChat,
            from: baseFrom,
            date: now,
            old_chat_member: { user: baseFrom, status: 'left' },
            new_chat_member: { user: baseFrom, status: 'member' },
          },
        } as never);
      } else {
        const message: Record<string, unknown> = {
          message_id: 1,
          from: baseFrom,
          chat: baseChat,
          date: now,
        };
        if (event === 'join') {
          message.new_chat_members = [baseFrom];
        } else if (event === 'leave') {
          message.left_chat_member = baseFrom;
        } else {
          message.text = input.text ?? '';
        }
        await simBot.handleUpdate({ update_id: Date.now(), message } as never);
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
      return Number(chatTarget ?? 0) === targetChatId;
    });
    if (!replyCall) {
      return {
        text:
          input.callbackData !== undefined
            ? '(no reply to this button)'
            : 'Message received. (No enabled module responded — try /start or enable a module.)',
        unmatched: true,
        sentTo: inGroup ? 'group' : 'private',
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
      sentTo: inGroup ? 'group' : 'private',
    };
  }

  /**
   * Attaches every enabled module runtime to the sandbox bot, mirroring
   * production's attachModules order and config merge.
   *
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
