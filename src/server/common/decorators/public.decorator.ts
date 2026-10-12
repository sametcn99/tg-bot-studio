import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key marking a route as publicly accessible (skipping JWT auth).
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a controller route or whole controller as public. The global
 * {@link JwtAuthGuard} reads this metadata and skips authentication.
 *
 * @returns {MethodDecorator & ClassDecorator} Decorator applicable to routes and controllers.
 * @example
 * \@Public()
 * \@Get('health')
 * getHealth() { ... }
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
