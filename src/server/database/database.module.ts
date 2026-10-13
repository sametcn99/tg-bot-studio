import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SystemSettingsService } from './system-settings.service';
import {
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
} from '../models';

import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';

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
];

/**
 * Global database module exposing the Prisma service, the key-value settings
 * service, backups, and all typed domain models to every module in the application.
 */
@Global()
@Module({
  controllers: [BackupController],
  providers: [PrismaService, SystemSettingsService, BackupService, ...MODELS],
  exports: [PrismaService, SystemSettingsService, BackupService, ...MODELS],
})
export class DatabaseModule {}
