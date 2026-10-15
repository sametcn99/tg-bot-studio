import { Module } from '@nestjs/common';
import { LanguageRuntime } from './language.runtime';

/**
 * Bot reply language feature module (/setlang per chat).
 */
@Module({
  providers: [LanguageRuntime],
})
export class LanguageModule {}
