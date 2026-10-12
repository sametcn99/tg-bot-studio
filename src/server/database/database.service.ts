import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS } from './migrations';

/**
 * Result shape returned by SQLite mutation statements.
 * @interface RunResult
 * @property {number} changes - Number of rows affected by the statement.
 * @property {number | bigint} lastInsertRowid - Rowid of the last inserted row.
 */
interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/**
 * Central SQLite access service backed by `bun:sqlite`.
 *
 * Opens the database file configured via the `DB_PATH` environment variable
 * (default `./data/studio.sqlite`), enables WAL journalling and foreign key
 * enforcement, and applies all idempotent schema migrations on boot.
 *
 * @example
 * const users = db.query<BotUser>('SELECT * FROM bot_users WHERE bot_id = ?', botId);
 */
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly db: Database;

  constructor() {
    const dbPath = process.env.DB_PATH || './data/studio.sqlite';
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.runMigrations();
  }

  /**
   * Applies every idempotent schema migration statement.
   * @returns {void}
   */
  private runMigrations(): void {
    for (const statement of MIGRATIONS) {
      this.db.exec(statement);
    }
    this.logger.log(`Schema initialized (${MIGRATIONS.length} migrations applied)`);
  }

  /**
   * Executes a SELECT statement and returns all matching rows.
   * @template T - Row shape mapped onto the result set.
   * @param {string} sql - SQL statement with `?` placeholders.
   * @param {...SQLQueryBindings[]} params - Bound positional parameters.
   * @returns {T[]} Array of typed rows; empty array when nothing matches.
   */
  query<T>(sql: string, ...params: SQLQueryBindings[]): T[] {
    return this.db.query(sql).all(...params) as T[];
  }

  /**
   * Executes a SELECT statement and returns the first matching row.
   * @template T - Row shape mapped onto the result set.
   * @param {string} sql - SQL statement with `?` placeholders.
   * @param {...SQLQueryBindings[]} params - Bound positional parameters.
   * @returns {T | undefined} The first row, or undefined when none match.
   */
  get<T>(sql: string, ...params: SQLQueryBindings[]): T | undefined {
    return this.db.query(sql).get(...params) as T | undefined;
  }

  /**
   * Executes an INSERT / UPDATE / DELETE statement.
   * @param {string} sql - SQL statement with `?` placeholders.
   * @param {...SQLQueryBindings[]} params - Bound positional parameters.
   * @returns {RunResult} Affected row count and last inserted rowid.
   */
  run(sql: string, ...params: SQLQueryBindings[]): RunResult {
    return this.db.query(sql).run(...params) as unknown as RunResult;
  }

  /**
   * Runs a callback inside a single SQLite transaction. Rolls back and
   * rethrows when the callback throws.
   * @template T - Return type of the callback.
   * @param {() => T} fn - Unit of work to execute transactionally.
   * @returns {T} Whatever the callback returns.
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Closes the underlying SQLite handle during application shutdown.
   * @returns {void}
   */
  onApplicationShutdown(): void {
    this.db.close();
    this.logger.log('SQLite connection closed');
  }
}
