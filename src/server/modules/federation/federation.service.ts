import { Injectable } from '@nestjs/common';
import type { Fed, FedBan } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { BotPoolService } from '../../bot-engine/bot-pool.service';

/** Fed lookup result including subscription chain. */
export interface FedEnforcement {
  fed: Fed;
  ban: FedBan | null;
  /** Fed the ban actually came from (subfed when inherited). */
  sourceFed: Fed;
}

/**
 * Data + enforcement layer for ban federations: ban caching per fed,
 * active ban propagation across every joined chat of every bot, passive
 * checks on joins and messages, and fban list import/export.
 */
@Injectable()
export class FederationService {
  /** Banned telegram ids per fed (in-memory mirror, refreshed on writes). */
  private readonly banCache = new Map<string, Map<string, FedBan>>();

  /**
   * @param {PrismaService} prisma - Prisma ORM access service.
   * @param {BotPoolService} botPool - Live bot runtime pool.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly botPool: BotPoolService,
  ) {}

  /**
   * Loads (or refreshes) the ban map of a fed including its subfed chain.
   */
  private async banMap(fedId: string): Promise<Map<string, FedBan>> {
    const cached = this.banCache.get(fedId);
    if (cached) return cached;

    const map = new Map<string, FedBan>();
    const fed = await this.prisma.fed.findUnique({ where: { id: fedId } });
    if (fed) {
      const bans = await this.prisma.fedBan.findMany({ where: { fedId } });
      for (const ban of bans) map.set(String(ban.telegramId), ban);
    }
    this.banCache.set(fedId, map);
    return map;
  }

  /**
   * Drops cached bans for a fed (called after ban mutations).
   */
  private invalidate(fedId: string): void {
    this.banCache.delete(fedId);
  }

  /**
   * Finds the fed a chat is joined to (this bot's membership).
   */
  async fedForChat(botId: string, chatId: string | number): Promise<FedChatRow | null> {
    return this.prisma.fedChat.findFirst({ where: { botId, chatId: String(chatId) } });
  }

  /**
   * Checks whether a user is banned in the fed enforcing a chat (including
   * subscription chains).
   */
  async checkBan(
    botId: string,
    chatId: string | number,
    telegramId: number,
  ): Promise<FedEnforcement | null> {
    const membership = await this.prisma.fedChat.findFirst({
      where: { botId, chatId: String(chatId) },
    });
    if (!membership) return null;

    const fed = await this.prisma.fed.findUnique({ where: { id: membership.fedId } });
    if (!fed) return null;

    const map = await this.banMap(fed.id);
    const direct = map.get(String(telegramId));
    if (direct) return { fed, ban: direct, sourceFed: fed };

    const subs = await this.prisma.fedSub.findMany({ where: { fedId: fed.id } });
    for (const sub of subs) {
      const subFed = await this.prisma.fed.findUnique({ where: { id: sub.subscribedFedId } });
      if (!subFed) continue;
      const subMap = await this.banMap(subFed.id);
      const ban = subMap.get(String(telegramId));
      if (ban) return { fed, ban, sourceFed: subFed };
    }
    return null;
  }

  /**
   * Applies an fban actively: bans the user in every joined chat of the fed
   * across all studio bots (best effort, quiet like reference for performance).
   */
  async propagateBan(fedId: string, telegramId: number): Promise<number> {
    const chats = await this.prisma.fedChat.findMany({ where: { fedId } });
    let applied = 0;
    for (const chat of chats) {
      const bot = this.botPool.getBot(chat.botId);
      if (!bot) continue;
      const ok = await bot.api
        .banChatMember(Number(chat.chatId), telegramId, { until_date: 0 })
        .then(() => true)
        .catch(() => false);
      if (ok) applied++;
    }
    return applied;
  }

  /**
   * Records a federation ban and propagates it.
   */
  async fban(
    fedId: string,
    telegramId: number,
    reason: string,
    bannedBy: number,
  ): Promise<{ created: boolean; applied: number }> {
    const existing = await this.prisma.fedBan.findUnique({
      where: { fedId_telegramId: { fedId, telegramId: BigInt(telegramId) } },
    });
    await this.prisma.fedBan.upsert({
      where: { fedId_telegramId: { fedId, telegramId: BigInt(telegramId) } },
      create: {
        fedId,
        telegramId: BigInt(telegramId),
        reason,
        bannedBy: BigInt(bannedBy),
        createdAt: new Date().toISOString(),
      },
      update: { reason },
    });
    this.invalidate(fedId);
    const applied = await this.propagateBan(fedId, telegramId);
    return { created: !existing, applied };
  }

  /**
   * Removes a federation ban (does not auto-unban in chats, reference parity).
   */
  async unfban(fedId: string, telegramId: number): Promise<boolean> {
    const removed = await this.prisma.fedBan
      .delete({ where: { fedId_telegramId: { fedId, telegramId: BigInt(telegramId) } } })
      .then(() => true)
      .catch(() => false);
    this.invalidate(fedId);
    return removed;
  }

  /**
   * Imports bans from CSV (header row with `id` and `reason`) or NDJSON
   * (`{"user_id":1234,...}` per line), reference-compatible formats.
   */
  async importBans(fedId: string, content: string, bannedBy: number): Promise<number> {
    let imported = 0;
    const trimmed = content.trim();
    if (trimmed.startsWith('{') || trimmed.includes('"user_id"')) {
      for (const line of trimmed.split(/\r?\n/)) {
        if (!line.trim().startsWith('{')) continue;
        try {
          const parsed = JSON.parse(line) as { user_id?: number; reason?: string };
          if (!parsed.user_id) continue;
          await this.fban(fedId, Number(parsed.user_id), parsed.reason ?? 'Imported ban', bannedBy);
          imported++;
        } catch {
          // Skip malformed lines.
        }
      }
    } else {
      const lines = trimmed.split(/\r?\n/);
      const header = lines[0]?.toLowerCase() ?? '';
      const idIndex = header.split(',').findIndex((cell) => cell.trim() === 'id');
      const reasonIndex = header.split(',').findIndex((cell) => cell.trim() === 'reason');
      for (const line of lines.slice(1)) {
        if (!line.trim()) continue;
        const cells = this.parseCsvLine(line);
        const id = Number(cells[idIndex >= 0 ? idIndex : 0]);
        if (!Number.isFinite(id) || id <= 0) continue;
        const reason = reasonIndex >= 0 ? (cells[reasonIndex] ?? 'Imported ban') : 'Imported ban';
        await this.fban(fedId, id, reason, bannedBy);
        imported++;
      }
    }
    return imported;
  }

  /**
   * Minimal CSV line splitter honoring double quotes.
   */
  private parseCsvLine(line: string): string[] {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        cells.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current);
    return cells;
  }
}

/** Re-exported fed chat row type. */
export type FedChatRow = import('@prisma/client').FedChat;
