import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { HealthController } from './health.controller';
import { BotsModule } from './bots/bots.module';
import { BotEngineModule } from './bot-engine/bot-engine.module';
import { StartMenuModule } from './modules/start-menu/start-menu.module';
import { ConnectionsModule } from './modules/connections/connections.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { SupportModule } from './modules/support/support.module';
import { BusinessModule } from './modules/business/business.module';
import { DripModule } from './modules/drip/drip.module';
import { WelcomeModule } from './modules/welcome/welcome.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { GiveawaysModule } from './modules/giveaways/giveaways.module';
import { EngagementModule } from './modules/engagement/engagement.module';
import { MessageScoreModule } from './modules/message-score/message-score.module';
import { BroadcastModule } from './modules/broadcast/broadcast.module';
import { AutoresponderModule } from './modules/autoresponder/autoresponder.module';
import { AiAssistantModule } from './modules/ai-assistant/ai-assistant.module';
import { MonetizationModule } from './modules/monetization/monetization.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { UsersCrmModule } from './modules/users-crm/users-crm.module';
import { MiniAppsModule } from './modules/mini-apps/mini-apps.module';

/**
 * Root application module composing the unified single-port deployment:
 * the NestJS REST API under `/api/*`, the compiled Mini App shell under
 * `/tma/*`, and the React 19 dashboard on all remaining routes.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,

    // Static serving is registered only when compiled client artifacts
    // exist, keeping `bun run dev` usable before the first frontend build.
    ...(existsSync(join(__dirname, '..', 'client'))
      ? [
          ServeStaticModule.forRoot(
            {
              rootPath: join(__dirname, '..', 'client'),
              exclude: ['/api/*splat', '/tma/*splat'],
            },
            {
              rootPath: join(__dirname, '..', 'client-tma'),
              serveRoot: '/tma',
            },
          ),
        ]
      : []),

    BotsModule,
    BotEngineModule,
    ConnectionsModule,
    StartMenuModule,
    SchedulerModule,
    SupportModule,
    BusinessModule,
    DripModule,
    WelcomeModule,
    ModerationModule,
    GiveawaysModule,
    EngagementModule,
    MessageScoreModule,
    BroadcastModule,
    AutoresponderModule,
    AiAssistantModule,
    MonetizationModule,
    WebhooksModule,
    UsersCrmModule,
    MiniAppsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
