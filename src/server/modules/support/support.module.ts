import { Module } from '@nestjs/common';
import { SupportController } from './support.controller';
import { SupportRuntime } from './support.runtime';

/**
 * Forum Topics Support Desk (Livegram) feature module.
 */
@Module({
  controllers: [SupportController],
  providers: [SupportRuntime],
})
export class SupportModule {}
