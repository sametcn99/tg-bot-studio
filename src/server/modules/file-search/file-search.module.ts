import { Module } from '@nestjs/common';
import { FileSearchController } from './file-search.controller';
import { FileSearchService } from './file-search.service';
import { FileSearchRuntime } from './file-search.runtime';
import { BackfillController } from './backfill/backfill.controller';
import { BackfillService } from './backfill/backfill.service';
import { ScanAccountsModule } from '../scan-accounts/scan-accounts.module';

/**
 * Group file search feature module: live indexing + question answering, the
 * dashboard index endpoints, and the MTProto backfill runner. Domain models
 * are provided globally by the database module.
 */
@Module({
  imports: [ScanAccountsModule],
  controllers: [FileSearchController, BackfillController],
  providers: [FileSearchService, FileSearchRuntime, BackfillService],
  exports: [FileSearchService],
})
export class FileSearchModule {}
