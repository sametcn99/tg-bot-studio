import { Module } from '@nestjs/common';
import { UsersCrmController } from './users-crm.controller';
import { UsersCrmService } from './users-crm.service';
import { ReferralsRuntime } from './referrals.runtime';

/**
 * Audience CRM & Segmentation plus the Referral Leaderboard runtime.
 */
@Module({
  controllers: [UsersCrmController],
  providers: [UsersCrmService, ReferralsRuntime],
  exports: [UsersCrmService],
})
export class UsersCrmModule {}
