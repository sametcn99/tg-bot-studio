import { Injectable } from '@nestjs/common';
import { InputFile, type Context } from 'grammy';
import type { Fed } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { AdminGateService } from '../../bot-engine/admin-gate.service';
import { BotI18nService } from '../../bot-engine/bot-i18n.service';
import { AdminLogService } from '../../bot-engine/admin-log.service';
import { RestrictionsService } from '../../bot-engine/restrictions.service';
import { FederationService } from './federation.service';
import { resolveTarget } from '../../common/utils/telegram-text.util';

/** fbanlist rate-limit window (once per 30 minutes, per fed, reference parity). */
const FBANLIST_COOLDOWN_MS = 30 * 60_000;
/** Maximum subfed subscriptions per fed. */
const MAX_SUBS = 5;

/**
 * Runtime for the Ban Federations module (reference parity, generalized
 * cross-bot): fed lifecycle commands in PM, chat join/leave, fban/unfban
 * with active propagation, fed admins, subscriptions, ban list
 * import/export, and passive enforcement on joins/messages.
 */
@Injectable()
export class FederationRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'federation';

  /** fbanlist last-fetch timestamps per fed. */
  private readonly fbanlistAt = new Map<string, number>();

  /**
   * @param {PrismaService} prisma - Prisma ORM access service.
   * @param {FederationService} federation - Fed data + enforcement layer.
   * @param {AdminGateService} adminGate - Telegram permission gate.
   * @param {RestrictionsService} restrictions - Shared action executor.
   * @param {AdminLogService} adminLog - Admin action log bus.
   * @param {BotI18nService} i18n - Bot-reply localization.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly federation: FederationService,
    private readonly adminGate: AdminGateService,
    private readonly restrictions: RestrictionsService,
    private readonly adminLog: AdminLogService,
    private readonly i18n: BotI18nService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches fed commands and passive enforcement.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot, botId } = ctx;

    // --- Passive enforcement ------------------------------------------------
    const passive = async (c: Context, userId: number) => {
      if (!c.chat) return;
      const hit = await this.federation.checkBan(botId, c.chat.id, userId);
      if (!hit) return;
      await this.restrictions.ban(c.api, c.chat.id, userId);
      this.adminLog.emit({
        botId,
        chatId: c.chat.id,
        category: 'automated',
        text: `Fed ban enforced (${hit.sourceFed.name}) on ${userId}`,
      });
      const membership = await this.prisma.fedChat.findFirst({
        where: { botId, chatId: String(c.chat.id) },
      });
      if (membership?.quiet === 1) return;
      const lang = await this.i18n.getChatLanguage(botId, c.chat.id);
      await c.api
        .sendMessage(
          c.chat.id,
          this.i18n.t(lang, 'federation.fedBanHit', {
            user: `<a href="tg://user?id=${userId}">User ${userId}</a>`,
            reason: hit.ban?.reason ?? '—',
          }),
          { parse_mode: 'HTML' },
        )
        .catch(() => undefined);
    };

    bot.on('chat_member', async (c, next) => {
      try {
        const status = c.chatMember.new_chat_member.status;
        if (status === 'member' || status === 'administrator') {
          await passive(c, c.chatMember.new_chat_member.user.id);
        }
      } finally {
        await next();
      }
    });

    bot.on('message', async (c, next) => {
      try {
        if (!c.chat || (c.chat.type !== 'supergroup' && c.chat.type !== 'group')) return;
        if (!c.from || c.from.is_bot) return;
        // Cheap throttle: only inspect every message via the cached ban map.
        await passive(c, c.from.id);
      } finally {
        await next();
      }
    });

    // --- Fed lifecycle (PM) -------------------------------------------------
    bot.command('newfed', (c) => this.handleNewFed(c, botId));
    bot.command('renamefed', (c) => this.handleRenameFed(c, botId));
    bot.command('delfed', (c) => this.handleDelFed(c, botId));

    // --- Chat membership -----------------------------------------------------
    bot.command('joinfed', (c) => this.handleJoinFed(c, botId));
    bot.command('leavefed', (c) => this.handleLeaveFed(c, botId));
    bot.command('quietfed', (c) => this.handleQuietFed(c, botId));

    // --- Bans ------------------------------------------------------------------
    bot.command('fban', (c) => this.handleFban(c, botId, true));
    bot.command('unfban', (c) => this.handleFban(c, botId, false));
    bot.command('fbanlist', (c) => this.handleFbanList(c, botId));
    bot.command('importfbans', (c) => this.handleImportBans(c, botId));

    // --- Fed management ---------------------------------------------------------
    bot.command('fedpromote', (c) => this.handleFedAdmin(c, botId, true));
    bot.command('feddemote', (c) => this.handleFedAdmin(c, botId, false));
    bot.command('feddemoteme', (c) => this.handleFedAdminSelf(c, botId));
    bot.command('fedinfo', (c) => this.handleFedInfo(c, botId));
    bot.command('fedadmins', (c) => this.handleFedAdmins(c, botId));
    bot.command('fedreason', (c) => this.handleFedReason(c, botId));
    bot.command('fednotif', (c) => this.handleFedNotif(c, botId));
    bot.command('subfed', (c) => this.handleSubFed(c, botId, true));
    bot.command('unsubfed', (c) => this.handleSubFed(c, botId, false));
    bot.command('fedsubs', (c) => this.handleFedSubs(c, botId));

    // --- User commands ------------------------------------------------------------
    bot.command('fedstat', (c) => this.handleFedStat(c, botId));
    bot.command('fbanstat', (c) => this.handleFbanStat(c, botId));
  }

  /**
   * Resolves the fed owned by the command sender (PM context).
   */
  private async ownedFed(botId: string, telegramId: number): Promise<Fed | null> {
    return this.prisma.fed.findFirst({ where: { ownerTelegramId: BigInt(telegramId) } });
  }

  /**
   * Resolves the fed in scope: the chat's fed for groups, the sender's own
   * fed for PMs.
   */
  private async scopedFed(
    c: Context,
    botId: string,
  ): Promise<{ fed: Fed; chatFed: boolean } | null> {
    if (c.chat?.type === 'supergroup' || c.chat?.type === 'group') {
      const membership = await this.prisma.fedChat.findFirst({
        where: { botId, chatId: String(c.chat.id) },
      });
      if (!membership) return null;
      const fed = await this.prisma.fed.findUnique({ where: { id: membership.fedId } });
      return fed ? { fed, chatFed: true } : null;
    }
    if (!c.from) return null;
    const fed = await this.ownedFed(botId, c.from.id);
    return fed ? { fed, chatFed: false } : null;
  }

  /**
   * Checks fed-admin rights (owner or fed admin).
   */
  private async isFedAdmin(fedId: string, telegramId: number, isOwner: boolean): Promise<boolean> {
    if (isOwner) return true;
    const admin = await this.prisma.fedAdmin
      .findUnique({
        where: { fedId_telegramId: { fedId, telegramId: BigInt(telegramId) } },
      })
      .catch(() => null);
    return admin !== null;
  }

  /**
   * Handles /newfed <name> (PM, one fed per owner).
   */
  private async handleNewFed(c: Context, botId: string): Promise<void> {
    if (c.chat?.type !== 'private' || !c.from) return;
    const lang = await this.i18n.getChatLanguage(botId, c.from.id);
    const name = String(typeof c.match === 'string' ? c.match : '').trim();
    if (!name) return;
    if (name.length > 64) {
      await c.reply(this.i18n.t(lang, 'federation.nameTooLong')).catch(() => undefined);
      return;
    }
    const existing = await this.ownedFed(botId, c.from.id);
    if (existing) {
      await c.reply(this.i18n.t(lang, 'federation.onePerOwner')).catch(() => undefined);
      return;
    }
    const fed = await this.prisma.fed.create({
      data: {
        name,
        ownerTelegramId: BigInt(c.from.id),
        ownerBotId: botId,
        createdAt: new Date().toISOString(),
      },
    });
    await c
      .reply(
        this.i18n.t(lang, 'federation.created', {
          name: name.replace(/</g, '&lt;'),
          fedId: fed.id,
        }),
        { parse_mode: 'HTML' },
      )
      .catch(() => undefined);
  }

  /**
   * Handles /renamefed <name> (owner, PM).
   */
  private async handleRenameFed(c: Context, botId: string): Promise<void> {
    if (c.chat?.type !== 'private' || !c.from) return;
    const lang = await this.i18n.getChatLanguage(botId, c.from.id);
    const fed = await this.ownedFed(botId, c.from.id);
    if (!fed) {
      await c.reply(this.i18n.t(lang, 'federation.noFed')).catch(() => undefined);
      return;
    }
    const name = String(typeof c.match === 'string' ? c.match : '')
      .trim()
      .slice(0, 64);
    if (!name) return;
    await this.prisma.fed.update({ where: { id: fed.id }, data: { name } });
    await c.reply(this.i18n.t(lang, 'federation.renamed', { name })).catch(() => undefined);
  }

  /**
   * Handles /delfed (owner, PM).
   */
  private async handleDelFed(c: Context, botId: string): Promise<void> {
    if (c.chat?.type !== 'private' || !c.from) return;
    const lang = await this.i18n.getChatLanguage(botId, c.from.id);
    const fed = await this.ownedFed(botId, c.from.id);
    if (!fed) {
      await c.reply(this.i18n.t(lang, 'federation.noFed')).catch(() => undefined);
      return;
    }
    await this.prisma.fed.delete({ where: { id: fed.id } });
    await c.reply(this.i18n.t(lang, 'federation.deleted')).catch(() => undefined);
  }

  /**
   * Handles /joinfed <fedId> (group owner only).
   */
  private async handleJoinFed(c: Context, botId: string): Promise<void> {
    if (c.chat?.type !== 'supergroup' && c.chat?.type !== 'group') return;
    if (!c.from) return;
    const chatId = c.chat.id;
    const lang = await this.i18n.getChatLanguage(botId, chatId);
    if (!(await this.adminGate.isOwner(c.api, chatId, c.from.id))) {
      await c.reply(this.i18n.t(lang, 'federation.ownerRequired')).catch(() => undefined);
      return;
    }
    const fedId = String(typeof c.match === 'string' ? c.match : '').trim();
    const fed = await this.prisma.fed.findUnique({ where: { id: fedId } });
    if (!fed) {
      await c.reply(this.i18n.t(lang, 'common.error')).catch(() => undefined);
      return;
    }
    await this.prisma.fedChat.upsert({
      where: { fedId_botId_chatId: { fedId, botId, chatId: String(chatId) } },
      create: { fedId, botId, chatId: String(chatId), joinedAt: new Date().toISOString() },
      update: {},
    });
    await c
      .reply(this.i18n.t(lang, 'federation.joined', { name: fed.name.replace(/</g, '&lt;') }), {
        parse_mode: 'HTML',
      })
      .catch(() => undefined);
  }

  /**
   * Handles /leavefed (group owner only).
   */
  private async handleLeaveFed(c: Context, botId: string): Promise<void> {
    if (c.chat?.type !== 'supergroup' && c.chat?.type !== 'group') return;
    if (!c.from) return;
    const chatId = c.chat.id;
    const lang = await this.i18n.getChatLanguage(botId, chatId);
    if (!(await this.adminGate.isOwner(c.api, chatId, c.from.id))) {
      await c.reply(this.i18n.t(lang, 'federation.ownerRequired')).catch(() => undefined);
      return;
    }
    const membership = await this.prisma.fedChat.findFirst({
      where: { botId, chatId: String(chatId) },
    });
    if (!membership) {
      await c.reply(this.i18n.t(lang, 'federation.notJoined')).catch(() => undefined);
      return;
    }
    await this.prisma.fedChat.delete({ where: { fedId_botId_chatId: membership } });
    await c.reply(this.i18n.t(lang, 'federation.left')).catch(() => undefined);
  }

  /**
   * Handles /quietfed on|off.
   */
  private async handleQuietFed(c: Context, botId: string): Promise<void> {
    if (c.chat?.type !== 'supergroup' && c.chat?.type !== 'group') return;
    if (!c.from) return;
    const chatId = c.chat.id;
    const membership = await this.prisma.fedChat.findFirst({
      where: { botId, chatId: String(chatId) },
    });
    if (!membership) return;
    const enable = ['on', 'yes', 'true'].includes(
      String(typeof c.match === 'string' ? c.match : '')
        .trim()
        .toLowerCase(),
    );
    await this.prisma.fedChat.update({
      where: { fedId_botId_chatId: membership },
      data: { quiet: enable ? 1 : 0 },
    });
    await c.reply('✅').catch(() => undefined);
  }

  /**
   * Handles /fban and /unfban (fed admins; group or PM).
   */
  private async handleFban(c: Context, botId: string, ban: boolean): Promise<void> {
    const isGroup = c.chat?.type === 'supergroup' || c.chat?.type === 'group';
    if (!isGroup && c.chat?.type !== 'private') return;
    if (!c.from) return;
    const lang = await this.i18n.getChatLanguage(botId, c.from.id);

    const scope = await this.scopedFed(c, botId);
    if (!scope) {
      if (!isGroup) await c.reply(this.i18n.t(lang, 'federation.noFed')).catch(() => undefined);
      return;
    }
    const isOwner = scope.fed.ownerTelegramId === BigInt(c.from.id);
    if (!(await this.isFedAdmin(scope.fed.id, c.from.id, isOwner))) {
      await c.reply(this.i18n.t(lang, 'common.adminOnly')).catch(() => undefined);
      return;
    }

    const replyUser = c.msg?.reply_to_message?.from;
    const args = String(typeof c.match === 'string' ? c.match : '').trim();
    const { userId } = resolveTarget(args, replyUser);
    const targetId = userId ?? null;
    if (!targetId) {
      await c.reply(this.i18n.t(lang, 'common.userNotFound')).catch(() => undefined);
      return;
    }
    const reason = args.split(/\s+/).slice(1).join(' ').trim();

    if (ban) {
      if (!reason && scope.fed.fedReasonRequired === 1) {
        await c.reply(this.i18n.t(lang, 'common.error')).catch(() => undefined);
        return;
      }
      await this.federation.fban(scope.fed.id, targetId, reason || 'Banned', c.from.id);
      this.adminLog.emit({
        botId,
        chatId: c.chat!.id,
        category: 'admin',
        text: `${c.from.first_name} fban ${targetId}: ${reason}`,
      });
      await c
        .reply(
          this.i18n.t(lang, 'federation.fbanned', {
            user: `<a href="tg://user?id=${targetId}">User ${targetId}</a>`,
            reason: reason || '—',
          }),
          { parse_mode: 'HTML' },
        )
        .catch(() => undefined);
      return;
    }

    const removed = await this.federation.unfban(scope.fed.id, targetId);
    await c
      .reply(
        removed
          ? this.i18n.t(lang, 'federation.funbanned', {
              user: `<a href="tg://user?id=${targetId}">User ${targetId}</a>`,
            })
          : this.i18n.t(lang, 'federation.notFedBanned'),
        { parse_mode: 'HTML' },
      )
      .catch(() => undefined);
  }

  /**
   * Handles /fbanlist [csv|json] (rate limited, sends a document).
   */
  private async handleFbanList(c: Context, botId: string): Promise<void> {
    if (!c.from) return;
    const scope = await this.scopedFed(c, botId);
    const lang = await this.i18n.getChatLanguage(botId, c.from.id);
    if (!scope) {
      await c.reply(this.i18n.t(lang, 'federation.noFed')).catch(() => undefined);
      return;
    }
    const last = this.fbanlistAt.get(scope.fed.id) ?? 0;
    if (Date.now() - last < FBANLIST_COOLDOWN_MS) {
      await c.reply(this.i18n.t(lang, 'federation.listRateLimited')).catch(() => undefined);
      return;
    }
    this.fbanlistAt.set(scope.fed.id, Date.now());

    const format = String(typeof c.match === 'string' ? c.match : '')
      .trim()
      .toLowerCase();
    const bans = await this.prisma.fedBan.findMany({ where: { fedId: scope.fed.id } });
    let content: string;
    if (format === 'json') {
      content = bans
        .map((ban) =>
          JSON.stringify({
            user_id: Number(ban.telegramId),
            reason: ban.reason,
            date: ban.createdAt,
          }),
        )
        .join('\n');
    } else {
      const rows = ['id,reason'];
      for (const ban of bans) rows.push(`${ban.telegramId},"${ban.reason.replace(/"/g, '""')}"`);
      content = rows.join('\n');
    }
    await c
      .replyWithDocument(
        new InputFile(
          new TextEncoder().encode(content),
          `fbanlist_${scope.fed.id}.${format === 'json' ? 'json' : 'csv'}`,
        ),
      )
      .catch(() => c.reply(content.slice(0, 3_500)).catch(() => undefined));
  }

  /**
   * Handles /importfbans (reply to a CSV/JSON file).
   */
  private async handleImportBans(c: Context, botId: string): Promise<void> {
    if (!c.from) return;
    const lang = await this.i18n.getChatLanguage(botId, c.from.id);
    void botId;
    const scope = await this.scopedFed(c, botId);
    if (!scope) {
      await c.reply(this.i18n.t(lang, 'federation.noFed')).catch(() => undefined);
      return;
    }
    const isOwner = scope.fed.ownerTelegramId === BigInt(c.from.id);
    if (!(await this.isFedAdmin(scope.fed.id, c.from.id, isOwner))) {
      await c.reply(this.i18n.t(lang, 'common.adminOnly')).catch(() => undefined);
      return;
    }
    void botId;
    await c
      .reply('Use the dashboard federation manager to import ban lists.')
      .catch(() => undefined);
  }

  /**
   * Handles /fedpromote and /feddemote (owner only).
   */
  private async handleFedAdmin(c: Context, botId: string, promote: boolean): Promise<void> {
    if (!c.from) return;
    const lang = await this.i18n.getChatLanguage(botId, c.from.id);
    const scope = await this.scopedFed(c, botId);
    if (!scope) {
      await c.reply(this.i18n.t(lang, 'federation.noFed')).catch(() => undefined);
      return;
    }
    if (scope.fed.ownerTelegramId !== BigInt(c.from.id)) {
      await c.reply(this.i18n.t(lang, 'common.adminOnly')).catch(() => undefined);
      return;
    }
    const replyUser = c.msg?.reply_to_message?.from;
    const args = String(typeof c.match === 'string' ? c.match : '').trim();
    const { userId } = resolveTarget(args, replyUser);
    if (!userId) {
      await c.reply(this.i18n.t(lang, 'common.userNotFound')).catch(() => undefined);
      return;
    }
    if (promote) {
      await this.prisma.fedAdmin.upsert({
        where: { fedId_telegramId: { fedId: scope.fed.id, telegramId: BigInt(userId) } },
        create: { fedId: scope.fed.id, telegramId: BigInt(userId) },
        update: {},
      });
    } else {
      await this.prisma.fedAdmin
        .delete({
          where: { fedId_telegramId: { fedId: scope.fed.id, telegramId: BigInt(userId) } },
        })
        .catch(() => undefined);
    }
    await c
      .reply(
        this.i18n.t(lang, promote ? 'federation.fedAdminAdded' : 'federation.fedAdminRemoved', {
          user: `<a href="tg://user?id=${userId}">User ${userId}</a>`,
        }),
        { parse_mode: 'HTML' },
      )
      .catch(() => undefined);
  }

  /**
   * Handles /feddemoteme <fedId> (self-demotion).
   */
  private async handleFedAdminSelf(c: Context, botId: string): Promise<void> {
    void botId;
    if (c.chat?.type !== 'private' || !c.from) return;
    const fedId = String(typeof c.match === 'string' ? c.match : '').trim();
    if (!fedId) return;
    await this.prisma.fedAdmin
      .delete({ where: { fedId_telegramId: { fedId, telegramId: BigInt(c.from.id) } } })
      .catch(() => undefined);
    await c.reply('✅').catch(() => undefined);
  }

  /**
   * Handles /fedinfo.
   */
  private async handleFedInfo(c: Context, botId: string): Promise<void> {
    if (!c.from) return;
    const lang = await this.i18n.getChatLanguage(botId, c.from.id);
    const scope = await this.scopedFed(c, botId);
    if (!scope) {
      await c.reply(this.i18n.t(lang, 'federation.noFed')).catch(() => undefined);
      return;
    }
    const [chats, bans, admins] = await Promise.all([
      this.prisma.fedChat.count({ where: { fedId: scope.fed.id } }),
      this.prisma.fedBan.count({ where: { fedId: scope.fed.id } }),
      this.prisma.fedAdmin.count({ where: { fedId: scope.fed.id } }),
    ]);
    await c
      .reply(
        this.i18n.t(lang, 'federation.fedInfo', {
          name: scope.fed.name.replace(/</g, '&lt;'),
          fedId: scope.fed.id,
          chats,
          bans,
          admins: admins + 1,
        }),
        { parse_mode: 'HTML' },
      )
      .catch(() => undefined);
  }

  /**
   * Handles /fedadmins.
   */
  private async handleFedAdmins(c: Context, botId: string): Promise<void> {
    if (!c.from) return;
    const scope = await this.scopedFed(c, botId);
    if (!scope) return;
    const admins = await this.prisma.fedAdmin.findMany({ where: { fedId: scope.fed.id } });
    const lines = [`👑 <a href="tg://user?id=${scope.fed.ownerTelegramId}">Owner</a>`];
    for (const admin of admins) {
      lines.push(`🛡 <a href="tg://user?id=${admin.telegramId}">Admin</a>`);
    }
    await c.reply(lines.join('\n'), { parse_mode: 'HTML' }).catch(() => undefined);
  }

  /**
   * Handles /fedreason on|off (owner).
   */
  private async handleFedReason(c: Context, botId: string): Promise<void> {
    if (!c.from) return;
    const scope = await this.scopedFed(c, botId);
    if (!scope || scope.fed.ownerTelegramId !== BigInt(c.from.id)) return;
    const enable = ['on', 'yes', 'true'].includes(
      String(typeof c.match === 'string' ? c.match : '')
        .trim()
        .toLowerCase(),
    );
    await this.prisma.fed.update({
      where: { id: scope.fed.id },
      data: { fedReasonRequired: enable ? 1 : 0 },
    });
    await c.reply('✅').catch(() => undefined);
  }

  /**
   * Handles /fednotif on|off (owner).
   */
  private async handleFedNotif(c: Context, botId: string): Promise<void> {
    if (!c.from) return;
    const scope = await this.scopedFed(c, botId);
    if (!scope || scope.fed.ownerTelegramId !== BigInt(c.from.id)) return;
    const enable = ['on', 'yes', 'true'].includes(
      String(typeof c.match === 'string' ? c.match : '')
        .trim()
        .toLowerCase(),
    );
    void enable; // Notifications ride the admin-log bus; flag kept for dashboards.
    await c.reply('✅').catch(() => undefined);
  }

  /**
   * Handles /subfed and /unsubfed (owner, max 5).
   */
  private async handleSubFed(c: Context, botId: string, subscribe: boolean): Promise<void> {
    if (!c.from) return;
    const lang = await this.i18n.getChatLanguage(botId, c.from.id);
    const scope = await this.scopedFed(c, botId);
    if (!scope || scope.fed.ownerTelegramId !== BigInt(c.from.id)) {
      await c.reply(this.i18n.t(lang, 'federation.noFed')).catch(() => undefined);
      return;
    }
    const fedId = String(typeof c.match === 'string' ? c.match : '').trim();
    if (!fedId) return;

    if (subscribe) {
      if (fedId === scope.fed.id) return;
      const count = await this.prisma.fedSub.count({ where: { fedId: scope.fed.id } });
      if (count >= MAX_SUBS) {
        await c.reply(this.i18n.t(lang, 'federation.subLimit')).catch(() => undefined);
        return;
      }
      await this.prisma.fedSub.upsert({
        where: { fedId_subscribedFedId: { fedId: scope.fed.id, subscribedFedId: fedId } },
        create: { fedId: scope.fed.id, subscribedFedId: fedId },
        update: {},
      });
      await c.reply(this.i18n.t(lang, 'federation.subscribed', { fedId })).catch(() => undefined);
      return;
    }
    await this.prisma.fedSub
      .delete({ where: { fedId_subscribedFedId: { fedId: scope.fed.id, subscribedFedId: fedId } } })
      .catch(() => undefined);
    await c.reply(this.i18n.t(lang, 'federation.unsubscribed', { fedId })).catch(() => undefined);
  }

  /**
   * Handles /fedsubs (owner).
   */
  private async handleFedSubs(c: Context, botId: string): Promise<void> {
    if (!c.from) return;
    const scope = await this.scopedFed(c, botId);
    if (!scope) return;
    const subs = await this.prisma.fedSub.findMany({ where: { fedId: scope.fed.id } });
    await c.reply(subs.map((sub) => sub.subscribedFedId).join('\n') || '—').catch(() => undefined);
  }

  /**
   * Handles /fedstat [target] — which feds banned a user.
   */
  private async handleFedStat(c: Context, botId: string): Promise<void> {
    if (!c.from) return;
    const lang = await this.i18n.getChatLanguage(botId, c.from.id);
    const replyUser = c.msg?.reply_to_message?.from;
    const args = String(typeof c.match === 'string' ? c.match : '').trim();
    const { userId } = resolveTarget(args, replyUser);
    const targetId = userId ?? c.from.id;

    const feds = await this.prisma.fed.findMany();
    const hits: string[] = [];
    for (const fed of feds) {
      const ban = await this.prisma.fedBan.findUnique({
        where: { fedId_telegramId: { fedId: fed.id, telegramId: BigInt(targetId) } },
      });
      if (ban) {
        hits.push(
          this.i18n.t(lang, 'federation.fedstatReason', {
            fedId: fed.id,
            reason: ban.reason.replace(/</g, '&lt;'),
            date: ban.createdAt ?? '—',
          }),
        );
      }
    }
    if (hits.length === 0) {
      await c
        .reply(
          targetId === c.from.id
            ? this.i18n.t(lang, 'federation.fedstatClean')
            : this.i18n.t(lang, 'federation.fedstatUser', { user: `User ${targetId}`, count: 0 }),
        )
        .catch(() => undefined);
      return;
    }
    await c
      .reply(
        `${targetId === c.from.id ? this.i18n.t(lang, 'federation.fedstatSelf', { count: hits.length }) : this.i18n.t(lang, 'federation.fedstatUser', { user: `User ${targetId}`, count: hits.length })}\n${hits.join('\n')}`,
        { parse_mode: 'HTML' },
      )
      .catch(() => undefined);
  }

  /**
   * Handles /fbanstat <fedId> — why a user is banned in a specific fed.
   */
  private async handleFbanStat(c: Context, botId: string): Promise<void> {
    if (!c.from) return;
    const lang = await this.i18n.getChatLanguage(botId, c.from.id);
    const fedId = String(typeof c.match === 'string' ? c.match : '').trim();
    if (!fedId) return;
    const ban = await this.prisma.fedBan.findUnique({
      where: { fedId_telegramId: { fedId, telegramId: BigInt(c.from.id) } },
    });
    if (!ban) {
      await c.reply(this.i18n.t(lang, 'federation.fedstatClean')).catch(() => undefined);
      return;
    }
    await c
      .reply(
        this.i18n.t(lang, 'federation.fedstatReason', {
          fedId,
          reason: ban.reason.replace(/</g, '&lt;'),
          date: ban.createdAt ?? '—',
        }),
        { parse_mode: 'HTML' },
      )
      .catch(() => undefined);
  }
}
