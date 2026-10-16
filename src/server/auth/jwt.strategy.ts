import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { SseTicketService } from './sse-ticket.service';
import { resolveJwtSecret } from './auth-defaults';

/**
 * JWT payload embedded in issued session tokens.
 * @interface JwtPayload
 * @property {string} sessionId - Identifier of the active session row.
 */
export interface JwtPayload {
  sessionId: string;
}

/** Name of the HttpOnly session cookie set by the login endpoint. */
export const SESSION_COOKIE = 'studio_session';

/**
 * Reads the session cookie from the raw `Cookie` header without pulling in a
 * parser dependency; the studio only ever sets this one cookie.
 * @param {Request} req - Incoming request.
 * @returns {string | null} Cookie value when present.
 */
function fromCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * Passport strategy validating dashboard JWTs. Tokens are accepted from, in
 * order: the Authorization bearer header, the HttpOnly session cookie, or a
 * one-time SSE ticket (`?sse_ticket=`) minted for `EventSource` streams. The
 * old practice of passing the raw JWT as `?access_token=` is intentionally
 * not supported — long-lived credentials must never appear in URLs.
 *
 * A token is accepted only when its underlying session row exists and has not
 * been revoked; every accepted request refreshes `last_active_at`.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  /**
   * @param {AuthService} authService - Session validation service.
   * @param {SseTicketService} sseTickets - One-time SSE ticket store.
   */
  constructor(
    private readonly authService: AuthService,
    private readonly sseTickets: SseTicketService,
  ) {
    super({
      jwtFromRequest: (req: Request) => this.extractToken(req),
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret(),
    });
  }

  /**
   * Resolves the raw JWT for a request across the supported transports.
   * @param {Request} req - Incoming request.
   * @returns {string | null} Raw JWT when present.
   */
  private extractToken(req: Request): string | null {
    const bearer = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    if (bearer) return bearer;
    const cookie = fromCookie(req);
    if (cookie) return cookie;
    const ticket = typeof req.query?.sse_ticket === 'string' ? req.query.sse_ticket : null;
    if (ticket) return this.sseTickets.consume(ticket);
    return null;
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
