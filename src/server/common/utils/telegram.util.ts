import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Telegram API integration helpers shared across services.
 * @module common/utils/telegram
 */

/**
 * Response subset returned by the Telegram `getMe` method.
 * @interface TelegramMeInfo
 * @property {number} id - Bot user identifier.
 * @property {string} username - Bot @username without the leading @.
 * @property {string} first_name - Bot display name.
 * @property {boolean} can_join_groups - Whether the bot can be added to groups.
 * @property {boolean} can_read_all_group_messages - Privacy mode status.
 */
export interface TelegramMeInfo {
  id: string;
  username: string;
  first_name: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
}

/**
 * Result of a Telegram API token validation call.
 * @interface GetMeResult
 * @property {boolean} ok - True when Telegram accepted the token.
 * @property {TelegramMeInfo} [bot] - Bot profile when valid.
 * @property {string} [description] - Telegram error description when invalid.
 */
export interface GetMeResult {
  ok: boolean;
  bot?: TelegramMeInfo;
  description?: string;
}

/**
 * Validates a BotFather token by calling Telegram `getMe`.
 *
 * @param {string} token - Full bot API token.
 * @returns {Promise<GetMeResult>} Validation outcome with bot profile or error.
 * @example
 * const result = await callGetMe('123456:ABC-DEF...');
 */
export async function callGetMe(token: string): Promise<GetMeResult> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const payload = (await response.json()) as {
      ok: boolean;
      result?: TelegramMeInfo;
      description?: string;
    };
    return {
      ok: Boolean(payload.ok && payload.result),
      bot: payload.result,
      description: payload.description,
    };
  } catch (error) {
    return { ok: false, description: error instanceof Error ? error.message : 'Network error' };
  }
}

/**
 * Parsed Telegram Mini App `initData` validation outcome.
 * @interface InitDataValidation
 * @property {boolean} valid - True when the HMAC-SHA256 signature matches and
 * the payload is fresh.
 * @property {number} [userId] - Telegram id of the Mini App user.
 * @property {string} [raw] - Original initData string.
 * @property {'signature' | 'expired' | 'malformed'} [reason] - Rejection cause.
 */
export interface InitDataValidation {
  valid: boolean;
  userId?: number;
  raw?: string;
  reason?: 'signature' | 'expired' | 'malformed';
}

/**
 * Maximum age of `initData` `auth_date`. Following Telegram's guidance,
 * initData is treated as a short-lived credential: an intercepted query
 * string older than this is rejected and cannot be replayed forever.
 */
export const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * Validates Telegram Mini App `initData` using the official HMAC-SHA256
 * scheme (secret = HMAC("WebAppData", botToken)). The hash comparison is
 * constant-time and `auth_date` must be fresher than
 * {@link INIT_DATA_MAX_AGE_SECONDS} (replay protection).
 *
 * @param {string} initData - Raw initData query string from the WebApp SDK.
 * @param {string} botToken - Token of the bot owning the Mini App.
 * @param {number} [maxAgeSeconds] - Freshness window override (tests).
 * @returns {InitDataValidation} Validation result including the parsed user id.
 * @example
 * const check = validateInitData(initData, botToken);
 */
export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds: number = INIT_DATA_MAX_AGE_SECONDS,
): InitDataValidation {
  try {
    const params = new URLSearchParams(initData);
    const providedHash = params.get('hash');
    if (!providedHash) return { valid: false, reason: 'malformed' };

    params.delete('hash');
    const dataCheckString = [...params.entries()]
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join('\n');

    const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest();

    const providedBuffer = Buffer.from(providedHash, 'hex');
    if (
      providedBuffer.length !== computedHash.length ||
      !timingSafeEqual(providedBuffer, computedHash)
    ) {
      return { valid: false, reason: 'signature' };
    }

    const authDate = Number(params.get('auth_date'));
    if (!Number.isFinite(authDate) || authDate <= 0) {
      return { valid: false, reason: 'malformed' };
    }
    if (authDate * 1000 < Date.now() - maxAgeSeconds * 1000) {
      return { valid: false, reason: 'expired' };
    }

    let userId: number | undefined;
    const userRaw = params.get('user');
    if (userRaw) {
      const user = JSON.parse(userRaw) as { id?: number };
      userId = user.id;
    }
    return { valid: true, userId, raw: initData };
  } catch {
    return { valid: false, reason: 'malformed' };
  }
}
