import { Module } from '@nestjs/common';
import { DripController } from './drip.controller';
import { DripService } from './drip.service';

/**
 * Drip Marketing Sequences feature module.
 */
@Module({
  controllers: [DripController],
  providers: [DripService],
  exports: [DripService],
})
export class DripModule {}
