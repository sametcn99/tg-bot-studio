import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import { PrismaService } from '../database/prisma.service';
import { BotPoolService } from '../bot-engine/bot-pool.service';
import { HTTP_BUCKETS_MS, httpMetricsStore } from './http-metrics.store';

/** One rendered Prometheus metric line pair (HELP/TYPE + samples). */
interface MetricLines {
  name: string;
  help: string;
  type: 'counter' | 'gauge';
  /** `[labels, value]` pairs; labels already serialized or empty string. */
  samples: Array<{ labels: string; value: number }>;
}

/**
 * Collects studio runtime metrics and renders them in the Prometheus text
 * exposition format (version 0.0.4) for the `/api/metrics` scraper endpoint.
 */
@Injectable()
export class MetricsService {
  /** Process start time used for the uptime gauge. */
  private readonly startedAt = Date.now();

  /**
   * @param {PrismaService} prisma - Prisma ORM access service.
   * @param {BotPoolService} pool - Multi-bot runtime pool.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly pool: BotPoolService,
  ) {}

  /**
   * Renders every collected metric in Prometheus text format.
   * @returns {Promise<string>} Full exposition payload ending with a newline.
   */
  async render(): Promise<string> {
    const metrics: MetricLines[] = [];

    metrics.push({
      name: 'tg_studio_uptime_seconds',
      help: 'Seconds since the studio server process started.',
      type: 'gauge',
      samples: [{ labels: '', value: Math.floor((Date.now() - this.startedAt) / 1000) }],
    });

    metrics.push({
      name: 'process_resident_memory_bytes',
      help: 'Resident memory size of the studio process.',
      type: 'gauge',
      samples: [{ labels: '', value: process.memoryUsage().rss }],
    });

    const [bots, userCount, moduleRows, broadcastRows, runningBroadcasts] = await Promise.all([
      this.prisma.bot.findMany({ orderBy: { id: 'asc' } }),
      this.prisma.botUser.count(),
      this.prisma.botModule.findMany({ where: { isEnabled: 1 } }),
      this.prisma.broadcast.count(),
      this.prisma.broadcast.count({ where: { status: { in: ['running', 'queued'] } } }),
    ]);

    const statusCounts = new Map<string, number>();
    for (const bot of bots) {
      const status = this.pool.getStatus(bot.id, bot.isActive === 1);
      statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    }
    metrics.push({
      name: 'tg_studio_bots',
      help: 'Registered bots grouped by runtime status.',
      type: 'gauge',
      samples: [...statusCounts.entries()].map(([status, count]) => ({
        labels: `{status="${status}"}`,
        value: count,
      })),
    });

    metrics.push({
      name: 'tg_studio_bot_daily_volume',
      help: 'Messages seen by the engine for the current UTC day, per bot.',
      type: 'gauge',
      samples: bots.map((bot) => ({
        labels: `{bot_id="${bot.id}",bot="${this.escapeLabel(bot.username ?? bot.name)}"}`,
        value: this.pool.getDailyVolume(bot.id),
      })),
    });

    metrics.push({
      name: 'tg_studio_enabled_modules',
      help: 'Enabled module configurations, per module key.',
      type: 'gauge',
      samples: (() => {
        const byKey = new Map<string, number>();
        for (const row of moduleRows) byKey.set(row.moduleKey, (byKey.get(row.moduleKey) ?? 0) + 1);
        return [...byKey.entries()].map(([moduleKey, count]) => ({
          labels: `{module="${moduleKey}"}`,
          value: count,
        }));
      })(),
    });

    metrics.push({
      name: 'tg_studio_bot_users_total',
      help: 'Known bot users across every bot.',
      type: 'gauge',
      samples: [{ labels: '', value: userCount }],
    });

    metrics.push({
      // Gauge, not counter: the value is a deletable row count, so it can go
      // down (a counter must be monotonically non-decreasing).
      name: 'tg_studio_broadcasts',
      help: 'Broadcast rows currently stored (all statuses).',
      type: 'gauge',
      samples: [{ labels: '', value: broadcastRows }],
    });

    metrics.push({
      name: 'tg_studio_broadcasts_in_flight',
      help: 'Broadcasts currently running or queued.',
      type: 'gauge',
      samples: [{ labels: '', value: runningBroadcasts }],
    });

    metrics.push({
      name: 'tg_studio_database_size_bytes',
      help: 'SQLite database file size on disk.',
      type: 'gauge',
      samples: [{ labels: '', value: this.databaseSizeBytes() }],
    });

    metrics.push(...this.httpMetrics());

    return this.serialize(metrics);
  }

  /**
   * Renders the HTTP latency histogram collected by the global interceptor.
   * @returns {MetricLines[]} Count/sum/bucket series per route.
   */
  private httpMetrics(): MetricLines[] {
    const stats = httpMetricsStore.snapshot();
    if (stats.length === 0) return [];

    const lines: MetricLines[] = [
      {
        name: 'tg_studio_http_requests_total',
        help: 'HTTP requests handled, per method+route (counter semantics reset on process restart).',
        type: 'counter',
        samples: stats.map((s) => ({
          labels: `{method="${s.method}",route="${this.escapeLabel(s.route)}"}`,
          value: s.count,
        })),
      },
      {
        name: 'tg_studio_http_request_errors_total',
        help: 'HTTP requests answered with status >= 400, per method+route.',
        type: 'counter',
        samples: stats.map((s) => ({
          labels: `{method="${s.method}",route="${this.escapeLabel(s.route)}"}`,
          value: s.errors,
        })),
      },
      {
        name: 'tg_studio_http_request_duration_seconds_sum',
        help: 'Cumulative handler duration per method+route.',
        type: 'counter',
        samples: stats.map((s) => ({
          labels: `{method="${s.method}",route="${this.escapeLabel(s.route)}"}`,
          value: Number((s.sumMs / 1000).toFixed(4)),
        })),
      },
    ];

    lines.push({
      name: 'tg_studio_http_request_duration_seconds',
      help: `Handler latency histogram buckets in seconds (bounds: ${HTTP_BUCKETS_MS.join(', ')} ms, +Inf).`,
      type: 'counter',
      samples: stats.flatMap((s) => {
        let cumulative = 0;
        return s.buckets.map((count, bucketIndex) => {
          cumulative += count;
          return {
            labels: `{method="${s.method}",route="${this.escapeLabel(s.route)}",le="${
              bucketIndex < HTTP_BUCKETS_MS.length ? HTTP_BUCKETS_MS[bucketIndex] / 1000 : '+Inf'
            }"}`,
            value: cumulative,
          };
        });
      }),
    });
    return lines;
  }

  /**
   * Reads the SQLite database file size (0 when the path is unavailable).
   * @returns {number} Size in bytes.
   */
  private databaseSizeBytes(): number {
    try {
      const dbPath = process.env.DB_PATH || './data/studio.sqlite';
      return fs.statSync(dbPath).size;
    } catch {
      return 0;
    }
  }

  /**
   * Serializes metric definitions into the Prometheus text exposition format.
   * @param {MetricLines[]} metrics - Collected metric line groups.
   * @returns {string} Payload in `text/plain; version=0.0.4` wire format.
   */
  private serialize(metrics: MetricLines[]): string {
    const lines: string[] = [];
    for (const metric of metrics) {
      if (metric.samples.length === 0) continue;
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);
      for (const sample of metric.samples) {
        lines.push(`${metric.name}${sample.labels} ${sample.value}`);
      }
    }
    return `${lines.join('\n')}\n`;
  }

  /**
   * Escapes a label value per the Prometheus text format rules.
   * @param {string} value - Raw label value.
   * @returns {string} Escaped value.
   */
  private escapeLabel(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }
}
