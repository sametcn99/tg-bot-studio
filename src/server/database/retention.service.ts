import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { BackupService } from './backup.service';

/** Default retention windows in days (0 disables pruning for the table). */
const DEFAULTS = {
  aiChatDays: 90,
  supportMessagesDays: 180,
  securityLogsDays: 180,
  ordersDays: 365,
  linksDays: 90,
  healthEventsDays: 30,
  broadcastsDays: 180,
  sessionsDays: 30,
  flowStateOrphanDays: 30,
  volumeKeysDays: 7,
} as const;

/**
 * Periodic cleanup for unbounded growth tables. Windows are configurable
 * through environment variables (RETENTION_AI_CHAT_DAYS, ...); `0` disables
 * pruning for that table. Runs every 6 hours, first pass 1 minute after boot,
 * and additionally triggers a nightly database backup.
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RetentionService.name);
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly startupTimer: ReturnType<typeof setTimeout>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly backupService: BackupService,
  ) {
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
   * Executes one pruning pass across the retention-managed tables and fires
   * the nightly backup when the UTC day rolled over.
   * @returns {Promise<void>} Resolves after all deletions complete.
   */
  private async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const lt = (days: number): string | null =>
        days > 0 ? new Date(Date.now() - days * 86_400_000).toISOString() : null;

      const passes: Array<[string, number, () => Promise<number>]> = [];

      const aiCutoff = lt(this.window('RETENTION_AI_CHAT_DAYS', DEFAULTS.aiChatDays));
      if (aiCutoff) {
        passes.push([
          'ai_chat_history',
          DEFAULTS.aiChatDays,
          () =>
            this.prisma.aiChatHistory
              .deleteMany({ where: { createdAt: { lt: aiCutoff } } })
              .then((r) => r.count),
        ]);
      }

      const supportCutoff = lt(this.window('RETENTION_SUPPORT_DAYS', DEFAULTS.supportMessagesDays));
      if (supportCutoff) {
        passes.push([
          'support_messages',
          DEFAULTS.supportMessagesDays,
          () =>
            this.prisma.supportMessage
              .deleteMany({ where: { createdAt: { lt: supportCutoff } } })
              .then((r) => r.count),
        ]);
      }

      const logsCutoff = lt(this.window('RETENTION_SECURITY_LOGS_DAYS', DEFAULTS.securityLogsDays));
      if (logsCutoff) {
        passes.push([
          'security_logs',
          DEFAULTS.securityLogsDays,
          () =>
            this.prisma.securityLog
              .deleteMany({ where: { createdAt: { lt: logsCutoff } } })
              .then((r) => r.count),
        ]);
      }

      const ordersCutoff = lt(this.window('RETENTION_ORDERS_DAYS', DEFAULTS.ordersDays));
      if (ordersCutoff) {
        passes.push([
          'mini_app_orders',
          DEFAULTS.ordersDays,
          () =>
            this.prisma.miniAppOrder
              .deleteMany({ where: { createdAt: { lt: ordersCutoff } } })
              .then((r) => r.count),
        ]);
      }

      // CTR tracking links of pruned broadcasts (RETENTION_LINKS_DAYS).
      const linksCutoff = lt(this.window('RETENTION_LINKS_DAYS', DEFAULTS.linksDays));
      if (linksCutoff) {
        passes.push([
          'links',
          DEFAULTS.linksDays,
          () =>
            this.prisma.link
              .deleteMany({ where: { createdAt: { lt: linksCutoff } } })
              .then((r) => r.count),
        ]);
      }

      // Health events (RETENTION_HEALTH_DAYS).
      const healthCutoff = lt(this.window('RETENTION_HEALTH_DAYS', DEFAULTS.healthEventsDays));
      if (healthCutoff) {
        passes.push([
          'health_events',
          DEFAULTS.healthEventsDays,
          () =>
            this.prisma.healthEvent
              .deleteMany({ where: { createdAt: { lt: healthCutoff } } })
              .then((r) => r.count),
        ]);
      }

      // Broadcast history (RETENTION_BROADCASTS_DAYS).
      const broadcastCutoff = lt(this.window('RETENTION_BROADCASTS_DAYS', DEFAULTS.broadcastsDays));
      if (broadcastCutoff) {
        passes.push([
          'broadcasts',
          DEFAULTS.broadcastsDays,
          () =>
            this.prisma.broadcast
              .deleteMany({
                where: {
                  createdAt: { lt: broadcastCutoff },
                  status: { notIn: ['running', 'queued'] },
                },
              })
              .then((r) => r.count),
        ]);
      }

      // Stale dashboard sessions (RETENTION_SESSIONS_DAYS since last activity).
      const sessionCutoff = lt(this.window('RETENTION_SESSIONS_DAYS', DEFAULTS.sessionsDays));
      if (sessionCutoff) {
        passes.push([
          'sessions',
          DEFAULTS.sessionsDays,
          () =>
            this.prisma.session
              .deleteMany({ where: { lastActiveAt: { lt: sessionCutoff } } })
              .then((r) => r.count),
        ]);
      }

      for (const [label, , run] of passes) {
        const deleted = await run();
        if (deleted > 0) this.logger.log(`Pruned ${deleted} ${label} rows`);
      }

      await this.pruneOrphanFlowStates();
      await this.pruneVolumeKeys();
      await this.nightlyBackup();
    } catch (error) {
      this.logger.warn(
        `Retention pass failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Sweeps flow sessions abandoned on a waiting-input node — they never
   * expire otherwise (only delay-node sessions have a resumeAt sweep).
   * @returns {Promise<void>} Resolves after the sweep.
   */
  private async pruneOrphanFlowStates(): Promise<void> {
    const days = this.window('RETENTION_FLOW_STATE_ORPHAN_DAYS', DEFAULTS.flowStateOrphanDays);
    if (days <= 0) return;
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const result = await this.prisma.flowState.deleteMany({
      where: { waitInput: 1, updatedAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      this.logger.log(`Pruned ${result.count} abandoned flow_states rows`);
    }
  }

  /**
   * Deletes per-day message-volume counter keys (`msg_volume_YYYY-MM-DD`)
   * older than the window — one row per bot per day adds up for years.
   * @returns {Promise<void>} Resolves after the prune.
   */
  private async pruneVolumeKeys(): Promise<void> {
    const days = this.window('RETENTION_VOLUME_KEYS_DAYS', DEFAULTS.volumeKeysDays);
    if (days <= 0) return;
    const cutoff = Date.now() - days * 86_400_000;
    const rows = await this.prisma.botSetting.findMany({
      where: { key: { startsWith: 'msg_volume_' } },
      select: { botId: true, key: true },
      take: 5_000,
    });
    let deleted = 0;
    for (const row of rows) {
      const dayMs = Date.parse(`${row.key.slice('msg_volume_'.length)}T00:00:00Z`);
      if (Number.isFinite(dayMs) && dayMs < cutoff) {
        await this.prisma.botSetting
          .delete({ where: { botId_key: { botId: row.botId, key: row.key } } })
          .catch(() => undefined);
        deleted++;
      }
    }
    if (deleted > 0) this.logger.log(`Pruned ${deleted} msg_volume_* setting keys`);
  }

  /**
   * Creates one database backup per UTC day (skip when DISABLE_NIGHTLY_BACKUP=1).
   * @returns {Promise<void>} Resolves once the backup (if due) completed.
   */
  private async nightlyBackup(): Promise<void> {
    if (process.env.DISABLE_NIGHTLY_BACKUP === '1') return;
    const today = new Date().toISOString().slice(0, 10);
    const last = await this.prisma.systemSetting
      .findUnique({ where: { key: 'last_nightly_backup' } })
      .catch(() => null);
    if (last?.value === today) return;
    try {
      const info = await this.backupService.createBackup();
      await this.prisma.systemSetting.upsert({
        where: { key: 'last_nightly_backup' },
        create: { key: 'last_nightly_backup', value: today },
        update: { value: today },
      });
      this.logger.log(`Nightly backup created: ${info.filename}`);
    } catch (error) {
      this.logger.warn(
        `Nightly backup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
