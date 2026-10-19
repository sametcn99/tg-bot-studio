import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { computeCheck } from 'telegram/Password';
import { Logger as GramjsLogger, LogLevel } from 'telegram/extensions/Logger';
import { SystemSettingsService } from '../../database/system-settings.service';
import { openSecret, sealSecret } from '../../common/utils/secret-box.util';
import { DEFAULT_JWT_SECRET } from '../../auth/auth-defaults';
import { ScanAccountModel } from './scan-account.model';
import { toScanAccountRow, type ScanAccountRow } from './scan-account.entity';

/** Studio setting keys for the shared MTProto application identity. */
const SETTING_API_ID = 'mtproto_api_id';
const SETTING_API_HASH = 'mtproto_api_hash';

/** How long a login ticket (code entry window) stays alive (ms). */
const TICKET_TTL_MS = 5 * 60_000;

/** Upper bound of simultaneously open login tickets. */
const MAX_TICKETS = 10;

/** One in-flight login: the connected client plus its code request state. */
interface LoginTicket {
  botId: string;
  phone: string;
  label: string | null;
  client: TelegramClient;
  phoneCodeHash: string;
  expiresAt: number;
}

/** Result of one login step. */
export interface LoginStepResult {
  status: 'codeSent' | 'needsPassword' | 'ready';
  ticket?: string;
  codeViaApp?: boolean;
  account?: ScanAccountRow;
}

/**
 * GramJS (MTProto) login state machine backing the scan-account wizard:
 * send code → sign in → (2FA password) → persist the sealed session string.
 * Tickets live in memory only and expire after five minutes; the session
 * string is AES-GCM sealed before it touches the database.
 */
@Injectable()
export class MtprotoAuthService {
  private readonly logger = new Logger(MtprotoAuthService.name);
  private readonly tickets = new Map<string, LoginTicket>();

  /**
   * @param {SystemSettingsService} settings - Studio-level key-value settings.
   * @param {ScanAccountModel} scanModel - Scan account persistence model.
   */
  constructor(
    private readonly settings: SystemSettingsService,
    private readonly scanModel: ScanAccountModel,
  ) {}

  /**
   * Whether the studio-wide api_id/api_hash pair has been configured.
   * @returns {boolean} True when MTProto credentials exist.
   */
  hasCredentials(): boolean {
    return Boolean(this.credentialsOrThrow());
  }

  /**
   * Persists the studio-wide api_id/api_hash pair.
   * @param {object} config - apiId (number) and apiHash (string).
   * @returns {Promise<void>} Resolves once stored.
   */
  async saveCredentials(config: { apiId: number; apiHash: string }): Promise<void> {
    if (!Number.isInteger(config.apiId) || config.apiId <= 0) {
      throw new BadRequestException('apiId must be a positive integer');
    }
    if (!/^[a-f0-9]{16,64}$/i.test(config.apiHash)) {
      throw new BadRequestException('apiHash looks invalid');
    }
    await this.settings.setSetting(SETTING_API_ID, String(config.apiId));
    await this.settings.setSetting(SETTING_API_HASH, config.apiHash);
  }

  /**
   * Starts a login: connects a fresh MTProto client and requests the login
   * code for the phone number.
   *
   * @param {string} botId - Studio bot id the account is added to.
   * @param {string} phone - Phone in international format (+90…).
   * @param {string | null} label - Optional operator label.
   * @returns {Promise<LoginStepResult>} Ticket id plus delivery info.
   */
  async beginLogin(botId: string, phone: string, label: string | null): Promise<LoginStepResult> {
    const phoneNormalized = phone.replace(/[\s()-]/g, '');
    if (!/^\+\d{7,15}$/.test(phoneNormalized)) {
      throw new BadRequestException('phone must be in +<country><number> format');
    }
    const { apiId, apiHash } = this.credentialsOrThrow();

    const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
      connectionRetries: 2,
      useWSS: false,
      baseLogger: new GramjsLogger(LogLevel.NONE),
    });
    await client.connect();
    try {
      const sent = (await client.invoke(
        new Api.auth.SendCode({
          phoneNumber: phoneNormalized,
          apiId,
          apiHash,
          settings: new Api.CodeSettings({}),
        }),
      )) as { phoneCodeHash: string; isCodeViaApp?: boolean };

      this.sweepTickets();
      const ticket = crypto.randomUUID();
      this.tickets.set(ticket, {
        botId,
        phone: phoneNormalized,
        label,
        client,
        phoneCodeHash: sent.phoneCodeHash,
        expiresAt: Date.now() + TICKET_TTL_MS,
      });
      return { status: 'codeSent', ticket, codeViaApp: sent.isCodeViaApp === true };
    } catch (error) {
      await client.disconnect().catch(() => undefined);
      throw this.toBadRequest(error, 'Could not send the login code');
    }
  }

  /**
   * Submits the login code; lands on `ready` or asks for the 2FA password.
   * @param {string} botId - Studio bot id.
   * @param {string} ticket - Login ticket id.
   * @param {string} code - Login code.
   * @returns {Promise<LoginStepResult>} Step outcome.
   */
  async submitCode(botId: string, ticket: string, code: string): Promise<LoginStepResult> {
    const entry = this.requireTicket(botId, ticket);
    try {
      await entry.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: entry.phone,
          phoneCodeHash: entry.phoneCodeHash,
          phoneCode: code.trim(),
        }),
      );
    } catch (error) {
      if (this.errorName(error) === 'SESSION_PASSWORD_NEEDED') {
        return { status: 'needsPassword', ticket };
      }
      throw this.toBadRequest(error, 'Login code rejected');
    }
    return { status: 'ready', account: await this.persistAccount(ticket) };
  }

  /**
   * Submits the 2FA password for a login waiting at the password step.
   * @param {string} botId - Studio bot id.
   * @param {string} ticket - Login ticket id.
   * @param {string} password - Two-factor password.
   * @returns {Promise<LoginStepResult>} Step outcome.
   */
  async submitPassword(botId: string, ticket: string, password: string): Promise<LoginStepResult> {
    const entry = this.requireTicket(botId, ticket);
    try {
      const passwordInfo = await entry.client.invoke(new Api.account.GetPassword());
      const check = await computeCheck(passwordInfo, password);
      await entry.client.invoke(new Api.auth.CheckPassword({ password: check }));
    } catch (error) {
      throw this.toBadRequest(error, 'Password rejected');
    }
    return { status: 'ready', account: await this.persistAccount(ticket) };
  }

  /**
   * Cancels a login ticket and disconnects its client.
   * @param {string} ticket - Login ticket id.
   * @returns {Promise<void>} Resolves once dropped.
   */
  async cancel(ticket: string): Promise<void> {
    const entry = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (entry) await entry.client.disconnect().catch(() => undefined);
  }

  /**
   * Reads the studio MTProto credentials or throws a friendly error.
   * @returns {{apiId: number, apiHash: string}} Credentials.
   */
  credentialsOrThrow(): { apiId: number; apiHash: string } {
    const apiId = Number(this.settings.getSetting(SETTING_API_ID) ?? 0);
    const apiHash = this.settings.getSetting(SETTING_API_HASH) ?? '';
    if (!apiId || !apiHash) {
      throw new BadRequestException('MTPROTO_NOT_CONFIGURED');
    }
    return { apiId, apiHash };
  }

  /**
   * Builds a connected client from a stored, sealed session.
   * @param {string} sessionEnc - Sealed session envelope.
   * @returns {Promise<TelegramClient>} Connected client.
   */
  async clientFromSession(sessionEnc: string): Promise<TelegramClient> {
    const { apiId, apiHash } = this.credentialsOrThrow();
    const session = openSecret(sessionEnc, this.boxKey());
    const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
      connectionRetries: 2,
      useWSS: false,
      baseLogger: new GramjsLogger(LogLevel.NONE),
    });
    await client.connect();
    return client;
  }

  /**
   * Seals a session string for storage.
   * @param {string} session - GramJS StringSession payload.
   * @returns {string} Sealed envelope.
   */
  sealSession(session: string): string {
    return sealSecret(session, this.boxKey());
  }

  /**
   * Seals-off the finished login: stores the account, frees the client.
   * @param {string} ticket - Login ticket id.
   * @returns {Promise<ScanAccountRow>} Stored account row.
   */
  private async persistAccount(ticket: string): Promise<ScanAccountRow> {
    const entry = this.tickets.get(ticket);
    if (!entry) throw new BadRequestException('Login ticket expired');
    this.tickets.delete(ticket);
    try {
      const me = (await entry.client.getMe()) as { username?: string; firstName?: string };
      const session = entry.client.session.save() as unknown as string;
      const account = await this.scanModel.upsertFromLogin({
        botId: entry.botId,
        phone: entry.phone,
        username: me.username ?? null,
        firstName: me.firstName ?? null,
        sessionEnc: this.sealSession(session),
        label: entry.label,
      });
      return toScanAccountRow(account);
    } finally {
      await entry.client.disconnect().catch(() => undefined);
    }
  }

  /**
   * Validates and returns a live ticket for the bot.
   * @param {string} botId - Studio bot id.
   * @param {string} ticket - Login ticket id.
   * @returns {LoginTicket} Live ticket.
   */
  private requireTicket(botId: string, ticket: string): LoginTicket {
    const entry = this.tickets.get(ticket);
    if (!entry || entry.botId !== botId || entry.expiresAt < Date.now()) {
      if (entry) this.cancel(ticket).catch(() => undefined);
      throw new BadRequestException('Login ticket expired — start again');
    }
    return entry;
  }

  /**
   * Drops expired tickets and caps the map size.
   * @returns {void}
   */
  private sweepTickets(): void {
    const now = Date.now();
    for (const [id, entry] of this.tickets) {
      if (entry.expiresAt < now) {
        this.cancel(id).catch(() => undefined);
      }
    }
    while (this.tickets.size > MAX_TICKETS) {
      const oldest = [...this.tickets.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
      if (!oldest) break;
      this.cancel(oldest[0]).catch(() => undefined);
    }
  }

  /**
   * Extracts the Telegram RPC error name from a thrown error.
   * @param {unknown} error - Thrown value.
   * @returns {string} Uppercase error name ('' when absent).
   */
  private errorName(error: unknown): string {
    const raw = (error as { errorMessage?: string })?.errorMessage;
    return typeof raw === 'string' ? raw.toUpperCase() : '';
  }

  /**
   * Converts a GramJS failure into a friendly BadRequest.
   * @param {unknown} error - Thrown value.
   * @param {string} fallback - Generic message.
   * @returns {BadRequestException} Mapped error.
   */
  private toBadRequest(error: unknown, fallback: string): BadRequestException {
    const name = this.errorName(error);
    this.logger.warn(
      `mtproto login failure: ${name || 'UNKNOWN'}: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (name === 'PHONE_NUMBER_INVALID') {
      return new BadRequestException('Invalid phone number');
    }
    if (name === 'PHONE_CODE_INVALID' || name === 'PHONE_CODE_EXPIRED') {
      return new BadRequestException('The code is invalid or expired');
    }
    if (name === 'PASSWORD_HASH_INVALID') {
      return new BadRequestException('The password is incorrect');
    }
    if (name === 'FLOOD_WAIT' || /flood/i.test(String(error))) {
      const seconds = Number((error as { seconds?: number })?.seconds ?? 0);
      return new BadRequestException(`FLOOD_WAIT:${seconds}`);
    }
    if (name === 'API_ID_INVALID' || name === 'API_ID_PUBLISHED_FLOOD') {
      return new BadRequestException('MTPROTO api_id/api_hash are invalid');
    }
    return new BadRequestException(
      `${fallback}: ${name || (error instanceof Error ? error.message : String(error))}`,
    );
  }

  /**
   * Key material for session sealing (JWT secret of the studio).
   * @returns {string} Key material.
   */
  private boxKey(): string {
    return process.env.JWT_SECRET ?? DEFAULT_JWT_SECRET;
  }
}
