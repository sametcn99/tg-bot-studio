import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ScanAccountsService } from './scan-accounts.service';
import { MtprotoAuthService } from './mtproto-auth.service';

/** Login-step request payloads (kept loose; validated in place). */
interface LoginStartBody {
  phone?: string;
  label?: string | null;
}
interface LoginCodeBody {
  ticket?: string;
  code?: string;
  label?: string | null;
}
interface LoginPasswordBody {
  ticket?: string;
  password?: string;
  label?: string | null;
}

/**
 * Scan account endpoints for a bot: MTProto account management for the
 * file-search backfill (list, login wizard, rename, remove, studio MTProto
 * credentials).
 */
@Controller('bots/:botId/scan-accounts')
export class ScanAccountsController {
  /**
   * @param {ScanAccountsService} service - Account management service.
   * @param {MtprotoAuthService} mtproto - Login machine.
   */
  constructor(
    private readonly service: ScanAccountsService,
    private readonly mtproto: MtprotoAuthService,
  ) {}

  /**
   * Lists the bot's scan accounts.
   * @param {string} botId - Studio bot id.
   * @returns {Promise<object[]>} Account rows (sessions never included).
   */
  @Get()
  list(@Param('botId') botId: string) {
    return this.service.list(botId);
  }

  /**
   * Reports whether the studio-wide MTProto credentials are configured.
   * @returns {{configured: boolean}} Status.
   */
  @Get('mtproto-status')
  mtprotoStatus() {
    return this.service.mtprotoStatus();
  }

  /**
   * Stores the studio-wide MTProto credentials.
   * @param {object} body - apiId + apiHash.
   * @returns {Promise<{success: boolean}>} Confirmation payload.
   */
  @Put('mtproto-status')
  async saveMtproto(@Body() body: { apiId?: number; apiHash?: string }) {
    await this.mtproto.saveCredentials({
      apiId: Number(body.apiId ?? 0),
      apiHash: String(body.apiHash ?? ''),
    });
    return { success: true };
  }

  /**
   * Starts a login: sends the code to the phone.
   * @param {string} botId - Studio bot id.
   * @param {LoginStartBody} body - phone, optional label.
   * @returns {Promise<object>} Ticket + delivery info.
   */
  @Post('login/start')
  start(@Param('botId') botId: string, @Body() body: LoginStartBody) {
    const phone = String(body.phone ?? '').trim();
    if (!phone) throw new BadRequestException('phone is required');
    return this.mtproto.beginLogin(botId, phone, body.label ? String(body.label).trim() : null);
  }

  /**
   * Submits the login code.
   * @param {string} botId - Studio bot id.
   * @param {LoginCodeBody} body - ticket + code.
   * @returns {Promise<object>} Step outcome.
   */
  @Post('login/code')
  code(@Param('botId') botId: string, @Body() body: LoginCodeBody) {
    const ticket = String(body.ticket ?? '');
    const code = String(body.code ?? '').trim();
    if (!ticket || !code) throw new BadRequestException('ticket and code are required');
    return this.mtproto.submitCode(botId, ticket, code);
  }

  /**
   * Submits the 2FA password.
   * @param {string} botId - Studio bot id.
   * @param {LoginPasswordBody} body - ticket + password.
   * @returns {Promise<object>} Step outcome.
   */
  @Post('login/password')
  password(@Param('botId') botId: string, @Body() body: LoginPasswordBody) {
    const ticket = String(body.ticket ?? '');
    const password = String(body.password ?? '');
    if (!ticket || !password) throw new BadRequestException('ticket and password are required');
    return this.mtproto.submitPassword(botId, ticket, password);
  }

  /**
   * Cancels an in-flight login.
   * @param {object} body - ticket.
   * @returns {Promise<{success: boolean}>} Confirmation payload.
   */
  @Post('login/cancel')
  async cancel(@Body() body: { ticket?: string }) {
    await this.mtproto.cancel(String(body.ticket ?? ''));
    return { success: true };
  }

  /**
   * Renames an account.
   * @param {string} botId - Studio bot id.
   * @param {string} id - Row id.
   * @param {object} body - label.
   * @returns {Promise<object>} Updated row.
   */
  @Patch(':id')
  rename(@Param('botId') botId: string, @Param('id') id: string, @Body() body: { label?: string }) {
    return this.service.rename(botId, id, String(body.label ?? ''));
  }

  /**
   * Removes an account (best-effort MTProto logout included).
   * @param {string} botId - Studio bot id.
   * @param {string} id - Row id.
   * @returns {Promise<{success: boolean}>} Confirmation payload.
   */
  @Delete(':id')
  remove(@Param('botId') botId: string, @Param('id') id: string) {
    return this.service.remove(botId, id);
  }
}
