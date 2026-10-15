/**
 * reference-parity blocklist matching: word/phrase triggers with `?`/`*`/`**`
 * wildcards, `prefix:`/`exact:`/`lookalike:` modes, and non-text triggers
 * (`file:*.ext`, `name:`, `username:`, `forward:`, `stickerpack:`), with
 * per-entry `{action}` overrides. Pure and unit-testable.
 * @module modules/moderation/blocklist-matcher
 */
import type { Message, User } from 'grammy/types';

/** Result of a successful blocklist evaluation. */
export interface BlocklistMatch {
  /** The raw trigger that matched. */
  trigger: string;
  /** Per-entry action override (e.g. "ban", "tmute") when present. */
  action?: string;
  /** Parsed duration for timed per-entry actions. */
  durationSeconds?: number;
}

/**
 * Substring test where the pattern may embed `?`/`*`/`**` wildcards
 * (used by name:/username: triggers).
 */
function wildcardIncludes(haystack: string, pattern: string): boolean {
  if (!/[*?\\]/.test(pattern)) return haystack.includes(pattern);
  try {
    return new RegExp(wildcardToRegexSource(pattern), 'i').test(haystack);
  } catch {
    return false;
  }
}

/** Normalizes text: accent folding, whitespace collapse, lowercase. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Strips common lookalike character substitutions (0→o, 1→i, 3→e, ...). */
function foldLookalikes(text: string): string {
  const map: Record<string, string> = {
    '0': 'o',
    '1': 'i',
    '3': 'e',
    '4': 'a',
    '5': 's',
    '@': 'a',
    $: 's',
  };
  return text.replace(/[01345@$]/g, (char) => map[char] ?? char);
}

/**
 * Converts a wildcard trigger into a regular expression source string.
 * `?` = exactly one non-space char, `*` = 0+ non-space chars,
 * `**` = any characters including spaces, `\` escapes the next char.
 */
function wildcardToRegexSource(trigger: string): string {
  let source = '';
  for (let i = 0; i < trigger.length; i++) {
    const char = trigger[i];
    if (char === '\\' && i + 1 < trigger.length) {
      source += trigger[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      continue;
    }
    if (char === '*') {
      if (trigger[i + 1] === '*') {
        i++;
        source += '[\\s\\S]*';
      } else {
        source += '[^\\s]*';
      }
      continue;
    }
    if (char === '?') {
      source += '[^\\s]';
      continue;
    }
    source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return source;
}

/** Parses "1h30m"-style compact durations inside action braces. */
function parseCompactDuration(text: string): number | undefined {
  const matches = [...text.matchAll(/(\d+)([smhd])/g)];
  if (matches.length === 0) return undefined;
  const units: Record<string, number> = { s: 1, m: 60, h: 3_600, d: 86_400 };
  const total = matches.reduce((sum, match) => sum + Number(match[1]) * units[match[2]], 0);
  return total > 0 ? total : undefined;
}

/** Splits `{action [duration]}` suffix off a trigger entry. */
function parseEntry(raw: string): { body: string; action?: string; durationSeconds?: number } {
  const match = raw.match(/\s*\{([a-z]+)(?:\s+([\dsmh]+))?\}\s*$/i);
  if (!match) return { body: raw.trim() };
  return {
    body: raw.slice(0, match.index).trim(),
    action: match[1].toLowerCase(),
    durationSeconds: match[2] ? parseCompactDuration(match[2]) : undefined,
  };
}

/**
 * Evaluates blocklist triggers against a message. Word triggers match on
 * normalized word boundaries; `prefix:` anchors at message start; `exact:`
 * requires the whole message; `lookalike:` folds substitutions first;
 * non-text triggers inspect files, names, usernames, forwards, and sticker
 * packs. Admins/approved filtering happens in the runtime, not here.
 *
 * @param {string[]} triggers - Configured blocklist entries.
 * @param {Message} msg - Telegram message to test.
 * @param {User} from - Message author (for name/username triggers).
 * @returns {BlocklistMatch | null} Match details, or null when clean.
 */
export function matchBlocklist(
  triggers: string[],
  msg: Message,
  from: User,
): BlocklistMatch | null {
  const text = msg.text ?? msg.caption ?? '';
  const normalized = normalize(text);
  const displayName = normalize([from.first_name, from.last_name].filter(Boolean).join(' '));
  const username = from.username ? from.username.toLowerCase() : '';
  const fileName = msg.document?.file_name?.toLowerCase() ?? '';
  const stickerPack = msg.sticker?.set_name?.toLowerCase() ?? '';
  const forwardFrom =
    msg.forward_origin?.type === 'user'
      ? {
          id: msg.forward_origin.sender_user?.id,
          username: msg.forward_origin.sender_user?.username?.toLowerCase(),
        }
      : msg.forward_origin?.type === 'channel'
        ? {
            id: msg.forward_origin.chat.id,
            username: msg.forward_origin.chat.username?.toLowerCase(),
          }
        : null;

  for (const raw of triggers) {
    if (!raw || !raw.trim()) continue;
    const { body, action, durationSeconds } = parseEntry(raw);
    if (!body) continue;

    // Non-text trigger families.
    if (body.startsWith('file:')) {
      const pattern = body.slice('file:'.length);
      if (fileName && new RegExp(`^${wildcardToRegexSource(pattern)}$`, 'i').test(fileName)) {
        return { trigger: raw, action, durationSeconds };
      }
      continue;
    }
    if (body.startsWith('name:')) {
      const pattern = normalize(body.slice('name:'.length));
      if (pattern && wildcardIncludes(displayName, pattern)) {
        return { trigger: raw, action, durationSeconds };
      }
      continue;
    }
    if (body.startsWith('username:')) {
      const pattern = normalize(body.slice('username:'.length));
      if (pattern && wildcardIncludes(username, pattern)) {
        return { trigger: raw, action, durationSeconds };
      }
      continue;
    }
    if (body.startsWith('forward:')) {
      const value = body.slice('forward:'.length).toLowerCase();
      if (
        forwardFrom &&
        (String(forwardFrom.id ?? '') === value || forwardFrom.username === value)
      ) {
        return { trigger: raw, action, durationSeconds };
      }
      continue;
    }
    if (body.startsWith('stickerpack:')) {
      const value = body.slice('stickerpack:'.length).toLowerCase();
      if (stickerPack === value) return { trigger: raw, action, durationSeconds };
      continue;
    }

    // Textual trigger modes.
    if (body.startsWith('prefix:')) {
      const pattern = normalize(body.slice('prefix:'.length));
      if (pattern && normalized.startsWith(pattern)) {
        return { trigger: raw, action, durationSeconds };
      }
      continue;
    }
    if (body.startsWith('exact:')) {
      const pattern = normalize(body.slice('exact:'.length));
      if (pattern && normalized === pattern) return { trigger: raw, action, durationSeconds };
      continue;
    }
    if (body.startsWith('lookalike:')) {
      const pattern = foldLookalikes(normalize(body.slice('lookalike:'.length)));
      if (pattern && foldLookalikes(normalized).includes(pattern)) {
        return { trigger: raw, action, durationSeconds };
      }
      continue;
    }

    // Default: wildcard word/phrase match on normalized text.
    const source = wildcardToRegexSource(normalize(body));
    if (!source) continue;
    try {
      if (new RegExp(`(^|\\s)${source}(\\s|$)`, 'i').test(normalized)) {
        return { trigger: raw, action, durationSeconds };
      }
    } catch {
      // Malformed wildcard entries are tolerated (reference-like leniency).
    }
  }
  return null;
}
