import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Global response interceptor wrapping every successful controller return
 * value in a uniform `{ success: true, data }` envelope for the dashboard.
 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  /**
   * Maps the handler result into the standard success envelope.
   * @param {ExecutionContext} _context - Unused execution context.
   * @param {CallHandler} next - Next handler in the chain.
   * @returns {Observable<{success: boolean; data: unknown}>} Wrapped stream.
   */
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<{ success: boolean; data: unknown }> {
    return next.handle().pipe(map((data) => ({ success: true, data })));
  }
}
