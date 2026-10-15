import { Module } from '@nestjs/common';
import { GroupToolsRuntime } from './group-tools.runtime';

/**
 * reference-parity group admin tools: pins, linked-channel controls, reports,
 * admin listing, /id and /info lookups, echo, and command disabling.
 */
@Module({
  providers: [GroupToolsRuntime],
})
export class GroupToolsModule {}
