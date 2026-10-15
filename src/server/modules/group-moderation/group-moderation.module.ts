import { Module } from '@nestjs/common';
import { GroupModerationRuntime } from './group-moderation.runtime';

/**
 * reference-parity in-group moderation commands: ban/mute/kick/warn/purge
 * families with timed, delete, and silent variants, approvals, and warn
 * mode settings.
 */
@Module({
  providers: [GroupModerationRuntime],
})
export class GroupModerationModule {}
