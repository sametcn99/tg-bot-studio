import { Injectable } from '@nestjs/common';
import type { SecurityLog, Session } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { SecurityLogEntity, SessionEntity } from './session.entity';

/**
 * Model managing Session and SecurityLog entities via Prisma.
 */
@Injectable()
export class SessionModel {
  constructor(private readonly prisma: PrismaService) {}

  private toSessionEntity(r: Session): SessionEntity {
    return {
      id: r.id,
      ip: r.ip,
      user_agent: r.userAgent,
      browser: r.browser,
      os: r.os,
      device_type: r.deviceType,
      created_at: r.createdAt ?? '',
      last_active_at: r.lastActiveAt ?? '',
      is_revoked: r.isRevoked,
    };
  }

  private toSecurityLogEntity(r: SecurityLog): SecurityLogEntity {
    return {
      id: r.id,
      event: r.event,
      ip: r.ip,
      user_agent: r.userAgent,
      details: r.details,
      created_at: r.createdAt ?? '',
    };
  }

  /**
   * Creates a session.
   */
  async createSession(data: {
    id: string;
    ip: string;
    userAgent: string;
    browser: string;
    os: string;
    deviceType: string;
  }): Promise<SessionEntity> {
    const now = new Date().toISOString();
    const created = await this.prisma.session.create({
      data: {
        id: data.id,
        ip: data.ip,
        userAgent: data.userAgent,
        browser: data.browser,
        os: data.os,
        deviceType: data.deviceType,
        createdAt: now,
        lastActiveAt: now,
        isRevoked: 0,
      },
    });
    return this.toSessionEntity(created);
  }

  /**
   * Finds a session by id.
   */
  async findSession(id: string): Promise<SessionEntity | null> {
    const row = await this.prisma.session.findUnique({
      where: { id },
    });
    return row ? this.toSessionEntity(row) : null;
  }

  /**
   * Refreshes lastActiveAt for an active session.
   */
  async updateLastActive(id: string, timestamp: string): Promise<void> {
    await this.prisma.session.update({
      where: { id },
      data: { lastActiveAt: timestamp },
    });
  }

  /**
   * Revokes a session (logout).
   */
  async revokeSession(id: string): Promise<void> {
    await this.prisma.session.update({
      where: { id },
      data: { isRevoked: 1 },
    });
  }

  /**
   * Revokes all sessions except the current one.
   */
  async revokeOtherSessions(currentId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: {
        id: { not: currentId },
        isRevoked: 0,
      },
      data: { isRevoked: 1 },
    });
  }

  /**
   * Lists all sessions newest first.
   */
  async listSessions(): Promise<SessionEntity[]> {
    const rows = await this.prisma.session.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toSessionEntity(r));
  }

  /**
   * Records a security event.
   */
  async createSecurityLog(data: {
    event: string;
    ip: string;
    userAgent: string | null;
    details?: string | null;
  }): Promise<void> {
    await this.prisma.securityLog.create({
      data: {
        event: data.event,
        ip: data.ip,
        userAgent: data.userAgent,
        details: data.details ?? null,
        createdAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Lists security audit logs.
   */
  async listSecurityLogs(limit = 100): Promise<SecurityLogEntity[]> {
    const rows = await this.prisma.securityLog.findMany({
      orderBy: { id: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.toSecurityLogEntity(r));
  }
}
