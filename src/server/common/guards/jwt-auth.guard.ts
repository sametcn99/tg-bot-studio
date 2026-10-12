import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Global JWT authentication guard protecting every API route.
 * Routes decorated with `@Public()` (login, health, public TMA config,
 * tracking redirects) bypass authentication.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  /**
   * @param {Reflector} reflector - Route metadata reader.
   */
  constructor(private readonly reflector: Reflector) {
    super();
  }

  /**
   * Determines whether the current route requires authentication.
   * @param {ExecutionContext} context - Execution context of the active route.
   * @returns {boolean | Promise<boolean> | Observable<boolean>} True when the
   * route is public (auth skipped), otherwise the passport verdict.
   */
  override canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
