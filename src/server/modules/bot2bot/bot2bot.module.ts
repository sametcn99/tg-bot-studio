import { Module } from '@nestjs/common';
import { Bot2BotRuntime } from './bot2bot.runtime';

/**
 * Bot-to-bot commands feature module (off/admin/all gate + review queue).
 */
@Module({
  providers: [Bot2BotRuntime],
})
export class Bot2BotModule {}
