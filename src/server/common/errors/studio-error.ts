import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Machine-readable error code carried in the API error envelope so the
 * dashboard can localize messages. Services throw this instead of bare
 * BadRequest/NotFound exceptions whenever the client needs a translatable
 * message; all other errors fall back to a status-derived code.
 * @example throw new StudioException('BOT_NOT_RUNNING', 'Bot is not running');
 */
export class StudioException extends HttpException {
  /** Stable SCREAMING_SNAKE code shared with the client error catalog. */
  public readonly code: string;

  /**
   * @param {string} code - Machine-readable code (`errors.<code>` i18n key).
   * @param {string} message - Human-readable English fallback text.
   * @param {HttpStatus} [status] - HTTP status (default 400).
   */
  constructor(code: string, message: string, status: HttpStatus = HttpStatus.BAD_REQUEST) {
    super({ message, code }, status);
    this.code = code;
  }
}
