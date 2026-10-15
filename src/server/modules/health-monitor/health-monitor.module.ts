import { Module } from '@nestjs/common';
import { HealthMonitorController, HealthEventsController } from './health-monitor.controller';
import { HealthMonitorService } from './health-monitor.service';

/**
 * Bot health monitoring feature module.
 */
@Module({
  controllers: [HealthMonitorController, HealthEventsController],
  providers: [HealthMonitorService],
  exports: [HealthMonitorService],
})
export class HealthMonitorModule {}
