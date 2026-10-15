/**
 * reference-parity lock evaluation: decides which lock types a Telegram message
 * violates. Pure functions — unit-testable without a bot instance.
 * @module modules/locks/lock-evaluator
 */
import type { Message } from 'grammy/types';

/** All lock types understood by /lock (reference naming preserved). */
export const LOCK_TYPES = [
  'all',
  'album',
  'anonchannel',
  'audio',
  'bot',
  'botlink',
  'button',
  'cashtag',
  'checklist',
  'cjk',
  'command',
  'comment',
  'contact',
  'cyrillic',
  'document',
  'email',
  'emoji',
  'emojicustom',
  'emojigame',
  'emojionly',
  'externalreply',
  'forward',
  'forwardbot',
  'forwardchannel',
  'forwardstory',
  'forwarduser',
  'game',
  'gif',
  'guestbot',
  'inline',
  'invitelink',
  'location',
  'phone',
  'photo',
  'poll',
  'rtl',
  'spoiler',
  'sticker',
  'stickeranimated',
  'stickerpremium',
  'text',
  'url',
  'video',
  'videonote',
  'voice',
  'zalgo',
] as const;

export type LockType = (typeof LOCK_TYPES)[number];

/** RTL/Arabic-Hebrew character ranges. */
const RTL_RE = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
/** CJK character ranges. */
const CJK_RE = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\u3000-\u303F]/;
/** Cyrillic character ranges. */
const CYRILLIC_RE = /[\u0400-\u04FF]/;
/** Excessive combining marks (zalgo/gibberish). */
const ZALGO_RE = /[\u0300-\u036F]{3,}/;
/** Any emoji (basic + supplementary planes, without joiners). */
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}]/u;
/** Only emoji + whitespace (keycaps included). */
const EMOJI_ONLY_RE = /^[\s\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}#*0-9]+$/u;

/**
 * Extracts URL-ish targets (entity URLs + bare link text) from a message.
 *
 * @param {Message} msg - Telegram message.
 * @returns {string[]} Lowercased URLs found in the message.
 */
function extractUrls(msg: Message): string[] {
  const urls: string[] = [];
  const text = msg.text ?? msg.caption ?? '';
  for (const entity of msg.entities ?? msg.caption_entities ?? []) {
    if (entity.type === 'url' || entity.type === 'text_link') {
      const value =
        entity.type === 'text_link' && entity.url ? entity.url : text.slice(entity.offset, entity.offset + entity.length);
      urls.push(value.toLowerCase());
    }
    if (entity.type === 'email' || entity.type === 'phone_number' || entity.type === 'cashtag') {
      urls.push(text.slice(entity.offset, entity.offset + entity.length).toLowerCase());
    }
  }
  if (/https?:\/\//i.test(text) || text.toLowerCase().includes('t.me/')) {
    for (const token of text.split(/\s+/)) {
      if (/^(https?:\/\/|t\.me\/)/i.test(token)) urls.push(token.toLowerCase());
    }
  }
  return urls;
}

/**
 * Decides whether a single lock type applies to a message.
 *
 * @param {LockType} type - Lock type to evaluate.
 * @param {Message} msg - Telegram message.
 * @param {number} chatId - Chat the message belongs to.
 * @returns {boolean} True when the message violates the lock.
 */
export function matchesLock(type: LockType, msg: Message, chatId: number): boolean {
  const text = msg.text ?? msg.caption ?? '';
  const entities = msg.entities ?? msg.caption_entities ?? [];
  const urls = extractUrls(msg);
  const hasEntity = (kind: string) => entities.some((entity) => entity.type === kind);

  switch (type) {
    case 'all':
      return LOCK_TYPES.some((other) => other !== 'all' && matchesLock(other, msg, chatId));
    case 'text':
      return msg.text !== undefined && msg.text.trim().length > 0;
    case 'photo':
      return msg.photo !== undefined;
    case 'video':
      return msg.video !== undefined;
    case 'voice':
      return msg.voice !== undefined;
    case 'videonote':
      return msg.video_note !== undefined;
    case 'audio':
      return msg.audio !== undefined;
    case 'document':
      return msg.document !== undefined;
    case 'gif':
      return msg.animation !== undefined;
    case 'sticker':
      return msg.sticker !== undefined;
    case 'stickeranimated':
      return msg.sticker?.is_animated === true;
    case 'stickerpremium':
      return msg.sticker?.premium_animation !== undefined;
    case 'emoji':
      return EMOJI_RE.test(text);
    case 'emojicustom':
      return entities.some((entity) => entity.type === 'custom_emoji');
    case 'emojionly':
      return text.trim().length > 0 && EMOJI_ONLY_RE.test(text);
    case 'emojigame':
      return msg.dice !== undefined;
    case 'poll':
      return msg.poll !== undefined;
    case 'game':
      return msg.game !== undefined;
    case 'inline':
    case 'guestbot':
      return msg.via_bot !== undefined;
    case 'url':
      return urls.some((url) => url.startsWith('http') || url.includes('://'));
    case 'email':
      return hasEntity('email') || /\S+@\S+\.\S+/.test(text);
    case 'phone':
      return hasEntity('phone_number') || /\+?\d[\d\s-]{7,}\d/.test(text);
    case 'command':
      return hasEntity('bot_command') || text.startsWith('/');
    case 'contact':
      return msg.contact !== undefined;
    case 'location':
      return msg.location !== undefined || msg.venue !== undefined;
    case 'invitelink':
      return urls.some((url) => url.includes('t.me/') || url.includes('t.me/joinchat'));
    case 'botlink':
      return urls.some(
        (url) => /^t\.me\/[a-z0-9_]+$/i.test(url.replace('https://', '')),
      );
    case 'bot':
      return msg.from?.is_bot === true;
    case 'button':
      return (
        msg.reply_markup !== undefined &&
        Array.isArray(msg.reply_markup.inline_keyboard) &&
        msg.reply_markup.inline_keyboard.some((row) =>
          row.some((button) => 'url' in button && button.url !== undefined),
        )
      );
    case 'cashtag':
      return hasEntity('cashtag') || /\$[A-Z]{2,}/.test(text);
    case 'forward':
      return msg.forward_origin !== undefined;
    case 'forwarduser':
      return msg.forward_origin?.type === 'user' || msg.forward_origin?.type === 'hidden_user';
    case 'forwardbot':
      return (
        msg.forward_origin?.type === 'user' && msg.forward_origin.sender_user?.is_bot === true
      );
    case 'forwardchannel':
      return msg.forward_origin?.type === 'channel';
    case 'forwardstory':
      return (msg.forward_origin as { story?: unknown } | undefined)?.story !== undefined;
    case 'externalreply':
      return msg.external_reply !== undefined;
    case 'anonchannel':
      return msg.sender_chat !== undefined && msg.sender_chat.id !== chatId && msg.sender_chat.type === 'channel';
    case 'comment':
      return msg.is_automatic_forward === true;
    case 'spoiler':
      return hasEntity('spoiler');
    case 'rtl':
      return RTL_RE.test(text);
    case 'cjk':
      return CJK_RE.test(text);
    case 'cyrillic':
      return CYRILLIC_RE.test(text);
    case 'zalgo':
      return ZALGO_RE.test(text);
    case 'checklist':
      return (msg as { checklist?: unknown }).checklist !== undefined;
    case 'album':
      return msg.media_group_id !== undefined;
    default:
      return false;
  }
}

/**
 * Evaluates every enabled lock against a message.
 *
 * @param {string[]} lockedTypes - Active lock types (from chat settings).
 * @param {Message} msg - Telegram message.
 * @param {number} chatId - Chat the message belongs to.
 * @returns {LockType[]} Violated lock types (empty when allowed).
 */
export function evaluateLocks(lockedTypes: string[], msg: Message, chatId: number): LockType[] {
  const violated: LockType[] = [];
  for (const raw of lockedTypes) {
    const type = raw.trim().toLowerCase() as LockType;
    if (!LOCK_TYPES.includes(type)) continue;
    if (type === 'all') {
      if (matchesLock('all', msg, chatId)) violated.push('all');
      continue;
    }
    if (matchesLock(type, msg, chatId)) violated.push(type);
  }
  return violated;
}

/**
 * Checks whether a message is exempt from locks via the allowlist. Entries:
 * bare domains (url/botlink/invitelink), `stickerpack:<name>`,
 * `emojipack:<id>`, `forward:<id|@username>`, `inline:<id|@username>`,
 * `command:/cmd`, `url:<domain>`.
 *
 * @param {string[]} allowlist - Allowlist entries.
 * @param {Message} msg - Telegram message.
 * @returns {boolean} True when explicitly allowed.
 */
export function isAllowlisted(allowlist: string[], msg: Message): boolean {
  const text = (msg.text ?? msg.caption ?? '').toLowerCase();
  const urls = extractUrls(msg);
  const commands = (msg.entities ?? msg.caption_entities ?? [])
    .filter((entity) => entity.type === 'bot_command')
    .map((entity) =>
      (msg.text ?? msg.caption ?? '').slice(entity.offset, entity.offset + entity.length).toLowerCase(),
    );

  for (const rawEntry of allowlist) {
    const entry = rawEntry.trim().toLowerCase();
    if (!entry) continue;

    if (entry.startsWith('stickerpack:')) {
      if (msg.sticker && msg.sticker.set_name?.toLowerCase() === entry.slice('stickerpack:'.length)) {
        return true;
      }
      continue;
    }
    if (entry.startsWith('emojipack:')) {
      if (
        (msg.entities ?? msg.caption_entities ?? []).some(
          (entity) =>
            entity.type === 'custom_emoji' &&
            (entity as { custom_emoji_id?: string }).custom_emoji_id ===
              entry.slice('emojipack:'.length),
        )
      ) {
        return true;
      }
      continue;
    }
    if (entry.startsWith('forward:')) {
      const value = entry.slice('forward:'.length);
      if (
        msg.forward_origin?.type === 'user' &&
        (String(msg.forward_origin.sender_user?.id) === value ||
          msg.forward_origin.sender_user?.username?.toLowerCase() === value)
      ) {
        return true;
      }
      if (
        msg.forward_origin?.type === 'channel' &&
        (String(msg.forward_origin.chat.id) === value ||
          msg.forward_origin.chat.username?.toLowerCase() === value)
      ) {
        return true;
      }
      continue;
    }
    if (entry.startsWith('inline:')) {
      const value = entry.slice('inline:'.length);
      if (
        msg.via_bot &&
        (String(msg.via_bot.id) === value || msg.via_bot.username?.toLowerCase() === value)
      ) {
        return true;
      }
      continue;
    }
    if (entry.startsWith('command:')) {
      if (commands.includes(entry.slice('command:'.length))) return true;
      continue;
    }
    if (entry.startsWith('url:')) {
      const domain = entry.slice('url:'.length);
      if (urls.some((url) => url.includes(domain))) return true;
      continue;
    }
    // Bare entry: match as domain within any URL, or as raw text.
    if (urls.some((url) => url.includes(entry))) return true;
    if (text.includes(entry)) return true;
  }
  return false;
}
