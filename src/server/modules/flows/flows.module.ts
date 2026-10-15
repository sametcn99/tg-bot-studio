import { Module } from '@nestjs/common';
import { FlowsController } from './flows.controller';
import { FlowsService } from './flows.service';
import { FlowsRuntime } from './flows.runtime';

/**
 * Visual flow builder feature module.
 */
@Module({
  controllers: [FlowsController],
  providers: [FlowsService, FlowsRuntime],
  exports: [FlowsService],
})
export class FlowsModule {}
