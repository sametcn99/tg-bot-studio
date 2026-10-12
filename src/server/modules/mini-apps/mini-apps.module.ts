import { Module } from '@nestjs/common';
import { MiniAppsController } from './mini-apps.controller';
import { TmaController } from './tma.controller';
import { MiniAppsService } from './mini-apps.service';
import { WebhooksModule } from '../webhooks/webhooks.module';

/**
 * Telegram Mini App Studio feature module: dashboard CRUD, the public TMA
 * runtime API with initData validation, and menu button publishing.
 */
@Module({
  imports: [WebhooksModule],
  controllers: [MiniAppsController, TmaController],
  providers: [MiniAppsService],
  exports: [MiniAppsService],
})
export class MiniAppsModule {}
