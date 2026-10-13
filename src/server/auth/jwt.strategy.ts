import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { AuthService } from './auth.service';

/**
 * JWT payload embedded in issued session tokens.
 * @interface JwtPayload
 * @property {string} sessionId - Identifier of the active session row.
 */
export interface JwtPayload {
  sessionId: string;
}

/**
 * Token extractor: Authorization bearer header first, then the
 * `access_token` query parameter so EventSource (which cannot set headers)
 * can authenticate the SSE streams.
 * @param {Request} req - Incoming request.
 * @returns {string | null} Raw JWT when present.
 */
function fromHeaderOrQuery(req: Request): string | null {
  return (
    ExtractJwt.fromAuthHeaderAsBearerToken()(req) ??
    (typeof req.query?.access_token === 'string' ? req.query.access_token : null)
  );
}

/**
 * Passport strategy validating dashboard JWTs. A token is accepted only when
 * its underlying session row exists and has not been revoked; every accepted
 * request refreshes the session's `last_active_at` timestamp.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  /**
   * @param {AuthService} authService - Session validation service.
   */
  constructor(private readonly authService: AuthService) {
    super({
      jwtFromRequest: fromHeaderOrQuery,
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'change_this_secret_in_production',
    });
  }

  /**
   * Validates the decoded JWT against the sessions table.
   * @param {JwtPayload} payload - Decoded token payload.
   * @returns {Promise<{sessionId: string}>} Principal attached to the request.
   * @throws {UnauthorizedException} When the session is missing or revoked.
   */
  async validate(payload: JwtPayload): Promise<{ sessionId: string }> {
    const valid = await this.authService.isSessionValid(payload.sessionId);
    if (!valid) {
      throw new UnauthorizedException('Session is no longer valid');
    }
    return { sessionId: payload.sessionId };
  }
}
