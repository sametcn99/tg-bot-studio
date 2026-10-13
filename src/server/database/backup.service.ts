import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
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

    // Prune old backups, keep last 10
    this.pruneOldBackups(10);

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
