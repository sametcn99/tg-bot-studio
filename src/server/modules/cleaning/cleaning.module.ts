import { Module } from '@nestjs/common';
import { CleaningRuntime } from './cleaning.runtime';

/**
 * Cleaning feature module.
 */
@Module({
  providers: [CleaningRuntime],
})
export class CleaningModule {}
