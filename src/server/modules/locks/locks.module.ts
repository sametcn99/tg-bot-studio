import { Module } from '@nestjs/common';
import { LocksRuntime } from './locks.runtime';

/**
 * reference-parity chat locks: content-type based blocking with allowlists,
 * warning integration, and per-lock custom punishments.
 */
@Module({
  providers: [LocksRuntime],
})
export class LocksModule {}
