import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { SseTicketService } from './sse-ticket.service';
import { ChangeMasterKeyDto, LoginDto } from './dto/auth.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentSession } from '../common/decorators/current-session.decorator';
import { SESSION_COOKIE } from './jwt.strategy';

/** Session cookie lifetime, matching the JWT expiry. */
const SESSION_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Authentication, session, and security audit endpoints for the studio
 * dashboard. All routes except `login` require a valid JWT.
 */
@Controller('auth')
export class AuthController {
  /**
   * @param {AuthService} authService - Session and master key service.
   * @param {SseTicketService} sseTickets - One-time SSE ticket issuer.
   */
  constructor(
    private readonly authService: AuthService,
    private readonly sseTickets: SseTicketService,
  ) {}

  /**
   * Exchanges the master key for a JWT session token. The token is delivered
   * both as an HttpOnly SameSite=Strict cookie (the dashboard's transport)
   * and in the response body (for API clients using bearer headers).
   * @param {LoginDto} body - Submitted master key.
   * @param {Request} req - Request used to capture IP and User-Agent.
   * @param {Response} res - Response used to set the session cookie.
   * @returns {Promise<{token: string; session: object}>} Signed token and session metadata.
   * @throws {UnauthorizedException} When the master key is invalid.
   */
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip || 'unknown';
    const userAgent = (req.headers['user-agent'] as string) || 'unknown';
    const result = await this.authService.login(body.masterKey, ip, userAgent);
    res.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure,
      path: '/',
      maxAge: SESSION_COOKIE_MAX_AGE_MS,
    });
    return result;
  }

  /**
   * Mints a one-time, 30-second ticket for authenticating `EventSource` SSE
   * streams, whose requests cannot carry headers or cookies reliably.
   * @param {object} session - Authenticated session payload.
   * @param {string} session.sessionId - Active session identifier.
   * @param {Request} req - Request carrying the bearer token to bind.
   * @returns {{ticket: string}} Single-use ticket for `?sse_ticket=`.
   */
  @Post('sse-ticket')
  @HttpCode(200)
  sseTicket(
    @CurrentSession() session: { sessionId: string },
    @Req() req: Request,
  ): { ticket: string } {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      // The cookie transport does not need tickets (cookies ride along with
      // the EventSource request on same-origin deployments); only mint tickets
      // for bearer-authenticated clients.
      throw new BadRequestException('SSE tickets require bearer authentication');
    }
    void session;
    return { ticket: this.sseTickets.issue(token) };
  }

  /**
   * Revokes the current session and clears the session cookie.
   * @param {object} session - Authenticated session payload.
   * @param {string} session.sessionId - Session to revoke.
   * @param {Response} res - Response used to clear the cookie.
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Post('logout')
  @HttpCode(200)
  logout(
    @CurrentSession() session: { sessionId: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    this.authService.logout(session.sessionId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { success: true };
  }

  /**
   * Returns the current session record.
   * @param {object} session - Authenticated session payload.
   * @param {string} session.sessionId - Session identifier.
   * @returns {object} Session row for the active token.
   */
  @Get('me')
  me(@CurrentSession() session: { sessionId: string }) {
    return this.authService.getSession(session.sessionId);
  }

  /**
   * Lists all dashboard sessions.
   * @returns {object[]} Session rows, newest first.
   */
  @Get('sessions')
  listSessions() {
    return this.authService.listSessions();
  }

  /**
   * Revokes a specific session by identifier.
   * @param {string} id - Session identifier to revoke.
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Delete('sessions/:id')
  revokeSession(@Param('id') id: string) {
    this.authService.logout(id);
    return { success: true };
  }

  /**
   * Revokes every session except the current one.
   * @param {object} session - Authenticated session payload.
   * @param {string} session.sessionId - Session to keep alive.
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Post('sessions/revoke-others')
  @HttpCode(200)
  revokeOthers(@CurrentSession() session: { sessionId: string }) {
    this.authService.revokeOtherSessions(session.sessionId);
    return { success: true };
  }

  /**
   * Rotates the studio master key.
   * @param {ChangeMasterKeyDto} body - Current and replacement keys.
   * @param {Request} req - Request used for audit logging.
   * @returns {Promise<{success: boolean}>} Confirmation payload.
   * @throws {UnauthorizedException} When the current key is incorrect.
   */
  @Post('change-key')
  @HttpCode(200)
  async changeKey(@Body() body: ChangeMasterKeyDto, @Req() req: Request) {
    const ip = req.ip || 'unknown';
    await this.authService.changeMasterKey(body.currentKey, body.newKey, ip);
    return { success: true };
  }

  /**
   * Returns recent security audit log entries.
   * @returns {object[]} Newest security events first.
   */
  @Get('security-logs')
  securityLogs() {
    return this.authService.listSecurityLogs();
  }

  /**
   * Evaluates deployment posture and returns warning flags.
   */
  @Get('security-status')
  securityStatus() {
    return this.authService.getSecurityStatus();
  }
}
