/**
 * Telegram text helpers shared by moderation commands: HTML escaping, user
 * mentions, target resolution ("1234", "@user", or a replied message), and
 * blocklist-oriented text normalization.
 * @module common/utils/telegram-text
 */
import type { User } from 'grammy/types';

/** Telegram's reserved id for messages sent by anonymous group admins. */
export const GROUP_ANONYMOUS_BOT_ID = 108_796_882_4;

/** Telegram's reserved id for messages sent on behalf of channels in groups. */
export const CHANNEL_BOT_ID = 136_817_688;

/**
 * Escapes plain text for safe embedding into HTML parse-mode messages.
 *
 * @param {string} text - Raw user-provided text.
 * @returns {string} Escaped text with `& < >` neutralized.
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Builds an HTML mention link for a user, preferring @username when present
 * (mirrors the reference bot's {mention} filling).
 *
 * @param {User} user - Telegram user object.
 * @returns {string} `@username` or an invisible mention link.
 */
export function userMentionHtml(user: User): string {
  if (user.username) return `@${user.username}`;
  const name = escapeHtml(displayName(user));
  return `<a href="tg://user?id=${user.id}">${name}</a>`;
}

/**
 * Best-effort display name: first + last name, falling back to username or id.
 *
 * @param {User} user - Telegram user object.
 * @returns {string} Human-readable display name.
 */
export function displayName(user: User): string {
  const parts = [user.first_name, user.last_name].filter((part) => part && part.trim());
  if (parts.length > 0) return parts.join(' ');
  if (user.username) return `@${user.username}`;
  return String(user.id);
}

/** Shape returned by {@link resolveTarget}. */
export interface ResolvedTarget {
  /** Telegram numeric id when the argument was numeric, or from the reply. */
  userId?: number;
  /** Username without @ when the argument was @-prefixed. */
  username?: string;
  /** Remaining text after the target token (usually the reason). */
  rest: string;
}

/**
 * Resolves a command target from leading arguments, reference-style: a numeric id,
 * an @username, or (fallback) the author of the replied message.
 *
 * @param {string} args - Raw argument text after the command.
 * @param {User | undefined} replyToUser - Author of the message being replied to.
 * @returns {ResolvedTarget} Parsed target plus the remaining reason text.
 * @example
 * resolveTarget('1234 spam', undefined); // { userId: 1234, rest: 'spam' }
 * resolveTarget('@john flooding', undefined); // { username: 'john', rest: 'flooding' }
 */
export function resolveTarget(args: string, replyToUser?: User): ResolvedTarget {
  const text = args.trim();
  if (!text && replyToUser) {
    return { userId: replyToUser.id, rest: '' };
  }

  const token = text.split(/\s+/)[0] ?? '';
  const rest = text.slice(token.length).trim();

  if (/^-?\d+$/.test(token)) {
    return { userId: Number(token), rest };
  }
  if (token.startsWith('@') && token.length > 1) {
    return { username: token.slice(1), rest };
  }
  if (!token && replyToUser) {
    return { userId: replyToUser.id, rest };
  }
  // No target token: when a reply exists the whole text is the reason.
  if (replyToUser) {
    return { userId: replyToUser.id, rest: text };
  }
  return { rest: text };
}

/**
 * Normalizes text for blocklist matching: strips accents (NFD diacritics),
 * collapses repeated whitespace, and lowercases — catching "hî thérê" style
 * evasion the way reference does.
 *
 * @param {string} text - Raw message text.
 * @returns {string} Normalized text for comparison.
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}
