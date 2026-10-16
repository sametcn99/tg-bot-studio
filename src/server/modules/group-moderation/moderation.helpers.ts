import type { Context } from 'grammy';
import type { PrismaService } from '../../database/prisma.service';
import type { AdminGateService, AdminCapability } from '../../bot-engine/admin-gate.service';
import type { AdminLogService } from '../../bot-engine/admin-log.service';
import type { BotI18nService, BotLanguage } from '../../bot-engine/bot-i18n.service';
import type { ChatSettingsService } from '../../bot-engine/chat-settings.service';
import type { RestrictionsService } from '../../bot-engine/restrictions.service';
import { splitDurationArg } from '../../common/utils/duration.util';
import { resolveTarget, userMentionHtml } from '../../common/utils/telegram-text.util';

/**
 * Service dependencies shared by the extracted group-moderation command
 * families (restriction/warn/approval handlers live in sibling files).
 */
export interface ModerationDeps {
  /** Registry key of the module ('group-moderation'). */
  moduleKey: string;
  prisma: PrismaService;
  adminGate: AdminGateService;
  restrictions: RestrictionsService;
  adminLog: AdminLogService;
  i18n: BotI18nService;
  chatSettings: ChatSettingsService;
}

/** Parsed restriction command invocation. */
export interface RestrictionInvocation {
  /** Target user id (numeric arg, or replied author). */
  userId: number | null;
  /** Username (without @) when the target arg was @-prefixed. */
  username?: string;
  /** Optional duration in seconds for timed variants. */
  durationSeconds: number | null;
  /** Remaining reason text. */
  reason: string;
  /** Author of the replied-to message, when present. */
  replyUserId: number | null;
}

/**
 * Ensures the update runs in a group chat and returns its language.
 * @param {ModerationDeps} deps - Shared service dependencies.
 * @param {Context} c - grammY command context.
 * @param {number} botId - Studio bot id.
 * @returns {Promise<{ chatId: number; lang: BotLanguage } | null>} Null when
 * the command arrived outside a group or from an authorless update.
 */
export async function groupContext(
  deps: ModerationDeps,
  c: Context,
  botId: number,
): Promise<{ chatId: number; lang: BotLanguage } | null> {
  if (c.chat?.type !== 'supergroup' && c.chat?.type !== 'group') return null;
  if (!c.from) return null;
  // Bot-to-bot gate: other bots may only use commands per the chat's
  // bot2bot mode (off / admin / all).
  if (c.from.is_bot) {
    const b2b = await deps.chatSettings.getEffectiveConfig(botId, c.chat.id, 'bot2bot');
    const mode = String(b2b.mode ?? 'off');
    if (mode === 'off') return null;
    if (mode === 'admin' && !(await deps.adminGate.isAdmin(c.api, c.chat.id, c.from.id))) {
      return null;
    }
  }
  const lang = await deps.i18n.getChatLanguage(botId, c.chat.id);
  return { chatId: c.chat.id, lang };
}

/**
 * Permission guard: verifies the caller holds a capability, replying a
 * localized error (suppressed when adminerror is off).
 * @param {ModerationDeps} deps - Shared service dependencies.
 * @param {Context} c - grammY command context.
 * @param {number} botId - Studio bot id.
 * @param {number} chatId - Group chat id.
 * @param {BotLanguage} lang - Chat language.
 * @param {AdminCapability} capability - Required capability.
 * @returns {Promise<boolean>} True when the caller may proceed.
 */
export async function requireCapability(
  deps: ModerationDeps,
  c: Context,
  botId: number,
  chatId: number,
  lang: BotLanguage,
  capability: AdminCapability,
): Promise<boolean> {
  const allowed = await deps.adminGate.hasCapability(c.api, chatId, c.from!.id, capability);
  if (allowed) return true;
  const config = await deps.chatSettings.getEffectiveConfig(botId, chatId, deps.moduleKey);
  if (config.adminError !== false) {
    const isAdmin = await deps.adminGate.isAdmin(c.api, chatId, c.from!.id);
    await c
      .reply(deps.i18n.t(lang, isAdmin ? 'common.missingPermission' : 'common.adminOnly'))
      .catch(() => undefined);
  }
  return false;
}

/**
 * Parses a restriction command's arguments (target, duration, reason).
 * @param {Context} c - grammY command context.
 * @param {boolean} needsDuration - True for timed variants.
 * @returns {RestrictionInvocation} Parsed invocation parts.
 */
export function parseInvocation(c: Context, needsDuration: boolean): RestrictionInvocation {
  const replyUser = c.msg?.reply_to_message?.from;
  const args = typeof c.match === 'string' ? c.match.trim() : '';
  const { userId, username, rest } = resolveTarget(args, replyUser);
  const { seconds, rest: reason } = needsDuration
    ? splitDurationArg(rest)
    : { seconds: null, rest };
  return {
    userId: userId ?? null,
    username,
    durationSeconds: seconds,
    reason,
    replyUserId: replyUser?.id ?? null,
  };
}

/**
 * Resolves the numeric user id for an invocation (@username resolved via
 * getChat; numeric ids and replies pass through).
 * @param {Context} c - grammY command context.
 * @param {RestrictionInvocation} invocation - Parsed invocation.
 * @returns {Promise<number | null>} Numeric id, or null when unresolvable.
 */
export async function resolveUserId(
  c: Context,
  invocation: RestrictionInvocation,
): Promise<number | null> {
  if (invocation.userId) return invocation.userId;
  if (invocation.username) {
    const chat = await c.api.getChat(`@${invocation.username}`).catch(() => null);
    if (chat && chat.type === 'private') return Number(chat.id);
  }
  return invocation.replyUserId;
}

/**
 * Builds an HTML mention for a possibly-unknown target user.
 * @param {Context} c - grammY command context.
 * @param {number} userId - Numeric target id.
 * @returns {Promise<string>} HTML-safe mention text.
 */
export async function describeUser(c: Context, userId: number): Promise<string> {
  const replied = c.msg?.reply_to_message?.from;
  if (replied && replied.id === userId) {
    return userMentionHtml(replied);
  }
  const member = await c.api.getChatMember(c.chat!.id, userId).catch(() => null);
  if (member) return userMentionHtml(member.user);
  return `<a href="tg://user?id=${userId}">User ${userId}</a>`;
}
