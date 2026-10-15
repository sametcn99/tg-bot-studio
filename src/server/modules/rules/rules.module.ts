import { Module } from '@nestjs/common';
import { RulesRuntime } from './rules.runtime';

/**
 * reference-parity group rules: per-group rules text with PM delivery buttons
 * and the {rules} template placeholder deep link.
 */
@Module({
  providers: [RulesRuntime],
})
export class RulesModule {}
