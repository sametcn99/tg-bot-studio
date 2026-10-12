import {
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { argon2id, argon2Verify } from 'hash-wasm';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { parseUserAgent } from '../common/utils/user-agent.util';

/**
 * Session row persisted in the `sessions` table.
 * @interface SessionRow
 * @property {string} id - Session identifier (JWT `sessionId` claim).
 * @property {string} ip - Client IP address at login time.
 * @property {string} browser - Parsed browser name.
 * @property {string} os - Parsed operating system.
 * @property {string} device_type - `desktop` | `mobile` | `tablet`.
 * @property {string} created_at - ISO creation timestamp.
 * @property {string} last_active_at - ISO last-seen timestamp.
 * @property {number} is_revoked - 1 when the session was revoked.
 */
export interface SessionRow {
  id: string;
  ip: string;
  user_agent: string | null;
  browser: string;
  os: string;
  device_type: string;
  created_at: string;
  last_active_at: string;
  is_revoked: number;
}

/**
 * Security audit log row persisted in the `security_logs` table.
 * @interface SecurityLogRow
 * @property {number} id - Auto-incremented identifier.
 * @property {string} event - Stable event name (e.g. `login_success`).
 * @property {string} created_at - ISO creation timestamp.
 */
export interface SecurityLogRow {
  id: number;
  event: string;
  ip: string | null;
  user_agent: string | null;
  details: string | null;
  created_at: string;
}

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

  /**
   * @param {DatabaseService} db - SQLite access service.
   * @param {JwtService} jwtService - JWT signing service.
   */
  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Seeds the Argon2id master key hash on first boot.
   * @returns {Promise<void>} Resolves once seeding is checked/applied.
   */
  async onModuleInit(): Promise<void> {
    const existing = this.db.get<{ value: string }>(
      "SELECT value FROM system_settings WHERE key = 'master_key_hash'",
    );
    if (existing) return;
    const masterKey = process.env.ADMIN_MASTER_KEY || 'admin123';
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const hash = await argon2id({ password: masterKey, salt, ...ARGON2_PARAMS });
    this.db.run(
      "INSERT INTO system_settings (key, value) VALUES ('master_key_hash', ?)",
      hash,
    );
    this.logger.log('Master key seeded and hashed with Argon2id on first boot');
  }

  /**
   * Authenticates the master key and issues a JWT bound to a new session row.
   * @param {string} masterKey - Submitted master key.
   * @param {string} ip - Client IP address.
   * @param {string} userAgent - Raw User-Agent header value.
   * @returns {Promise<{token: string; session: SessionRow}>} Signed JWT and session record.
   * @throws {UnauthorizedException} When the master key does not verify.
   */
  async login(
    masterKey: string,
    ip: string,
    userAgent: string,
  ): Promise<{ token: string; session: SessionRow }> {
    const stored = this.db.get<{ value: string }>(
      "SELECT value FROM system_settings WHERE key = 'master_key_hash'",
    );
    const ok = stored
      ? await argon2Verify({ password: masterKey, hash: stored.value })
      : masterKey === (process.env.ADMIN_MASTER_KEY || 'admin123');
    if (!ok) {
      await this.logSecurityEvent('login_failed', ip, userAgent, 'Invalid master key');
      throw new UnauthorizedException('Invalid master key');
    }

    const { browser, os, deviceType } = parseUserAgent(userAgent);
    const sessionId = randomUUID();
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO sessions (id, ip, user_agent, browser, os, device_type, created_at, last_active_at, is_revoked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      sessionId,
      ip,
      userAgent,
      browser,
      os,
      deviceType,
      now,
      now,
    );
    const session = this.getSession(sessionId)!;
    await this.logSecurityEvent('login_success', ip, userAgent, `Session ${sessionId}`);
    const token = this.jwtService.sign({ sessionId });
    return { token, session };
  }

  /**
   * Loads a session row by identifier.
   * @param {string} sessionId - Session identifier.
   * @returns {SessionRow | undefined} The row when found.
   */
  getSession(sessionId: string): SessionRow | undefined {
    return this.db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', sessionId);
  }

  /**
   * Checks session validity and refreshes `last_active_at` on success.
   * @param {string} sessionId - Session identifier from the JWT.
   * @returns {Promise<boolean>} True when the session exists and is active.
   */
  async isSessionValid(sessionId: string): Promise<boolean> {
    const session = this.getSession(sessionId);
    if (!session || session.is_revoked) return false;
    this.db.run('UPDATE sessions SET last_active_at = ? WHERE id = ?', new Date().toISOString(), sessionId);
    return true;
  }

  /**
   * Revokes a single session (logout).
   * @param {string} sessionId - Session identifier to revoke.
   * @returns {void}
   */
  logout(sessionId: string): void {
    this.db.run('UPDATE sessions SET is_revoked = 1 WHERE id = ?', sessionId);
  }

  /**
   * Revokes every session except the currently authenticated one.
   * @param {string} currentSessionId - Session to keep alive.
   * @returns {void}
   */
  revokeOtherSessions(currentSessionId: string): void {
    this.db.run(
      'UPDATE sessions SET is_revoked = 1 WHERE id != ? AND is_revoked = 0',
      currentSessionId,
    );
  }

  /**
   * Lists all sessions, newest first.
   * @returns {SessionRow[]} All session rows.
   */
  listSessions(): SessionRow[] {
    return this.db.query<SessionRow>(
      'SELECT * FROM sessions ORDER BY created_at DESC',
    );
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
    const stored = this.db.get<{ value: string }>(
      "SELECT value FROM system_settings WHERE key = 'master_key_hash'",
    );
    const ok = stored
      ? await argon2Verify({ password: currentKey, hash: stored.value })
      : currentKey === (process.env.ADMIN_MASTER_KEY || 'admin123');
    if (!ok) {
      await this.logSecurityEvent('master_key_change_failed', ip, null, 'Invalid current key');
      throw new UnauthorizedException('Current master key is incorrect');
    }
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const hash = await argon2id({ password: newKey, salt, ...ARGON2_PARAMS });
    this.db.run(
      "INSERT INTO system_settings (key, value) VALUES ('master_key_hash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      hash,
    );
    await this.logSecurityEvent('master_key_changed', ip, null, 'Master key rotated');
  }

  /**
   * Lists the most recent security audit log entries.
   * @param {number} [limit=100] - Maximum number of entries.
   * @returns {SecurityLogRow[]} Newest entries first.
   */
  listSecurityLogs(limit = 100): SecurityLogRow[] {
    return this.db.query<SecurityLogRow>(
      'SELECT * FROM security_logs ORDER BY id DESC LIMIT ?',
      limit,
    );
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
    this.db.run(
      'INSERT INTO security_logs (event, ip, user_agent, details, created_at) VALUES (?, ?, ?, ?, ?)',
      event,
      ip,
      userAgent,
      details ?? null,
      new Date().toISOString(),
    );
  }
}
