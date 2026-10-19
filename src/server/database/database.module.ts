import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SystemSettingsService } from './system-settings.service';
import { BotModel } from '../bots/bot.model';
import { BotUserModel } from '../modules/users-crm/bot-user.model';
import { MiniAppModel } from '../modules/mini-apps/mini-app.model';
import { ChatConnectionModel } from '../modules/connections/chat-connection.model';
import { SupportModel } from '../modules/support/support.model';
import { MessageScoreModel } from '../modules/message-score/message-score.model';
import { BroadcastModel } from '../modules/broadcast/broadcast.model';
import { DripModel } from '../modules/drip/drip.model';
import { GiveawayModel } from '../modules/giveaways/giveaway.model';
import { AutoresponderModel } from '../modules/autoresponder/autoresponder.model';
import { SchedulerModel } from '../modules/scheduler/scheduler.model';
import { StartMenuModel } from '../modules/start-menu/start-menu.model';
import { MonetizationModel } from '../modules/monetization/monetization.model';
import { AiModel } from '../modules/ai-assistant/ai.model';
import { SessionModel } from '../auth/session.model';
import { MediaAssetModel } from '../modules/media-library/media-asset.model';
import { GroupFileIndexModel } from '../modules/file-search/group-file-index.model';
import { ScanAccountModel } from '../modules/scan-accounts/scan-account.model';
import { FlowModel } from '../modules/flows/flow.model';
import { HealthModel } from '../modules/health-monitor/health.model';
import { BotTemplateModel } from '../templates/bot-template.model';

import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';
import { RetentionService } from './retention.service';
import { AuditService } from './audit.service';
import { LiveEventsService } from '../common/live/live-events.service';

const MODELS = [
  BotModel,
  BotUserModel,
  MiniAppModel,
  ChatConnectionModel,
  SupportModel,
  MessageScoreModel,
  BroadcastModel,
  DripModel,
  GiveawayModel,
  AutoresponderModel,
  SchedulerModel,
  StartMenuModel,
  MonetizationModel,
  AiModel,
  SessionModel,
  MediaAssetModel,
  GroupFileIndexModel,
  ScanAccountModel,
  FlowModel,
  HealthModel,
  BotTemplateModel,
];

/**
 * Global database module exposing the Prisma service, the key-value settings
 * service, backups, and all typed domain models to every module in the application.
 */
@Global()
@Module({
  controllers: [BackupController],
  providers: [
    PrismaService,
    SystemSettingsService,
    BackupService,
    RetentionService,
    AuditService,
    LiveEventsService,
    ...MODELS,
  ],
  exports: [
    PrismaService,
    SystemSettingsService,
    BackupService,
    AuditService,
    LiveEventsService,
    ...MODELS,
  ],
})
export class DatabaseModule {}
