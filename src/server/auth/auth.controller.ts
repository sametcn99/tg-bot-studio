import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { ChangeMasterKeyDto, LoginDto } from './dto/auth.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentSession } from '../common/decorators/current-session.decorator';

/**
 * Authentication, session, and security audit endpoints for the studio
 * dashboard. All routes except `login` require a valid JWT.
 */
@Controller('auth')
export class AuthController {
  /**
   * @param {AuthService} authService - Session and master key service.
   */
  constructor(private readonly authService: AuthService) {}

  /**
   * Exchanges the master key for a JWT session token.
   * @param {LoginDto} body - Submitted master key.
   * @param {Request} req - Request used to capture IP and User-Agent.
   * @returns {Promise<{token: string; session: object}>} Signed token and session metadata.
   * @throws {UnauthorizedException} When the master key is invalid.
   */
  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginDto, @Req() req: Request) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
    const userAgent = (req.headers['user-agent'] as string) || 'unknown';
    return this.authService.login(body.masterKey, ip, userAgent);
  }

  /**
   * Revokes the current session.
   * @param {object} session - Authenticated session payload.
   * @param {string} session.sessionId - Session to revoke.
   * @returns {{success: boolean}} Confirmation payload.
   */
  @Post('logout')
  @HttpCode(200)
  logout(@CurrentSession() session: { sessionId: string }) {
    this.authService.logout(session.sessionId);
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
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
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
