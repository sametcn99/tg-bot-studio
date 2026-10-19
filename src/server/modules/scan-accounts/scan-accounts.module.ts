import { Module } from '@nestjs/common';
import { ScanAccountsController } from './scan-accounts.controller';
import { ScanAccountsService } from './scan-accounts.service';
import { MtprotoAuthService } from './mtproto-auth.service';

/**
 * Scan accounts feature module: MTProto (GramJS) user accounts connected for
 * the file-search backfill. The `ScanAccountModel` domain model is provided
 * globally by the database module.
 */
@Module({
  controllers: [ScanAccountsController],
  providers: [ScanAccountsService, MtprotoAuthService],
  exports: [MtprotoAuthService],
})
export class ScanAccountsModule {}
