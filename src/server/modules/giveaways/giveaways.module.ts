import { Module } from '@nestjs/common';
import { GiveawaysController } from './giveaways.controller';
import { GiveawaysService } from './giveaways.service';
import { GiveawaysRuntime } from './giveaways.runtime';

/**
 * Giveaways & Contest Engine feature module.
 */
@Module({
  controllers: [GiveawaysController],
  providers: [GiveawaysService, GiveawaysRuntime],
  exports: [GiveawaysService],
})
export class GiveawaysModule {}
