import { Module } from '@nestjs/common';
import { TemplatesController, TemplateApplyController } from './templates.controller';
import { TemplatesService } from './templates.service';
import { BotsModule } from '../bots/bots.module';

/**
 * Template gallery feature module (save/apply full-bot configuration bundles).
 */
@Module({
  imports: [BotsModule],
  controllers: [TemplatesController, TemplateApplyController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
