import { Injectable } from '@nestjs/common';
import type { Context } from 'grammy';
import type { User } from 'grammy/types';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { EngineHelpersService } from '../../bot-engine/engine-helpers.service';

/**
 * Runtime for the Automated Moderation & Anti-Spam module. Enforces
 * blacklisted words (plain or `/regex/` form), link blocking, and flood
 * control in groups, escalating repeat offenders to a studio-level ban.
 */
@Injectable()
export class ModerationRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'moderation';

  /** Message timestamps per (bot, chat, user) for flood control. */
  private readonly floodWindow = new Map<string, number[]>();

  /** Strike counters per (bot, chat, user). */
  private readonly strikes = new Map<string, number>();

  /**
   * @param {EngineHelpersService} helpers - Shared audience operations.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly helpers: EngineHelpersService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches group moderation middleware to the bot.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot } = ctx;
    const blockedWords = (ctx.config.blockedWords as string[]) ?? [];
    const blockLinks = Boolean(ctx.config.blockLinks);
    const floodLimit = Number(ctx.config.floodMessageLimit ?? 0);
    const floodWindowSeconds = Number(ctx.config.floodWindowSeconds ?? 10);
    const autoBanAfterStrikes = Number(ctx.config.autoBanAfterStrikes ?? 3);

    bot.on('message:text', async (update) => {
      if (update.chat?.type !== 'supergroup' && update.chat?.type !== 'group') return;
      if (!update.from) return;
      const text = update.msg.text;
      const key = `${ctx.botId}:${update.chat.id}:${update.from.id}`;

      // Blacklisted words (string or /regex/).
      const wordHit = blockedWords.find((word) => {
        const trimmed = word.trim();
        if (!trimmed) return false;
        if (trimmed.startsWith('/') && trimmed.lastIndexOf('/') > 0) {
          const body = trimmed.slice(1, trimmed.lastIndexOf('/'));
          const flags = trimmed.slice(trimmed.lastIndexOf('/') + 1);
          try {
            return new RegExp(body, flags).test(text);
          } catch {
            return false;
          }
        }
        return text.toLowerCase().includes(trimmed.toLowerCase());
      });
      if (wordHit) {
        await this.punish(ctx, update, update.chat.id, update.from, key, `Blacklisted word: ${wordHit}`, autoBanAfterStrikes);
        return;
      }

      // Link blocking (URL entities or bare http).
      if (blockLinks && (text.includes('http://') || text.includes('https://') || text.includes('t.me/'))) {
        await this.punish(ctx, update, update.chat.id, update.from, key, 'Link posting', autoBanAfterStrikes);
        return;
      }

      // Flood control.
      if (floodLimit > 0) {
        const now = Date.now();
        const windowStart = now - floodWindowSeconds * 1000;
        const timestamps = (this.floodWindow.get(key) ?? []).filter((ts) => ts >= windowStart);
        timestamps.push(now);
        this.floodWindow.set(key, timestamps);
        if (timestamps.length > floodLimit) {
          this.floodWindow.set(key, []);
          await this.punish(ctx, update, update.chat.id, update.from, key, 'Flooding', autoBanAfterStrikes);
          return;
        }
      }
    });
  }

  /**
   * Applies the escalation ladder: delete, warn, strike, and finally a
   * studio-level ban plus chat kick.
   * @param {ModuleRuntimeContext} ctx - Runtime context.
   * @param {Context} update - grammY context of the offending message.
   * @param {number} chatId - Group chat id.
   * @param {User} from - Offending member.
   * @param {string} key - Strike map key.
   * @param {string} reason - Human-readable violation reason.
   * @param {number} autoBanAfterStrikes - Strike threshold for a full ban.
   * @returns {Promise<void>} Resolves once the action was applied.
   */
  private async punish(
    ctx: ModuleRuntimeContext,
    update: Context,
    chatId: number,
    from: User,
    key: string,
    reason: string,
    autoBanAfterStrikes: number,
  ): Promise<void> {
    await update.deleteMessage().catch(() => undefined);
    const strikes = (this.strikes.get(key) ?? 0) + 1;
    this.strikes.set(key, strikes);

    if (autoBanAfterStrikes > 0 && strikes >= autoBanAfterStrikes) {
      this.strikes.set(key, 0);
      this.helpers.blockUser(ctx.botId, from, `Moderation: ${reason} (strike ${strikes})`);
      await ctx.bot.api
        .banChatMember(chatId, from.id, { until_date: 0 })
        .then(() => ctx.bot.api.unbanChatMember(chatId, from.id, { only_if_banned: true }))
        .catch(() => undefined);
      return;
    }
    await update
      .reply(
        `Message removed (${reason}). Violation ${strikes}${
          autoBanAfterStrikes > 0 ? `/${autoBanAfterStrikes}` : ''
        }.`,
      )
      .catch(() => undefined);
  }
}
