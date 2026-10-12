import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { SystemSettingsService } from './system-settings.service';

/**
 * Global database module exposing the SQLite access service and the
 * key-value settings service to every feature module.
 */
@Global()
@Module({
  providers: [DatabaseService, SystemSettingsService],
  exports: [DatabaseService, SystemSettingsService],
})
export class DatabaseModule {}
