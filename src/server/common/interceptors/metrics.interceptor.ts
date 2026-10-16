import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { httpMetricsStore } from '../../metrics/http-metrics.store';

/**
 * Records per-route request counts, error counts, and latency for the
 * Prometheus exposition (`tg_studio_http_request_duration_seconds`). Path
 * parameters are collapsed so route labels stay low-cardinality.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  /**
   * Times the handler and pushes an observation.
   * @param {ExecutionContext} context - Route execution context.
   * @param {CallHandler} next - Handler stream.
   * @returns {Observable<unknown>} The handler stream, timed.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = Date.now();
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { routePath?: string }>();
    return next.handle().pipe(
      tap({
        next: () => this.record(req, http.getResponse<Response>(), started),
        error: () => this.record(req, http.getResponse<Response>(), started, true),
      }),
    );
  }

  /**
   * Pushes one observation with the route pattern (Express `route.path`).
   * @param {Request} req - Incoming request.
   * @param {Response} res - Response (for the status code).
   * @param {number} started - Start epoch ms.
   * @param {boolean} [thrown] - Whether the handler threw.
   * @returns {void}
   */
  private record(req: Request, res: Response, started: number, thrown?: boolean): void {
    try {
      const routePath = (req.route?.path as string | undefined) ?? req.path ?? 'unmatched';
      const baseUrl = req.baseUrl ?? '';
      const status = res.statusCode ?? 0;
      httpMetricsStore.observe(
        req.method ?? 'GET',
        `${baseUrl}${routePath}`.replace(/\/:([A-Za-z0-9_]+)/g, '/:$1'),
        Date.now() - started,
        thrown === true || status >= 400,
      );
    } catch {
      // Metrics must never break the request path.
    }
  }
}
