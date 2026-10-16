import { Controller, Get, Header, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from '../auth/auth.service';
import { MetricsService } from './metrics.service';

/**
 * Prometheus scraper endpoint. Rendered with `@Res()` so the global
 * `{success, data}` envelope interceptor does not wrap the exposition text.
 *
 * The endpoint used to be fully public — leaking bot usernames, audience
 * sizes, and module inventory to anyone who could reach the port. It is now
 * gated: requests pass with either `Authorization: Bearer $METRICS_BEARER_TOKEN`
 * (the recommended transport for scrapers) or a valid dashboard session JWT.
 */
@Controller('metrics')
export class MetricsController {
  /**
   * @param {MetricsService} metrics - Metric collector and renderer.
   * @param {JwtService} jwtService - Verifies dashboard JWTs for scraper fallback.
   * @param {AuthService} authService - Session validation for the verified JWT.
   */
  constructor(
    private readonly metrics: MetricsService,
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Serves the current metrics snapshot in Prometheus text format after
   * authenticating the scraper.
   * @param {Request} req - Request carrying the bearer token.
   * @param {Response} res - Express response written directly.
   * @returns {Promise<void>} Resolves once the payload is sent.
   * @throws {UnauthorizedException} When neither a metrics token nor a valid session is presented.
   */
  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  async scrape(@Req() req: Request, @Res() res: Response): Promise<void> {
    const metricsToken = process.env.METRICS_BEARER_TOKEN;
    const auth = req.headers.authorization;

    let authorized = false;
    if (metricsToken && auth === `Bearer ${metricsToken}`) {
      authorized = true;
    } else if (auth?.startsWith('Bearer ')) {
      try {
        const payload = this.jwtService.verify<{ sessionId: string }>(auth.slice(7));
        authorized = await this.authService.isSessionValid(payload.sessionId);
      } catch {
        authorized = false;
      }
    }
    if (!authorized) {
      throw new UnauthorizedException(
        'Set METRICS_BEARER_TOKEN and send it as a bearer header to scrape metrics',
      );
    }

    const body = await this.metrics.render();
    res.type('text/plain; version=0.0.4; charset=utf-8').send(body);
  }
}
