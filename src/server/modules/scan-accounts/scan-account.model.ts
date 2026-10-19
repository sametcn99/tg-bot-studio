import { Injectable } from '@nestjs/common';
import type { ScanAccount } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { BotScopedCrudModel } from '../../database/crud.model';

/**
 * Model managing per-bot MTProto scan accounts. Retrieval and deletion live
 * in the shared {@link BotScopedCrudModel} skeleton; login upserts and field
 * patches stay here.
 */
@Injectable()
export class ScanAccountModel extends BotScopedCrudModel<ScanAccount> {
  /** @param {PrismaService} prisma - Prisma ORM access service. */
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected override readonly delegate = this.prisma.scanAccount;

  /**
   * Upserts the account for a phone number (re-login refreshes the session
   * of an existing — possibly expired — row instead of duplicating it).
   *
   * @param {object} data - Login result fields.
   * @returns {Promise<ScanAccount>} Written row.
   */
  async upsertFromLogin(data: {
    botId: string;
    phone: string;
    username?: string | null;
    firstName?: string | null;
    sessionEnc: string;
    label?: string | null;
  }): Promise<ScanAccount> {
    const now = new Date().toISOString();
    return this.prisma.scanAccount.upsert({
      where: { botId_phone: { botId: data.botId, phone: data.phone } },
      create: {
        botId: data.botId,
        phone: data.phone,
        username: data.username ?? null,
        firstName: data.firstName ?? null,
        sessionEnc: data.sessionEnc,
        status: 'active',
        label: data.label ?? null,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        username: data.username ?? null,
        firstName: data.firstName ?? null,
        sessionEnc: data.sessionEnc,
        status: 'active',
        ...(data.label !== undefined ? { label: data.label } : {}),
        updatedAt: now,
      },
    });
  }

  /**
   * Patches mutable fields (label, status, lastUsedAt).
   * @param {string} botId - Owning bot id.
   * @param {string} id - Row id.
   * @param {object} fields - Fields to patch.
   * @returns {Promise<ScanAccount>} Updated row.
   */
  async patch(
    botId: string,
    id: string,
    fields: { label?: string | null; status?: string; lastUsedAt?: string },
  ): Promise<ScanAccount> {
    await this.require(botId, id, 'Scan account');
    return this.prisma.scanAccount.update({
      where: { id },
      data: { ...fields, updatedAt: new Date().toISOString() },
    });
  }
}
