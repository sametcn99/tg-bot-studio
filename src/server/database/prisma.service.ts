import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Enable clean serialization of BigInt to Number in JSON responses.
if (!('toJSON' in BigInt.prototype)) {
  Object.defineProperty(BigInt.prototype, 'toJSON', {
    value: function () {
      const n = Number(this);
      return Number.isSafeInteger(n) ? n : this.toString();
    },
    writable: true,
    configurable: true,
  });
}

/**
 * Central Prisma Client service for NestJS.
 * Connects to SQLite database configured via `DB_PATH` or `DATABASE_URL`,
 * enables WAL mode and foreign keys, and provides clean shutdown handling.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const dbPath = process.env.DB_PATH || './data/studio.sqlite';
    mkdirSync(dirname(dbPath), { recursive: true });
    const databaseUrl = `file:${resolve(process.cwd(), dbPath).replace(/\\/g, '/')}`;

    super({
      adapter: new PrismaLibSql({ url: databaseUrl }),
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  /**
   * Connects to SQLite database on startup and applies performance pragmas.
   */
  async onModuleInit(): Promise<void> {
    await this.$connect();
    try {
      await this.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
      await this.$queryRawUnsafe('PRAGMA busy_timeout = 5000;');
      await this.$queryRawUnsafe('PRAGMA foreign_keys = ON;');
    } catch (err) {
      this.logger.warn(
        `Failed to set SQLite pragmas: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.logger.log('Prisma Client connected to database');
  }

  /**
   * Disconnects Prisma Client on application shutdown.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma Client disconnected');
  }
}
