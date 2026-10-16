import { Module } from '@nestjs/common';
import {
  HealthMonitorController,
  HealthEventsController,
  HealthOperatorController,
} from './health-monitor.controller';
import { HealthMonitorService } from './health-monitor.service';

/**
 * Bot health monitoring feature module.
 */
@Module({
  controllers: [HealthMonitorController, HealthEventsController, HealthOperatorController],
  providers: [HealthMonitorService],
  exports: [HealthMonitorService],
})
export class HealthMonitorModule {}
