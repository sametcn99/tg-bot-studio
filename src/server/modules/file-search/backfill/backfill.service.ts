import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { EntityLike } from 'telegram/define';
import { MtprotoAuthService } from '../../scan-accounts/mtproto-auth.service';
import { ScanAccountModel } from '../../scan-accounts/scan-account.model';
import { GroupFileIndexModel } from '../group-file-index.model';
import { LiveEventsService } from '../../../common/live/live-events.service';
import { fromGramjsMessage, toBackfillEntry } from './mtproto-message';

/** Pause between history pages so Telegram never sees a flood pattern (ms). */
const PAGE_PAUSE_MS = 700;

/** Messages per paced page. */
const PAGE_SIZE = 100;

/** Flood waits up to this long are waited out; longer ones abort (seconds). */
const MAX_FLOOD_WAIT_S = 120;

/** Snapshot of the single studio-wide backfill job. */
export interface BackfillState {
  running: boolean;
  botId: string | null;
  chatId: string | null;
  phase: 'idle' | 'connecting' | 'scanning' | 'done' | 'cancelled' | 'error';
  scanned: number;
  indexed: number;
  errors: number;
  limit: number;
  startedAt: string | null;
  finishedAt: string | null;
  /** Machine-readable failure cause for localized UI messages. */
  errorCode: 'not_member' | 'auth' | 'flood' | 'generic' | null;
  errorDetail: string | null;
}

/** Idle state constant. */
const IDLE: BackfillState = {
  running: false,
  botId: null,
  chatId: null,
  phase: 'idle',
  scanned: 0,
  indexed: 0,
  errors: 0,
  limit: 0,
  startedAt: null,
  finishedAt: null,
  errorCode: null,
  errorDetail: null,
};

/**
 * Retroactive file-search indexer: walks one chat's Telegram history with a
 * connected scan account (MTProto) and upserts every media message into the
 * `group_file_index` table. One job runs studio-wide at a time; the job is
 * idempotent (unique bot+chat+message upserts) so re-running is always safe.
 */
@Injectable()
export class BackfillService {
  private readonly logger = new Logger(BackfillService.name);
  private state: BackfillState = { ...IDLE };
  private cancelRequested = false;

  /**
   * @param {ScanAccountModel} scanModel - Scan account persistence model.
   * @param {MtprotoAuthService} mtproto - Session client factory.
   * @param {GroupFileIndexModel} indexModel - File index persistence model.
   * @param {LiveEventsService} live - Live change bus for SSE pings.
   */
  constructor(
    private readonly scanModel: ScanAccountModel,
    private readonly mtproto: MtprotoAuthService,
    private readonly indexModel: GroupFileIndexModel,
    private readonly live: LiveEventsService,
  ) {}

  /**
   * Current job snapshot.
   * @returns {BackfillState} State.
   */
  status(): BackfillState {
    return { ...this.state };
  }

  /**
   * Requests cancellation of the running job (no-op when idle).
   * @returns {{success: boolean}} Confirmation payload.
   */
  cancel(): { success: boolean } {
    if (this.state.running) this.cancelRequested = true;
    return { success: true };
  }

  /**
   * Starts a backfill job; validation happens synchronously so callers get
   * immediate feedback, the scan itself runs detached.
   *
   * @param {string} botId - Studio bot id.
   * @param {string} chatId - Telegram chat id (negative numeric string).
   * @param {string} accountId - Scan account row id.
   * @param {number} limit - Max messages to walk (0 = entire history).
   * @returns {Promise<BackfillState>} Initial state.
   */
  async start(
    botId: string,
    chatId: string,
    accountId: string,
    limit: number,
  ): Promise<BackfillState> {
    if (this.state.running) throw new ConflictException('A backfill job is already running');
    if (!/^-\d+$/.test(chatId)) throw new BadRequestException('chatId must be a numeric group id');
    if (![0, 1_000, 5_000, 10_000].includes(limit)) {
      throw new BadRequestException('limit must be 0 (all), 1000, 5000 or 10000');
    }
    const account = await this.scanModel.findById(botId, accountId);
    if (!account) throw new NotFoundException('Scan account not found');
    if (account.status !== 'active') {
      throw new BadRequestException('SCAN_ACCOUNT_EXPIRED');
    }

    this.cancelRequested = false;
    this.state = {
      ...IDLE,
      running: true,
      botId,
      chatId,
      phase: 'connecting',
      limit,
      startedAt: new Date().toISOString(),
    };
    void this.execute(botId, chatId, account.id, account.sessionEnc, limit);
    return this.status();
  }

  /**
   * The detached scan loop.
   * @param {string} botId - Studio bot id.
   * @param {string} chatId - Telegram chat id.
   * @param {string} accountId - Scan account row id (for lastUsedAt).
   * @param {string} sessionEnc - Sealed session envelope.
   * @param {number} limit - Message cap (0 = all).
   * @returns {Promise<void>} Resolves once the job settles.
   */
  private async execute(
    botId: string,
    chatId: string,
    accountId: string,
    sessionEnc: string,
    limit: number,
  ): Promise<void> {
    let client: Awaited<ReturnType<MtprotoAuthService['clientFromSession']>> | null = null;
    try {
      client = await this.mtproto.clientFromSession(sessionEnc);
      let entity: EntityLike;
      try {
        entity = (await client.getEntity(Number(chatId))) as EntityLike;
      } catch (error) {
        this.fail('not_member', this.describe(error));
        return;
      }

      this.state.phase = 'scanning';
      let throttle: Promise<void> = Promise.resolve();
      for await (const message of client.iterMessages(entity, {
        limit: limit > 0 ? limit : undefined,
      })) {
        if (this.cancelRequested) {
          this.settle('cancelled');
          return;
        }
        this.state.scanned += 1;
        try {
          const entry = toBackfillEntry(fromGramjsMessage(message as never));
          if (entry) {
            await this.indexModel.indexMessage({
              botId,
              chatId,
              messageId: entry.messageId,
              kind: entry.kind,
              fileName: entry.fileName,
              caption: entry.caption,
              mimeType: entry.mimeType,
              fileSize: entry.fileSize,
              senderId: entry.senderId !== null ? BigInt(entry.senderId) : null,
              senderName: null,
              sentAt: entry.sentAt,
              searchText: entry.searchText,
            });
            this.state.indexed += 1;
          }
        } catch {
          this.state.errors += 1;
        }
        // Pace one pause per page so the scan never trips flood limits.
        if (this.state.scanned % PAGE_SIZE === 0) {
          throttle = new Promise((resolve) => setTimeout(resolve, PAGE_PAUSE_MS));
          await throttle;
        }
      }
      this.settle('done');
    } catch (error) {
      const name = this.errorName(error);
      if (
        name === 'AUTH_KEY_UNREGISTERED' ||
        name === 'SESSION_EXPIRED' ||
        name === 'USER_DEACTIVATED'
      ) {
        await this.scanModel
          .patch(this.state.botId ?? '', accountId, { status: 'expired' })
          .catch(() => undefined);
        this.fail('auth', this.describe(error));
        return;
      }
      if (name === 'FLOOD_WAIT' || /flood/i.test(String(error))) {
        const seconds = Number((error as { seconds?: number }).seconds ?? 0);
        if (seconds > MAX_FLOOD_WAIT_S) {
          this.fail('flood', this.describe(error));
          return;
        }
        // Short waits: pause and continue from where the iterator resumes.
        await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
        this.logger.warn(`backfill flood wait of ${seconds}s absorbed`);
        this.settle('done');
        return;
      }
      this.fail('generic', this.describe(error));
    } finally {
      if (client) await client.disconnect().catch(() => undefined);
      await this.scanModel
        .patch(this.state.botId ?? '', accountId, { lastUsedAt: new Date().toISOString() })
        .catch(() => undefined);
      if (this.state.botId) this.live.emit('file-index', this.state.botId);
    }
  }

  /**
   * Marks the job settled on a non-error outcome.
   * @param {'done'|'cancelled'} phase - Final phase.
   * @returns {void}
   */
  private settle(phase: 'done' | 'cancelled'): void {
    this.state.phase = phase;
    this.state.running = false;
    this.state.finishedAt = new Date().toISOString();
  }

  /**
   * Marks the job failed with a machine-readable cause.
   * @param {BackfillState['errorCode']} code - Cause code.
   * @param {string} detail - Raw error detail for the UI.
   * @returns {void}
   */
  private fail(code: NonNullable<BackfillState['errorCode']>, detail: string): void {
    this.state.phase = 'error';
    this.state.running = false;
    this.state.errorCode = code;
    this.state.errorDetail = detail;
    this.state.finishedAt = new Date().toISOString();
  }

  /**
   * Extracts the Telegram RPC error name.
   * @param {unknown} error - Thrown value.
   * @returns {string} Uppercase error name ('' when absent).
   */
  private errorName(error: unknown): string {
    const raw = (error as { errorMessage?: string })?.errorMessage;
    return typeof raw === 'string' ? raw.toUpperCase() : '';
  }

  /**
   * Short human-readable detail for an error.
   * @param {unknown} error - Thrown value.
   * @returns {string} Message.
   */
  private describe(error: unknown): string {
    const name = this.errorName(error);
    const base = error instanceof Error ? error.message : String(error);
    return name ? `${name}: ${base}` : base;
  }
}
