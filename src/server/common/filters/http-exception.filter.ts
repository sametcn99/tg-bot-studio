import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

/**
 * HTTP status to machine-readable error code fallback used when the thrown
 * exception carries no explicit `code`.
 */
const STATUS_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL',
};

/**
 * Global exception filter translating every unhandled error into a uniform
 * JSON envelope `{ statusCode, message, code, error }` without leaking stack
 * traces. The `code` field lets the dashboard localize errors.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  /**
   * Serializes the caught exception into the HTTP response.
   * @param {unknown} exception - Thrown error or HttpException.
   * @param {ArgumentsHost} host - Context providing the response object.
   * @returns {void}
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const payload =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: 'Internal server error', error: 'Internal Server Error' };

    // Class-validator rejections arrive as message arrays; give them a
    // dedicated code so the client can show a localized summary.
    const isValidationArray =
      typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).message);
    const derivedCode = isValidationArray ? 'VALIDATION_ERROR' : STATUS_CODES[status];

    if (status >= 500) {
      this.logger.error(
        `Unhandled error: ${exception instanceof Error ? exception.stack : String(exception)}`,
      );
    }

    const body =
      typeof payload === 'string'
        ? { statusCode: status, message: payload, code: derivedCode ?? 'HTTP_ERROR' }
        : {
            statusCode: status,
            code: derivedCode,
            ...(payload as Record<string, unknown>),
          };

    response.status(status).json(body);
  }
}
