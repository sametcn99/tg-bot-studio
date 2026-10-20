import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { argon2id, argon2Verify } from 'hash-wasm';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { SessionModel } from './session.model';
import type { SecurityLogEntity, SessionEntity } from './session.entity';
import { parseUserAgent } from '../common/utils/user-agent.util';
import {
  DEFAULT_MASTER_KEY,
  isDefaultJwtSecretEnv,
  isDefaultMasterKeyEnv,
  resolveMasterKey,
} from './auth-defaults';

/**
 * Session row persisted in the `sessions` table.
 */
export type SessionRow = SessionEntity;

/**
 * Security audit log row persisted in the `security_logs` table.
 */
export type SecurityLogRow = SecurityLogEntity;

/** Argon2id parameters used for master key hashing (OWASP baseline). */
const ARGON2_PARAMS = {
  parallelism: 1,
  iterations: 3,
  memorySize: 19456,
  hashLength: 32,
  outputType: 'encoded',
} as const;

/**
 * Authentication and session management service.
 *
 * On first boot the `ADMIN_MASTER_KEY` environment value (fallback
 * `admin123`) is hashed with Argon2id and stored in `system_settings`.
 * Login exchanges the master key for a revocable JWT session.
 */
@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly failedAttempts = new Map<string, { count: number; lockedUntil: number }>();
  private readonly lastActiveWrites = new Map<string, number>();

  /**
   * @param {PrismaService} prisma - Prisma ORM access service.
   * @param {SessionModel} sessionModel - Domain model for session and security logs.
   * @param {JwtService} jwtService - JWT signing service.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionModel: SessionModel,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Seeds the Argon2id master key hash on first boot.
   * @returns {Promise<void>} Resolves once seeding is checked/applied.
   */
  async onModuleInit(): Promise<void> {
    const existing = await this.prisma.systemSetting.findUnique({
      where: { key: 'master_key_hash' },
    });
    if (existing) return;
    const masterKey = resolveMasterKey();
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const hash = await argon2id({ password: masterKey, salt, ...ARGON2_PARAMS });
    await this.prisma.systemSetting.create({
      data: { key: 'master_key_hash', value: hash },
    });
    this.logger.log('Master key seeded and hashed with Argon2id on first boot');
  }

  /**
   * Loads the persisted failed-attempt record for an IP. Counters survive
   * restarts (previously they reset, letting attackers wait out a reboot).
   * @param {string} ip - Client IP address used as the throttle key.
   * @returns {Promise<{count: number; lockedUntil: number} | null>} Persisted entry when fresh.
   */
  private async loadThrottle(ip: string): Promise<{ count: number; lockedUntil: number } | null> {
    const key = `login_throttle:${ip}`;
    const row = await this.prisma.systemSetting.findUnique({ where: { key } }).catch(() => null);
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.value) as { count: number; lockedUntil: number };
      if (parsed.lockedUntil < Date.now() - 60 * 60 * 1000) {
        await this.prisma.systemSetting.delete({ where: { key } }).catch(() => undefined);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Persists the failed-attempt record so lockouts survive restarts.
   * @param {string} ip - Client IP address used as the throttle key.
   * @param {{count: number; lockedUntil: number}} entry - Counter and lockout deadline.
   * @returns {Promise<void>} Resolves once persisted (failures only log).
   */
  private async saveThrottle(
    ip: string,
    entry: { count: number; lockedUntil: number },
  ): Promise<void> {
    await this.prisma.systemSetting
      .upsert({
        where: { key: `login_throttle:${ip}` },
        create: { key: `login_throttle:${ip}`, value: JSON.stringify(entry) },
        update: { value: JSON.stringify(entry) },
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to persist login throttle state: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  /**
   * Clears both the in-memory and persisted throttle state for an IP.
   * @param {string} ip - Client IP address used as the throttle key.
   * @returns {Promise<void>} Resolves once cleanup is attempted.
   */
  private async clearThrottle(ip: string): Promise<void> {
    this.failedAttempts.delete(ip);
    await this.prisma.systemSetting
      .delete({ where: { key: `login_throttle:${ip}` } })
      .catch(() => undefined);
  }

  /**
   * Authenticates the master key and issues a JWT bound to a new session row.
   * Rate limited: 3 failed attempts incur 30s delay; 5 failed attempts lock out for 5 minutes.
   * @param {string} masterKey - Submitted master key.
   * @param {string} ip - Client IP address.
   * @param {string} userAgent - Raw User-Agent header value.
   * @returns {Promise<{token: string; session: SessionRow}>} Signed JWT and session record.
   * @throws {HttpException} When the IP is temporarily throttled.
   * @throws {UnauthorizedException} When the master key does not verify.
   */
  async login(
    masterKey: string,
    ip: string,
    userAgent: string,
  ): Promise<{ token: string; session: SessionRow }> {
    const attempt = this.failedAttempts.get(ip) ?? (await this.loadThrottle(ip));
    if (attempt) this.failedAttempts.set(ip, attempt);
    const now = Date.now();
    if (attempt && attempt.lockedUntil > now) {
      const remainingSeconds = Math.ceil((attempt.lockedUntil - now) / 1000);
      await this.logSecurityEvent(
        'login_throttled',
        ip,
        userAgent,
        `IP throttled for ${remainingSeconds}s`,
      );
      throw new HttpException(
        `Too many failed attempts. Please try again in ${remainingSeconds} seconds.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const stored = await this.prisma.systemSetting.findUnique({
      where: { key: 'master_key_hash' },
    });
    const ok = stored
      ? await argon2Verify({ password: masterKey, hash: stored.value })
      : masterKey === resolveMasterKey();
    if (!ok) {
      const currentCount = (attempt?.count ?? 0) + 1;
      let lockedUntil = 0;
      if (currentCount >= 5) {
        lockedUntil = now + 5 * 60 * 1000; // 5 min lockout
      } else if (currentCount >= 3) {
        lockedUntil = now + 30 * 1000; // 30s delay
      }
      const entry = { count: currentCount, lockedUntil };
      this.failedAttempts.set(ip, entry);
      await this.saveThrottle(ip, entry);
      await this.logSecurityEvent(
        'login_failed',
        ip,
        userAgent,
        `Invalid master key (attempt ${currentCount})`,
      );
      throw new UnauthorizedException('Invalid master key');
    }

    // Reset failed counter on successful authentication
    await this.clearThrottle(ip);

    const { browser, os, deviceType } = parseUserAgent(userAgent);
    const sessionId = randomUUID();
    const session = await this.sessionModel.createSession({
      id: sessionId,
      ip,
      userAgent,
      browser,
      os,
      deviceType,
    });

    await this.logSecurityEvent('login_success', ip, userAgent, `Session ${sessionId}`);
    const token = this.jwtService.sign({ sessionId });
    return { token, session };
  }

  /**
   * Loads a session row by identifier.
   * @param {string} sessionId - Session identifier.
   * @returns {Promise<SessionRow | null>} The row when found.
   */
  async getSession(sessionId: string): Promise<SessionRow | null> {
    return this.sessionModel.findSession(sessionId);
  }

  /**
   * Checks session validity and refreshes `last_active_at` on success.
   * @param {string} sessionId - Session identifier from the JWT.
   * @returns {Promise<boolean>} True when the session exists and is active.
   */
  async isSessionValid(sessionId: string): Promise<boolean> {
    const session = await this.getSession(sessionId);
    if (!session || session.is_revoked) return false;
    const now = Date.now();
    const lastWrite = this.lastActiveWrites.get(sessionId) ?? 0;
    if (now - lastWrite > 120_000) {
      this.lastActiveWrites.set(sessionId, now);
      void this.sessionModel
        .updateLastActive(sessionId, new Date(now).toISOString())
        .catch(() => undefined);
    }
    return true;
  }

  /**
   * Revokes a single session (logout).
   * @param {string} sessionId - Session identifier to revoke.
   * @returns {Promise<void>}
   */
  async logout(sessionId: string): Promise<void> {
    this.lastActiveWrites.delete(sessionId);
    await this.sessionModel.revokeSession(sessionId);
  }

  /**
   * Revokes every session except the currently authenticated one.
   * @param {string} currentSessionId - Session to keep alive.
   * @returns {Promise<void>}
   */
  async revokeOtherSessions(currentSessionId: string): Promise<void> {
    await this.sessionModel.revokeOtherSessions(currentSessionId);
  }

  /**
   * Lists all sessions, newest first.
   * @returns {Promise<SessionRow[]>} All session rows.
   */
  async listSessions(): Promise<SessionRow[]> {
    return this.sessionModel.listSessions();
  }

  /**
   * Rotates the master key after verifying the current one.
   * @param {string} currentKey - Current master key for verification.
   * @param {string} newKey - Replacement master key.
   * @param {string} ip - Client IP address for the audit log.
   * @returns {Promise<void>} Resolves after the new hash is persisted.
   * @throws {UnauthorizedException} When the current key does not verify.
   */
  async changeMasterKey(currentKey: string, newKey: string, ip: string): Promise<void> {
    const stored = await this.prisma.systemSetting.findUnique({
      where: { key: 'master_key_hash' },
    });
    const ok = stored
      ? await argon2Verify({ password: currentKey, hash: stored.value })
      : currentKey === resolveMasterKey();
    if (!ok) {
      await this.logSecurityEvent('master_key_change_failed', ip, null, 'Invalid current key');
      throw new UnauthorizedException('Current master key is incorrect');
    }
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const hash = await argon2id({ password: newKey, salt, ...ARGON2_PARAMS });
    await this.prisma.systemSetting.upsert({
      where: { key: 'master_key_hash' },
      create: { key: 'master_key_hash', value: hash },
      update: { value: hash },
    });
    await this.logSecurityEvent('master_key_changed', ip, null, 'Master key rotated');
  }

  /**
   * Lists the most recent security audit log entries.
   * @param {number} [limit=100] - Maximum number of entries.
   * @returns {Promise<SecurityLogRow[]>} Newest entries first.
   */
  async listSecurityLogs(limit = 100): Promise<SecurityLogRow[]> {
    return this.sessionModel.listSecurityLogs(limit);
  }

  /**
   * Records a security audit event.
   * @param {string} event - Stable event name.
   * @param {string} ip - Client IP address.
   * @param {string | null} userAgent - Raw User-Agent header.
   * @param {string} [details] - Optional human-readable context.
   * @returns {Promise<void>} Resolves once the row is inserted.
   */
  async logSecurityEvent(
    event: string,
    ip: string,
    userAgent: string | null,
    details?: string,
  ): Promise<void> {
    await this.sessionModel.createSecurityLog({
      event,
      ip,
      userAgent,
      details,
    });
  }

  /**
   * Evaluates deployment security posture and returns warning flags for default credentials.
   */
  async getSecurityStatus(): Promise<{
    isDefaultMasterKey: boolean;
    isDefaultJwtSecret: boolean;
  }> {
    const isDefaultJwtSecret = isDefaultJwtSecretEnv();
    const stored = await this.prisma.systemSetting.findUnique({
      where: { key: 'master_key_hash' },
    });
    let isDefaultMasterKey: boolean;
    if (stored) {
      try {
        isDefaultMasterKey = await argon2Verify({
          password: DEFAULT_MASTER_KEY,
          hash: stored.value,
        });
      } catch {
        isDefaultMasterKey = false;
      }
    } else {
      isDefaultMasterKey = isDefaultMasterKeyEnv();
    }
    return {
      isDefaultMasterKey,
      isDefaultJwtSecret,
    };
  }
}
