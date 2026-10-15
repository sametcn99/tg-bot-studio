import { Module } from '@nestjs/common';
import { PrivacyRuntime } from './privacy.runtime';

/**
 * Privacy feature module.
 */
@Module({
  providers: [PrivacyRuntime],
})
export class PrivacyModule {}
