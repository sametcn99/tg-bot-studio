import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Studio-wide audit trail for security-relevant operations. Extends the
 * auth-only SecurityLog coverage with configuration, lifecycle, and
 * broadcast events so operators can answer "who changed what, when".
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records one audit event. Fire-and-forget safe: failures never break the
   * triggering operation.
   * @param {string} event - Stable event name (`bot.delete`, `module.update`, ...).
   * @param {Record<string, unknown>} [details] - Structured context (ids, names).
   * @returns {void}
   */
  log(event: string, details?: Record<string, unknown>): void {
    void this.prisma.securityLog
      .create({
        data: {
          event,
          details: details ? JSON.stringify(details).slice(0, 2000) : null,
          createdAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);
  }
}
