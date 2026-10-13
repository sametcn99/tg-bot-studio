import { Controller, Delete, Get, Param, Post, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import { BackupService } from './backup.service';

/**
 * Controller providing database backup endpoints.
 */
@Controller('backup')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  /**
   * Lists existing database backups.
   */
  @Get()
  list() {
    return this.backupService.listBackups();
  }

  /**
   * Triggers an on-demand database snapshot via VACUUM INTO.
   */
  @Post()
  create() {
    return this.backupService.createBackup();
  }

  /**
   * Downloads a backup file.
   */
  @Get(':filename/download')
  download(
    @Param('filename') filename: string,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile {
    const fullPath = this.backupService.getBackupPath(filename);
    const file = fs.createReadStream(fullPath);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(file);
  }

  /**
   * Deletes an existing backup file.
   */
  @Delete(':filename')
  delete(@Param('filename') filename: string) {
    return this.backupService.deleteBackup(filename);
  }
}
