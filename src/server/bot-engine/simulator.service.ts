import { Injectable, Logger } from '@nestjs/common';
import { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { PrismaService } from '../database/prisma.service';
import { ModuleHandlerRegistry } from './module-handler-registry';
import { EngineHelpersService } from './engine-helpers.service';
import { findModule } from './module-registry';
import { safeJsonObjectParse } from '../common/utils/json.util';
import { SIMULATOR_TELEGRAM_ID, SIMULATOR_GROUP_ID } from '../common/utils/chat-targets.util';

export { SIMULATOR_TELEGRAM_ID, SIMULATOR_GROUP_ID };

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
  'sendPoll',
]);

/** Methods that perform non-text moderation/chat actions. */
const ACTION_METHODS = new Set([
  'deleteMessage',
  'banChatMember',
  'restrictChatMember',
  'unbanChatMember',
  'promoteChatMember',
  'pinChatMessage',
  'unpinChatMessage',
  'unpinAllChatMessages',
  'approveChatJoinRequest',
  'declineChatJoinRequest',
  'setMessageReaction',
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
  sendAnimation: (payload) => ({
    message_id: 1,
    date: 0,
    chat: { id: Number(payload.chat_id ?? SIMULATOR_TELEGRAM_ID) },
  }),
  sendPoll: (payload) => ({
    message_id: 1,
    date: 0,
    chat: { id: Number(payload.chat_id ?? SIMULATOR_TELEGRAM_ID) },
    poll: {
      id: `sim_poll_${Date.now()}`,
      question: String(payload.question ?? ''),
      options: Array.isArray(payload.options) ? payload.options : [],
    },
  }),
  createForumTopic: (payload) => ({
    message_thread_id: 101,
    name: String(payload.name ?? 'Support Topic'),
    icon_color: 7322096,
  }),
  copyMessage: () => ({ message_id: 2 }),
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
  getChatMember: (payload) => {
    const userId = Number(payload.user_id ?? SIMULATOR_TELEGRAM_ID);
    return {
      status: 'member',
      user: {
        id: userId,
        is_bot: false,
        first_name: userId === SIMULATOR_TELEGRAM_ID ? 'Tester' : `User ${userId}`,
        username: userId === SIMULATOR_TELEGRAM_ID ? 'studio_test' : `user_${userId}`,
      },
    };
  },
  getChat: (payload) => {
    const raw = String(payload.chat_id ?? SIMULATOR_TELEGRAM_ID);
    if (raw.startsWith('@')) {
      const username = raw.slice(1);
      return {
        id: SIMULATOR_TELEGRAM_ID + 1,
        type: 'private',
        first_name: username,
        username,
      };
    }
    return {
      id: Number(payload.chat_id ?? SIMULATOR_TELEGRAM_ID),
      type: 'supergroup',
      title: 'Sandbox Group',
      permissions: { can_send_messages: true },
    };
  },
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
    private readonly helpers: EngineHelpersService,
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
    botId: string,
    input: {
      text?: string;
      callbackData?: string;
      chatType?: 'private' | 'supergroup' | 'group';
      event?: SimulationEvent;
      _isRetry?: boolean;
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

    const simBot = new Bot(row.token || '0:simulator');
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
      language_code: 'en',
    };
    await this.helpers.upsertUser(botId, baseFrom);

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
          const text = input.text ?? '';
          message.text = text;
          const entities: Array<{ offset: number; length: number; type: string }> = [];
          if (text.startsWith('/')) {
            const cmdToken = text.split(/\s+/)[0] ?? '';
            if (cmdToken.length > 1) {
              entities.push({ offset: 0, length: cmdToken.length, type: 'bot_command' });
            }
          }
          const urlRegex = /(?:https?:\/\/|t\.me\/)\S+/gi;
          let urlMatch: RegExpExecArray | null;
          while ((urlMatch = urlRegex.exec(text)) !== null) {
            entities.push({
              offset: urlMatch.index,
              length: urlMatch[0].length,
              type: 'url',
            });
          }
          if (entities.length > 0) {
            message.entities = entities;
          }
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

    // First message addressed to the sandbox chat (or the simulator user/group) is the visible reply.
    const replyCall =
      captured.find((call) => {
        if (!MESSAGE_METHODS.has(call.method)) return false;
        const chatTarget =
          (call.payload as { chat_id?: unknown; chat?: { id?: unknown } }).chat_id ??
          (call.payload as { chat?: { id?: unknown } }).chat?.id;
        return Number(chatTarget ?? 0) === targetChatId;
      }) ??
      captured.find((call) => {
        if (!MESSAGE_METHODS.has(call.method)) return false;
        const chatTarget =
          (call.payload as { chat_id?: unknown; chat?: { id?: unknown } }).chat_id ??
          (call.payload as { chat?: { id?: unknown } }).chat?.id;
        const id = Number(chatTarget ?? 0);
        return id === SIMULATOR_TELEGRAM_ID || id === SIMULATOR_GROUP_ID;
      });

    if (!replyCall) {
      const actionCalls = captured.filter((call) => ACTION_METHODS.has(call.method));
      if (actionCalls.length > 0) {
        const summaries = actionCalls.map((call) => {
          switch (call.method) {
            case 'deleteMessage':
              return '🗑️ Message deleted';
            case 'banChatMember':
              return '🔨 Member banned';
            case 'restrictChatMember':
              return '🔇 Member restricted/muted';
            case 'unbanChatMember':
              return '🔓 Member unbanned';
            case 'promoteChatMember':
              return '🛡️ Member admin privileges updated';
            case 'pinChatMessage':
              return '📌 Message pinned';
            case 'unpinChatMessage':
            case 'unpinAllChatMessages':
              return '📌 Message(s) unpinned';
            case 'approveChatJoinRequest':
              return '✅ Join request approved';
            case 'declineChatJoinRequest':
              return '⛔ Join request declined';
            case 'setMessageReaction':
              return '👍 Reaction added';
            default:
              return `⚡ ${call.method}`;
          }
        });
        return {
          text: [...new Set(summaries)].join(' • '),
          unmatched: false,
          sentTo: inGroup ? 'group' : 'private',
        };
      }

      // If a message/command produced no response on the selected surface,
      // automatically try the alternate surface (e.g. group command typed on
      // Private DM tab or private command typed on Group tab).
      if (
        !input._isRetry &&
        input.callbackData === undefined &&
        (input.event ?? 'message') === 'message'
      ) {
        const altSurface = inGroup ? 'private' : 'supergroup';
        const altResult = await this.send(botId, {
          ...input,
          chatType: altSurface,
          _isRetry: true,
        });
        if (!altResult.unmatched) {
          return altResult;
        }
      }

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
    const extractMedia = (val: unknown): string | null => {
      if (!val) return null;
      if (typeof val === 'string') return val.trim() || null;
      if (typeof val === 'object') {
        const fileObj = val as { fileData?: unknown; filename?: string };
        if (
          fileObj.fileData &&
          (Buffer.isBuffer(fileObj.fileData) || fileObj.fileData instanceof Uint8Array)
        ) {
          const fn = (fileObj.filename || 'media.jpg').toLowerCase();
          const mime = fn.endsWith('.png')
            ? 'image/png'
            : fn.endsWith('.webp')
              ? 'image/webp'
              : fn.endsWith('.gif')
                ? 'image/gif'
                : fn.endsWith('.mp4')
                  ? 'video/mp4'
                  : 'image/jpeg';
          const b64 = Buffer.from(fileObj.fileData as Uint8Array).toString('base64');
          return `data:${mime};base64,${b64}`;
        }
      }
      return null;
    };

    if (replyCall.method === 'sendPhoto') mediaUrl = extractMedia(payload.photo);
    if (replyCall.method === 'sendVideo') mediaUrl = extractMedia(payload.video);
    if (replyCall.method === 'sendAnimation') mediaUrl = extractMedia(payload.animation);

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

    let replyText = String(payload.caption ?? payload.text ?? '');
    if (replyCall.method === 'sendPoll') {
      const opts = Array.isArray(payload.options)
        ? payload.options
            .map(
              (o, i) =>
                `${i + 1}. ${typeof o === 'string' ? o : String((o as { text?: unknown })?.text ?? '')}`,
            )
            .join('\n')
        : '';
      replyText = `📊 ${String(payload.question ?? 'Poll')}${opts ? `\n${opts}` : ''}`;
    }

    return {
      text: replyText,
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
  private async attachEnabledModules(simBot: Bot, botId: string): Promise<void> {
    const rows = await this.prisma.botModule.findMany({
      where: { botId, isEnabled: 1 },
      orderBy: { moduleKey: 'asc' },
    });
    for (const row of rows) {
      const handler = this.handlerRegistry.get(row.moduleKey);
      const definition = findModule(row.moduleKey);
      if (!handler || !definition) continue;
      const stored = safeJsonObjectParse(row.configJson, {}, `simulator:${botId}:${row.moduleKey}`);
      const config = { ...definition.defaultConfig, ...stored };
      try {
        // sandbox: true tells side-effectful runtimes (flows sweeper, timers)
        // to skip background machinery — the fake API swallows sends, so a
        // live sweeper would consume real users' pending sessions.
        await handler.register({ bot: simBot, botId, config, sandbox: true });
      } catch (error) {
        this.logger.warn(
          `Simulator: module ${row.moduleKey} failed to attach: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
