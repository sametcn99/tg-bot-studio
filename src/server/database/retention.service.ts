import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Default retention windows in days (0 disables pruning for the table). */
const DEFAULTS = {
  aiChatDays: 90,
  supportMessagesDays: 180,
  securityLogsDays: 180,
  ordersDays: 365,
} as const;

/**
 * Periodic cleanup for unbounded growth tables. Windows are configurable
 * through environment variables (RETENTION_AI_CHAT_DAYS, ...); `0` disables
 * pruning for that table. Runs every 6 hours, first pass 1 minute after boot.
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RetentionService.name);
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly startupTimer: ReturnType<typeof setTimeout>;
  private running = false;

  constructor(private readonly prisma: PrismaService) {
    this.timer = setInterval(() => void this.runOnce(), 6 * 3_600_000);
    this.startupTimer = setTimeout(() => void this.runOnce(), 60_000);
  }

  /** Kicks off the first pruning pass shortly after boot. */
  onModuleInit(): void {
    void this.runOnce();
  }

  /** Clears timers on shutdown. */
  onApplicationShutdown(): void {
    clearInterval(this.timer);
    clearTimeout(this.startupTimer);
  }

  /**
   * Reads a retention window from the environment.
   * @param {string} env - Environment variable name.
   * @param {number} fallback - Default window in days.
   * @returns {number} Window in days (0 = disabled).
   */
  private window(env: string, fallback: number): number {
    const parsed = Number(process.env[env]);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
  }

  /**
   * Executes one pruning pass across the retention-managed tables.
   * @returns {Promise<void>} Resolves after all deletions complete.
   */
  private async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const cutoff = (days: number): string | null =>
        days > 0 ? new Date(Date.now() - days * 86_400_000).toISOString() : null;

      const aiChatCutoff = cutoff(this.window('RETENTION_AI_CHAT_DAYS', DEFAULTS.aiChatDays));
      if (aiChatCutoff) {
        const result = await this.prisma.aiChatHistory.deleteMany({
          where: { createdAt: { lt: aiChatCutoff } },
        });
        if (result.count > 0) this.logger.log(`Pruned ${result.count} ai_chat_history rows`);
      }

      const supportCutoff = cutoff(
        this.window('RETENTION_SUPPORT_DAYS', DEFAULTS.supportMessagesDays),
      );
      if (supportCutoff) {
        const result = await this.prisma.supportMessage.deleteMany({
          where: { createdAt: { lt: supportCutoff } },
        });
        if (result.count > 0) this.logger.log(`Pruned ${result.count} support_messages rows`);
      }

      const logsCutoff = cutoff(
        this.window('RETENTION_SECURITY_LOGS_DAYS', DEFAULTS.securityLogsDays),
      );
      if (logsCutoff) {
        const result = await this.prisma.securityLog.deleteMany({
          where: { createdAt: { lt: logsCutoff } },
        });
        if (result.count > 0) this.logger.log(`Pruned ${result.count} security_logs rows`);
      }

      const ordersCutoff = cutoff(this.window('RETENTION_ORDERS_DAYS', DEFAULTS.ordersDays));
      if (ordersCutoff) {
        const result = await this.prisma.miniAppOrder.deleteMany({
          where: { createdAt: { lt: ordersCutoff } },
        });
        if (result.count > 0) this.logger.log(`Pruned ${result.count} mini_app_orders rows`);
      }
    } catch (error) {
      this.logger.warn(
        `Retention pass failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
