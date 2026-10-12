import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Authenticated session payload attached to the request after JWT validation.
 * @interface AuthenticatedSession
 * @property {string} sessionId - Identifier of the active dashboard session row.
 */
export interface AuthenticatedSession {
  sessionId: string;
}

/**
 * Injects the authenticated session payload into a handler parameter.
 * @returns {ParameterDecorator} Decorator resolving the current session.
 * @throws {UnauthorizedException} Indirectly, when the route lacks a valid JWT.
 * @example
 * \@Get('whoami')
 * whoami(\@CurrentSession() session: AuthenticatedSession) { ... }
 */
export const CurrentSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedSession => {
    const request = ctx.switchToHttp().getRequest();
    return { sessionId: request.user?.sessionId as string };
  },
);
