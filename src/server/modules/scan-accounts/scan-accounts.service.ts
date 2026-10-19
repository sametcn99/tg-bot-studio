import { Injectable, NotFoundException } from '@nestjs/common';
import { Api } from 'telegram';
import { ScanAccountModel } from './scan-account.model';
import { MtprotoAuthService } from './mtproto-auth.service';
import { toScanAccountRow, type ScanAccountRow } from './scan-account.entity';
import { openSecret } from '../../common/utils/secret-box.util';
import { DEFAULT_JWT_SECRET } from '../../auth/auth-defaults';

/**
 * Scan account management: listing, renaming, removal (with a best-effort
 * MTProto logout), and the studio-wide MTProto credential surface.
 */
@Injectable()
export class ScanAccountsService {
  /**
   * @param {ScanAccountModel} scanModel - Scan account persistence model.
   * @param {MtprotoAuthService} mtproto - Login/session machine.
   */
  constructor(
    private readonly scanModel: ScanAccountModel,
    private readonly mtproto: MtprotoAuthService,
  ) {}

  /**
   * Lists the bot's scan accounts (never exposing sessions).
   * @param {string} botId - Studio bot id.
   * @returns {Promise<ScanAccountRow[]>} Rows.
   */
  async list(botId: string): Promise<ScanAccountRow[]> {
    const rows = await this.scanModel.list(botId);
    return rows.map(toScanAccountRow);
  }

  /**
   * Renames an account.
   * @param {string} botId - Studio bot id.
   * @param {string} id - Row id.
   * @param {string} label - New label.
   * @returns {Promise<ScanAccountRow>} Updated row.
   */
  async rename(botId: string, id: string, label: string): Promise<ScanAccountRow> {
    const row = await this.scanModel.patch(botId, id, { label: label.trim() || null });
    return toScanAccountRow(row);
  }

  /**
   * Removes an account after a best-effort MTProto logout (the stored
   * session is revoked server-side when possible; failures don't block
   * deletion — the sealed session dies with the row).
   *
   * @param {string} botId - Studio bot id.
   * @param {string} id - Row id.
   * @returns {Promise<{success: boolean}>} Confirmation payload.
   */
  async remove(botId: string, id: string): Promise<{ success: boolean }> {
    const row = await this.scanModel.findById(botId, id);
    if (!row) throw new NotFoundException(`Scan account ${id} not found`);
    try {
      const client = await this.mtproto.clientFromSession(row.sessionEnc);
      try {
        await client.invoke(new Api.auth.LogOut());
      } finally {
        await client.disconnect().catch(() => undefined);
      }
    } catch {
      // Session may already be dead — deleting the row is enough.
    }
    await this.scanModel.delete(botId, id, 'Scan account');
    return { success: true };
  }

  /**
   * Whether the studio MTProto credentials are configured.
   * @returns {{configured: boolean}} Status.
   */
  mtprotoStatus(): { configured: boolean } {
    try {
      this.mtproto.credentialsOrThrow();
      return { configured: true };
    } catch {
      return { configured: false };
    }
  }

  /**
   * Marks a session as usable again after a fresh re-login (the auth service
   * upsert already flips status; this re-seals nothing).
   * @param {string} botId - Studio bot id.
   * @param {string} phone - Account phone.
   * @returns {Promise<void>} Resolves once validated.
   */
  async assertSessionOpenable(botId: string, phone: string): Promise<void> {
    // Proves the sealed session can still be decrypted with current key material.
    const rows = await this.scanModel.list(botId);
    const row = rows.find((entry) => entry.phone === phone);
    if (!row) throw new NotFoundException(`Scan account ${phone} not found`);
    openSecret(row.sessionEnc, process.env.JWT_SECRET ?? DEFAULT_JWT_SECRET);
  }
}
