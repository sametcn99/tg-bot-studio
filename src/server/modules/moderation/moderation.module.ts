import { Module } from '@nestjs/common';
import { ModerationController } from './moderation.controller';
import { CaptchaRuntime } from './captcha.runtime';
import { ModerationRuntime } from './moderation.runtime';

/**
 * Captcha Gatekeeper and Automated Moderation & Anti-Spam feature module.
 */
@Module({
  controllers: [ModerationController],
  providers: [CaptchaRuntime, ModerationRuntime],
})
export class ModerationModule {}
