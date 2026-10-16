import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { SseTicketService } from './sse-ticket.service';
import { resolveJwtSecret } from './auth-defaults';

/**
 * Authentication feature module wiring JWT signing, the passport strategy,
 * and the auth controller.
 */
@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: resolveJwtSecret(),
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, SseTicketService],
  exports: [AuthService],
})
export class AuthModule {}
