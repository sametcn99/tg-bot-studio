/**
 * Pure detection/matching logic for the group file-search module: Turkish
 * aware text normalization, "is there X?" question detection with trigger
 * regexes, query-token extraction, substring matching against the indexed
 * `search_text` column, and t.me message-link construction. Kept free of
 * NestJS/grammY dependencies so it is directly unit-testable.
 * @module modules/file-search/search-logic
 */
import type { Message } from 'grammy/types';

/**
 * Folds text for index/needle comparison: lowercases, strips NFD marks
 * (ç→c, ş→s, ö→o, ü→u, â→a, İ→i via its decomposed dot), maps the dotless
 * ı→i (NFD cannot decompose it), and collapses whitespace. "BAŞVURU" and
 * "başvuru" both become "basvuru", so diacritic-less typing still matches.
 *
 * @param {string} text - Raw text.
 * @returns {string} Folded comparison text.
 */
export function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Turkish "var mı / yok mu / misin" family question markers. */
const TRIGGER_PATTERNS_TR: RegExp[] = [
  /\bvar\s*m[ıi]/i, // var mı / varmi / var mı?
  /\byok\s*mu/i, // ... yok mu?
  /\bkimde\s+var/i,
  /\bmevcut\s*mu/i,
  /\bvar\s*sa\b/i,
  /\bm[ıi]s[ıi]n[ıi]z\b/i, // gönderir misiniz
  /\bm[ıi]s[ıi]n\b/, // atar mısın / misin
  /\bg[öo]nder[ıi]r\s*m[ıi]/i, // gönderebilir/gönderir mi
];

/** English "is there / does anyone have" family question markers. */
const TRIGGER_PATTERNS_EN: RegExp[] = [
  /\bis\s+there\b/i,
  /\bare\s+there\b/i,
  /\bdoes\s+any(?:one|body)\s+have\b/i,
  /\bany(?:one|body)\s+(?:have|got|send|share|know)\b/i,
  /\bhas\s+any(?:one|body)\b/i,
  /\blooking\s+for\b/i,
  /\bplease\s+(?:send|share|upload|post)\b/i,
  /\bcan\s+(?:someone|anyone|anybody|somebody)\s+(?:send|share|help|upload|post)\b/i,
];

/** Words dropped from the question before matching (normalized forms). */
const STOPWORDS: ReadonlySet<string> = new Set([
  // Turkish question/filler words (already folded: ı→i, ö→o, ü→u, ş→s, ç→c)
  'var',
  'varmi',
  'vardir',
  'varsa',
  'yok',
  'yokmu',
  'mu',
  'mi',
  'olan',
  'olani',
  'bulunan',
  'paylasan',
  'gonderen',
  'gonderir',
  'gonderebilir',
  'gonder',
  'atar',
  'atabilir',
  'yollar',
  'yollayabilir',
  'satan',
  'kimde',
  'elinde',
  'bende',
  'bana',
  'bir',
  'tane',
  'adet',
  'arkadaslar',
  'arkadas',
  'kimse',
  'biri',
  'acaba',
  'lutfen',
  'misin',
  'misiniz',
  'icin',
  'varmi',
  'gecen',
  'eski',
  // English question/filler words
  'is',
  'there',
  'are',
  'does',
  'do',
  'anyone',
  'anybody',
  'someone',
  'somebody',
  'has',
  'have',
  'got',
  'send',
  'share',
  'upload',
  'post',
  'please',
  'pls',
  'can',
  'could',
  'you',
  'looking',
  'for',
  'me',
  'us',
  'who',
  'guys',
  'hi',
  'hello',
  'know',
  'find',
  'the',
  'a',
  'an',
]);

/** Minimum token length kept after stopword removal. */
const MIN_TOKEN_CHARS = 2;

/** Result shape of {@link detectQuestion}. */
export interface DetectedQuestion {
  /** Display form of the extracted query (original casing, stopword-free). */
  query: string;
  /** Normalized tokens the matcher consumes. */
  tokens: string[];
}

/**
 * Detects a "does anyone have X?" style question and extracts its searchable
 * query. A message counts as a question only when a trigger pattern matches
 * AND at least one non-stopword token of `MIN_TOKEN_CHARS`+ chars remains.
 *
 * @param {string} text - Raw message text.
 * @param {object} [opts] - Detection options.
 * @param {string[]} [opts.extraPatterns] - Extra regex sources (per-chat
 * config), invalid ones are skipped.
 * @param {boolean} [opts.builtIn] - Whether the built-in TR/EN patterns run.
 * @returns {DetectedQuestion | null} Query when the text is a question.
 */
export function detectQuestion(
  text: string,
  opts: { extraPatterns?: string[]; builtIn?: boolean } = {},
): DetectedQuestion | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('/')) return null;

  const patterns: RegExp[] = [];
  if (opts.builtIn !== false) {
    patterns.push(...TRIGGER_PATTERNS_TR, ...TRIGGER_PATTERNS_EN);
  }
  for (const source of opts.extraPatterns ?? []) {
    try {
      patterns.push(new RegExp(source, 'i'));
    } catch {
      // Malformed admin-provided regex: skip rather than break the handler.
    }
  }
  if (patterns.length === 0) return null;
  if (!patterns.some((pattern) => pattern.test(trimmed))) return null;

  const kept: string[] = [];
  for (const raw of trimmed.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const folded = normalizeForSearch(raw);
    if (folded.length < MIN_TOKEN_CHARS || STOPWORDS.has(folded)) continue;
    kept.push(raw);
  }
  if (kept.length === 0) return null;
  return {
    query: kept.join(' '),
    tokens: kept.map(normalizeForSearch),
  };
}

/**
 * Splits an already-extracted (or /ara-provided) query into normalized
 * matchable tokens, dropping stopword filler and 1-char fragments.
 *
 * @param {string} query - Free-text query.
 * @returns {string[]} Normalized tokens.
 */
export function tokenizeQuery(query: string): string[] {
  const tokens: string[] = [];
  for (const raw of query.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const folded = normalizeForSearch(raw);
    if (folded.length < MIN_TOKEN_CHARS || STOPWORDS.has(folded)) continue;
    tokens.push(folded);
  }
  return tokens;
}

/**
 * Checks whether one normalized query token matches a row: either directly
 * as a substring of the folded index text, or (Turkish suffix tolerance) a
 * filename word is contained in the longer query token ("formu" finds
 * "form.pdf"). Word-level fallback requires 4+ chars to avoid noise.
 *
 * @param {string} token - Normalized query token.
 * @param {string} searchText - Row's folded index text.
 * @param {string[]} words - Word split of `searchText`.
 * @returns {boolean} True when the token hits.
 */
function tokenMatches(token: string, searchText: string, words: string[]): boolean {
  if (searchText.includes(token)) return true;
  return words.some((word) => word.length >= 4 && token.includes(word));
}

/**
 * Filters indexed rows down to the ones matching the query tokens. Mode
 * `all` requires every token to hit, `any` at least one; input order (newest
 * first) is preserved so callers cap the result themselves.
 *
 * @param {Array<{searchText: string}>} rows - Index rows with folded text.
 * @param {string[]} tokens - Normalized query tokens.
 * @param {'all'|'any'} mode - Match mode.
 * @returns {Array<{searchText: string}>} Matching rows, input order.
 */
export function matchFiles<T extends { searchText: string }>(
  rows: T[],
  tokens: string[],
  mode: 'all' | 'any',
): T[] {
  if (tokens.length === 0) return [];
  return rows.filter((row) => {
    const words = row.searchText.split(/[^a-z0-9]+/).filter(Boolean);
    return mode === 'all'
      ? tokens.every((token) => tokenMatches(token, row.searchText, words))
      : tokens.some((token) => tokenMatches(token, row.searchText, words));
  });
}

/**
 * Builds a clickable t.me link to one message: public usernames first, then
 * supergroup/channel `-100…` ids via /c/ links. Basic groups and private
 * chats have no message links at all — null signals callers to fall back to
 * copyMessage.
 *
 * @param {number} chatId - Telegram chat id.
 * @param {number} messageId - Message id inside that chat.
 * @param {string} [username] - Chat's public @username, when it has one.
 * @returns {string | null} Link or null when the chat type has none.
 */
export function buildMessageLink(
  chatId: number,
  messageId: number,
  username?: string,
): string | null {
  if (username) return `https://t.me/${username}/${messageId}`;
  const id = String(chatId);
  if (id.startsWith('-100')) return `https://t.me/c/${id.slice(4)}/${messageId}`;
  return null;
}

/** Media payload extracted from one group message. */
export interface ExtractedMedia {
  kind: 'document' | 'video' | 'audio' | 'voice' | 'video_note' | 'animation' | 'photo';
  fileName: string | null;
  fileId: string | null;
  mimeType: string | null;
  fileSize: number | null;
}

/** Message keys that count as shareable files for the index. */
const MEDIA_KEYS = [
  'document',
  'video',
  'audio',
  'voice',
  'video_note',
  'animation',
  'photo',
] as const;

/**
 * Extracts the indexable media payload of a message (null for plain text,
 * stickers, service messages, and media without a file).
 *
 * @param {Message} msg - Telegram message.
 * @returns {ExtractedMedia | null} Media descriptor or null.
 */
export function extractMedia(msg: Message): ExtractedMedia | null {
  for (const key of MEDIA_KEYS) {
    if (msg[key] === undefined) continue;
    switch (key) {
      case 'document':
        return {
          kind: 'document',
          fileName: msg.document?.file_name ?? null,
          fileId: msg.document?.file_id ?? null,
          mimeType: msg.document?.mime_type ?? null,
          fileSize: msg.document?.file_size ?? null,
        };
      case 'video':
        return {
          kind: 'video',
          fileName: msg.video?.file_name ?? null,
          fileId: msg.video?.file_id ?? null,
          mimeType: msg.video?.mime_type ?? null,
          fileSize: msg.video?.file_size ?? null,
        };
      case 'audio':
        return {
          kind: 'audio',
          fileName: msg.audio?.file_name ?? msg.audio?.title ?? null,
          fileId: msg.audio?.file_id ?? null,
          mimeType: msg.audio?.mime_type ?? null,
          fileSize: msg.audio?.file_size ?? null,
        };
      case 'voice':
        return {
          kind: 'voice',
          fileName: null,
          fileId: msg.voice?.file_id ?? null,
          mimeType: msg.voice?.mime_type ?? null,
          fileSize: msg.voice?.file_size ?? null,
        };
      case 'video_note':
        return {
          kind: 'video_note',
          fileName: null,
          fileId: msg.video_note?.file_id ?? null,
          mimeType: null,
          fileSize: msg.video_note?.file_size ?? null,
        };
      case 'animation':
        return {
          kind: 'animation',
          fileName: msg.animation?.file_name ?? null,
          fileId: msg.animation?.file_id ?? null,
          mimeType: msg.animation?.mime_type ?? null,
          fileSize: msg.animation?.file_size ?? null,
        };
      case 'photo': {
        const largest = msg.photo ? msg.photo[msg.photo.length - 1] : undefined;
        return {
          kind: 'photo',
          fileName: null,
          fileId: largest?.file_id ?? null,
          mimeType: 'image/jpeg',
          fileSize: largest?.file_size ?? null,
        };
      }
    }
  }
  return null;
}
