import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { DatabaseService } from '../../database/database.service';
import { validateInitData } from '../utils/telegram.util';

/**
 * Authenticated Mini App user attached to the request after validation.
 * @interface TmaUser
 * @property {number} id - Telegram user id.
 * @property {string} [first_name] - Telegram first name.
 * @property {string} [username] - Telegram @username.
 * @property {string} [language_code] - Client language.
 */
export interface TmaUser {
  id: number;
  first_name?: string;
  username?: string;
  language_code?: string;
}

/**
 * Guard validating Telegram Mini App `initData` (HMAC-SHA256, official
 * WebAppData scheme) against the token of the bot that owns the app. The
 * raw string travels in the `X-Telegram-Init-Data` header; the resolved
 * user is exposed as `request.tmaUser`.
 */
@Injectable()
export class TmaInitDataGuard implements CanActivate {
  /**
   * @param {DatabaseService} db - SQLite access service.
   */
  constructor(private readonly db: DatabaseService) {}

  /**
   * Validates the initData signature for the app resolved from `:slug`.
   * @param {ExecutionContext} context - Route execution context.
   * @returns {Promise<boolean>} True when the signature is valid.
   * @throws {UnauthorizedException} When the header, app, bot, or signature is invalid.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { tmaUser?: TmaUser }>();
    const initData = request.headers['x-telegram-init-data'];
    if (typeof initData !== 'string' || initData.length === 0) {
      throw new UnauthorizedException('Missing Telegram initData');
    }
    const slug = String(request.params.slug ?? '');
    if (!slug) throw new UnauthorizedException('Missing Mini App slug');

    const app = this.db.get<{ bot_id: number }>(
      'SELECT bot_id FROM mini_apps WHERE slug = ? AND is_active = 1',
      slug,
    );
    if (!app) throw new UnauthorizedException('Unknown Mini App');

    const bot = this.db.get<{ token: string }>('SELECT token FROM bots WHERE id = ?', app.bot_id);
    if (!bot) throw new UnauthorizedException('Owning bot not found');

    const validation = validateInitData(initData, bot.token);
    if (!validation.valid || !validation.userId) {
      throw new UnauthorizedException('Invalid initData signature');
    }

    request.tmaUser = this.parseUser(initData);
    return true;
  }

  /**
   * Extracts the user object from the initData query string.
   * @param {string} initData - Raw initData string.
   * @returns {TmaUser} Parsed Mini App user.
   */
  private parseUser(initData: string): TmaUser {
    const params = new URLSearchParams(initData);
    const raw = params.get('user');
    if (!raw) return { id: 0 };
    try {
      const user = JSON.parse(raw) as Partial<TmaUser> & { id: number };
      return {
        id: user.id,
        first_name: user.first_name,
        username: user.username,
        language_code: user.language_code,
      };
    } catch {
      return { id: 0 };
    }
  }
}
