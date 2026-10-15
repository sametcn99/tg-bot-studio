import { Module } from '@nestjs/common';
import { AntiraidRuntime } from './antiraid.runtime';

/**
 * AntiRaid feature module: temporary bans for join floods during raid
 * attacks, manual or automatically triggered.
 */
@Module({
  providers: [AntiraidRuntime],
})
export class AntiraidModule {}
