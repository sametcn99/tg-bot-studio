import { Injectable, Logger } from '@nestjs/common';
import type { Context } from 'grammy';
import type { Message } from 'grammy/types';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { ChatSettingsService } from '../../bot-engine/chat-settings.service';
import { AdminLogService } from '../../bot-engine/admin-log.service';
import { BotI18nService } from '../../bot-engine/bot-i18n.service';
import { isChatTargeted } from '../../common/utils/chat-targets.util';
import { escapeHtml, userMentionHtml } from '../../common/utils/telegram-text.util';
import { FileSearchService } from './file-search.service';
import { buildMessageLink, detectQuestion, tokenizeQuery } from './search-logic';

/** Service-message keys that are never a file share nor a question. */
const SERVICE_KEYS: ReadonlyArray<keyof Message> = [
  'new_chat_members',
  'left_chat_member',
  'new_chat_title',
  'new_chat_photo',
  'delete_chat_photo',
  'group_chat_created',
  'supergroup_chat_created',
  'channel_chat_created',
  'migrate_to_chat_id',
  'pinned_message',
];

/**
 * Runtime for the Group File Search module. Indexes every media message of
 * the targeted chats, watches plain text for "X var mı?" style questions
 * (built-in TR/EN triggers plus per-chat regex patterns), and answers the
 * asker with a mention and t.me links to the matching indexed files.
 * Explicit /ara and /find commands search without needing a trigger phrase.
 *
 * Note: like every message-listening module, the bot only sees member
 * messages when it is a group administrator or privacy mode is disabled
 * via @BotFather, and the Bot API exposes no message history — the index
 * only fills from the moment the module is enabled.
 */
@Injectable()
export class FileSearchRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'file-search';

  private readonly logger = new Logger(FileSearchRuntime.name);

  /**
   * @param {FileSearchService} service - Index + search service.
   * @param {ChatSettingsService} chatSettings - Per-chat config layer.
   * @param {BotI18nService} i18n - Bot-reply localization.
   * @param {AdminLogService} adminLog - Admin action log bus.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly service: FileSearchService,
    private readonly chatSettings: ChatSettingsService,
    private readonly i18n: BotI18nService,
    private readonly adminLog: AdminLogService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches indexing + question answering middleware to the bot. The
   * message handler always calls `next()` so later modules (locks, message
   * score, moderation, ...) keep receiving updates.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot } = ctx;

    bot.on('message', async (update, next) => {
      try {
        await this.handleMessage(ctx, update);
      } catch (error) {
        this.logger.warn(
          `file-search message handling failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        await next();
      }
    });

    bot.command(['ara', 'find'], async (update) => {
      try {
        await this.handleSearchCommand(ctx, update);
      } catch (error) {
        this.logger.warn(
          `file-search command failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }

  /**
   * Indexes media messages and answers detected questions in targeted chats.
   * @param {ModuleRuntimeContext} ctx - Runtime context.
   * @param {Context} update - grammY message context.
   * @returns {Promise<void>} Resolves once handled.
   */
  private async handleMessage(ctx: ModuleRuntimeContext, update: Context): Promise<void> {
    const chat = update.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return;
    const from = update.from;
    if (!from || from.is_bot || from.id === ctx.bot.botInfo?.id) return;
    const msg = update.msg;
    if (!msg || SERVICE_KEYS.some((key) => msg[key] !== undefined)) return;

    const config = await this.chatSettings.getEffectiveConfig(ctx.botId, chat.id, this.moduleKey);
    if (!isChatTargeted(config.targetChats, chat.id)) return;

    await this.service.indexMessage(ctx.botId, chat.id, msg, config.includeCaptions !== false);

    if (!msg.text || msg.via_bot) return;
    const detected = detectQuestion(msg.text, {
      extraPatterns: Array.isArray(config.extraTriggerPatterns)
        ? (config.extraTriggerPatterns as string[])
        : [],
      builtIn: config.builtInTriggers !== false,
    });
    if (!detected) return;

    const minQueryLength = Number(config.minQueryLength ?? 3);
    if (detected.query.length < minQueryLength) return;

    const userKey = `${ctx.botId}:${chat.id}:${from.id}`;
    const chatKey = `${ctx.botId}:${chat.id}`;
    if (
      this.service.isCooling(userKey, Number(config.userCooldownSeconds ?? 30)) ||
      this.service.isCooling(chatKey, Number(config.chatCooldownSeconds ?? 10))
    ) {
      return;
    }

    const matches = await this.service.search(
      ctx.botId,
      chat.id,
      detected.tokens,
      config.matchMode === 'any' ? 'any' : 'all',
    );
    if (matches.length > 0) {
      await this.sendAnswer(ctx, chat, msg.message_id, from, detected.query, matches, config);
      this.service.markAnswered(userKey);
      this.service.markAnswered(chatKey);
      return;
    }
    // Silent by default: only configured chats tell the asker "nothing found".
    if (config.noResultReply === true) {
      const lang = await this.i18n.getChatLanguage(ctx.botId, chat.id);
      await ctx.bot.api
        .sendMessage(
          chat.id,
          this.i18n.t(lang, 'fileSearch.noResult', {
            user: userMentionHtml(from),
            query: escapeHtml(detected.query),
          }),
          {
            parse_mode: 'HTML',
            reply_parameters: {
              message_id: msg.message_id,
              allow_sending_without_reply: true,
            },
          },
        )
        .catch(() => undefined);
      this.service.markAnswered(userKey);
    }
  }

  /**
   * Handles the explicit /ara and /find search commands in targeted chats.
   * @param {ModuleRuntimeContext} ctx - Runtime context.
   * @param {Context} update - grammY command context.
   * @returns {Promise<void>} Resolves once handled.
   */
  private async handleSearchCommand(ctx: ModuleRuntimeContext, update: Context): Promise<void> {
    const chat = update.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return;
    const from = update.from;
    if (!from || from.is_bot || from.id === ctx.bot.botInfo?.id) return;
    const msg = update.msg;
    if (!msg) return;
    if (!(await this.chatSettings.isTargeted(ctx.botId, chat.id, this.moduleKey))) return;

    const config = await this.chatSettings.getEffectiveConfig(ctx.botId, chat.id, this.moduleKey);
    const query = (msg.text ?? '').replace(/^\/\S+\s*/, '').trim();
    const minQueryLength = Number(config.minQueryLength ?? 3);

    // Usage hints answer before the cooldown gate: malformed input does not
    // consume the chat's answer budget.
    if (query.length < minQueryLength) {
      const lang = await this.i18n.getChatLanguage(ctx.botId, chat.id);
      await update.api
        .sendMessage(chat.id, this.i18n.t(lang, 'fileSearch.tooShort', { min: minQueryLength }), {
          reply_parameters: {
            message_id: msg.message_id,
            allow_sending_without_reply: true,
          },
        })
        .catch(() => undefined);
      return;
    }

    const chatKey = `${ctx.botId}:${chat.id}`;
    if (this.service.isCooling(chatKey, Number(config.chatCooldownSeconds ?? 10))) return;

    const tokens = tokenizeQuery(query);
    const matches =
      tokens.length > 0
        ? await this.service.search(
            ctx.botId,
            chat.id,
            tokens,
            config.matchMode === 'any' ? 'any' : 'all',
          )
        : [];
    if (matches.length > 0) {
      await this.sendAnswer(ctx, chat, msg.message_id, from, query, matches, config);
    } else {
      const lang = await this.i18n.getChatLanguage(ctx.botId, chat.id);
      await update.api
        .sendMessage(
          chat.id,
          this.i18n.t(lang, 'fileSearch.noResult', {
            user: userMentionHtml(from),
            query: escapeHtml(query),
          }),
          {
            parse_mode: 'HTML',
            reply_parameters: {
              message_id: msg.message_id,
              allow_sending_without_reply: true,
            },
          },
        )
        .catch(() => undefined);
    }
    this.service.markAnswered(chatKey);
  }

  /**
   * Replies to the asking message with a mention and one bullet per matched
   * file: t.me link when the chat has message links, otherwise (basic
   * groups) a copyMessage fallback re-sharing the file, or a plain label.
   *
   * @param {ModuleRuntimeContext} ctx - Runtime context.
   * @param {Context['chat']} chat - Chat the question arrived in.
   * @param {number} askMessageId - Message id being replied to.
   * @param {import('grammy/types').User} from - Asking user.
   * @param {string} query - Display query.
   * @param {import('@prisma/client').GroupFileIndex[]} matches - Full match list.
   * @param {Record<string, unknown>} config - Effective chat config.
   * @returns {Promise<void>} Resolves once the answer is out.
   */
  private async sendAnswer(
    ctx: ModuleRuntimeContext,
    chat: NonNullable<Context['chat']>,
    askMessageId: number,
    from: import('grammy/types').User,
    query: string,
    matches: Array<{
      messageId: number;
      fileName: string | null;
      caption: string | null;
      kind: string;
    }>,
    config: Record<string, unknown>,
  ): Promise<void> {
    const lang = await this.i18n.getChatLanguage(ctx.botId, chat.id);
    const maxResults = Math.max(1, Number(config.maxResults ?? 5));
    const shown = matches.slice(0, maxResults);

    const lines: string[] = [
      this.i18n.t(lang, 'fileSearch.foundHeader', {
        user: userMentionHtml(from),
        query: escapeHtml(query),
      }),
    ];
    for (const row of shown) {
      const label = row.fileName ?? row.caption?.slice(0, 60) ?? row.kind;
      const link = buildMessageLink(chat.id, row.messageId, chat.username);
      if (link) {
        lines.push(`• <a href="${link}">${escapeHtml(label)}</a>`);
        continue;
      }
      // Basic groups have no message links: re-share the file itself as a
      // reply when the fallback is enabled, otherwise list the plain label.
      if (config.fallbackCopy !== false) {
        await ctx.bot.api
          .copyMessage(chat.id, chat.id, row.messageId, {
            reply_parameters: {
              message_id: askMessageId,
              allow_sending_without_reply: true,
            },
          })
          .catch(() => undefined);
      }
      lines.push(`• ${escapeHtml(label)}`);
    }
    if (matches.length > shown.length) {
      lines.push(
        this.i18n.t(lang, 'fileSearch.moreCount', { count: matches.length - shown.length }),
      );
    }

    await ctx.bot.api
      .sendMessage(chat.id, lines.join('\n'), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_parameters: { message_id: askMessageId, allow_sending_without_reply: true },
      })
      .catch(() => undefined);

    this.adminLog.emit({
      botId: ctx.botId,
      chatId: chat.id,
      category: 'automated',
      text: `file-search answered "${query}" with ${shown.length} file(s)`,
    });
  }
}
