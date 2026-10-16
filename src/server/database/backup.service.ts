import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

export interface BackupInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

/**
 * Service managing SQLite atomic backups via VACUUM INTO.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly backupDir = path.resolve(process.cwd(), 'data', 'backups');

  constructor(private readonly prisma: PrismaService) {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * Writes a restore manifest next to a backup: schema version (latest applied
   * migration), a fingerprint of the JWT secret, and row counts. Restore
   * documentation uses the fingerprint to detect the "restored onto a host
   * with a different JWT_SECRET → all sessions invalid" footgun.
   * @param {string} filename - Backup filename the manifest describes.
   * @returns {Promise<void>} Resolves once the manifest is written.
   */
  async writeManifest(filename: string): Promise<void> {
    try {
      const migrations = await this.prisma.$queryRaw<Array<{ migration_name: string }>>(
        Prisma.sql`SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1`,
      );
      const counts = await Promise.all([
        this.prisma.bot.count(),
        this.prisma.botUser.count(),
        this.prisma.broadcast.count(),
      ]);
      const jwtSecret = process.env.JWT_SECRET || '';
      const manifest = {
        filename,
        createdAt: new Date().toISOString(),
        schemaVersion: migrations[0]?.migration_name ?? 'unknown',
        jwtSecretFingerprint: jwtSecret
          ? createHash('sha256').update(jwtSecret).digest('hex').slice(0, 12)
          : null,
        counts: {
          bots: counts[0],
          botUsers: counts[1],
          broadcasts: counts[2],
        },
      };
      fs.writeFileSync(
        path.join(this.backupDir, `${filename}.manifest.json`),
        JSON.stringify(manifest, null, 2),
      );
    } catch (error) {
      this.logger.warn(
        `Backup manifest write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Triggers an atomic VACUUM INTO backup of the SQLite database.
   */
  async createBackup(): Promise<BackupInfo> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `studio_backup_${timestamp}.db`;
    const fullPath = path.join(this.backupDir, filename);
    const escapedSqlPath = fullPath.replace(/\\/g, '/');

    this.logger.log(`Creating database backup at ${fullPath}...`);
    await this.prisma.$executeRawUnsafe(`VACUUM INTO '${escapedSqlPath}'`);

    const stats = fs.statSync(fullPath);
    this.logger.log(`Backup completed successfully: ${filename} (${stats.size} bytes)`);

    // Prune old backups, keep last 10, and record the restore manifest.
    this.pruneOldBackups(10);
    await this.writeManifest(filename);

    return {
      filename,
      sizeBytes: stats.size,
      createdAt: stats.birthtime.toISOString(),
    };
  }

  /**
   * Lists all existing backups sorted newest first.
   */
  listBackups(): BackupInfo[] {
    if (!fs.existsSync(this.backupDir)) return [];
    const files = fs.readdirSync(this.backupDir);
    const backups: BackupInfo[] = [];

    for (const file of files) {
      if (!file.endsWith('.db')) continue;
      const fullPath = path.join(this.backupDir, file);
      try {
        const stats = fs.statSync(fullPath);
        backups.push({
          filename: file,
          sizeBytes: stats.size,
          createdAt: stats.birthtime.toISOString(),
        });
      } catch {}
    }

    return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Resolves the safe absolute path for downloading a backup.
   */
  getBackupPath(filename: string): string {
    const safeName = path.basename(filename);
    const fullPath = path.join(this.backupDir, safeName);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException(`Backup file ${safeName} not found`);
    }
    return fullPath;
  }

  /**
   * Deletes a backup file.
   */
  deleteBackup(filename: string): { deleted: true } {
    const fullPath = this.getBackupPath(filename);
    fs.unlinkSync(fullPath);
    this.logger.log(`Deleted backup: ${filename}`);
    return { deleted: true };
  }

  /**
   * Keeps at most `keepCount` newest backups.
   */
  private pruneOldBackups(keepCount: number): void {
    const backups = this.listBackups();
    if (backups.length <= keepCount) return;

    const toDelete = backups.slice(keepCount);
    for (const b of toDelete) {
      try {
        fs.unlinkSync(path.join(this.backupDir, b.filename));
        this.logger.log(`Pruned old backup: ${b.filename}`);
      } catch {}
    }
  }
}
