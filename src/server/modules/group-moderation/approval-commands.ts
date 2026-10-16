import type { Context } from 'grammy';
import { escapeHtml } from '../../common/utils/telegram-text.util';
import {
  describeUser,
  groupContext,
  parseInvocation,
  requireCapability,
  resolveUserId,
  type ModerationDeps,
} from './moderation.helpers';

/**
 * Handler bundle for the reference-style approvals subsystem.
 */
export interface ApprovalHandlers {
  /** /approve <target> [reason] */
  handleApprove(c: Context, botId: number): Promise<void>;
  /** /unapprove <target> */
  handleUnapprove(c: Context, botId: number): Promise<void>;
  /** /approval <target> */
  handleApprovalStatus(c: Context, botId: number): Promise<void>;
  /** /approved */
  handleApprovedList(c: Context, botId: number): Promise<void>;
  /** /unapproveall — owner only */
  handleUnapproveAll(c: Context, botId: number): Promise<void>;
}

/**
 * Builds the approval handlers as closures over the shared moderation
 * dependencies (extracted from the runtime to keep each command family in
 * its own file).
 * @param {ModerationDeps} deps - Shared service dependencies.
 * @returns {ApprovalHandlers} Bound handlers.
 */
export function createApprovalHandlers(deps: ModerationDeps): ApprovalHandlers {
  return {
    /**
     * Handles /approve <target> [reason].
     */
    async handleApprove(c, botId): Promise<void> {
      const group = await groupContext(deps, c, botId);
      if (!group) return;
      const { chatId, lang } = group;
      if (!(await requireCapability(deps, c, botId, chatId, lang, 'restrict'))) return;

      const invocation = parseInvocation(c, false);
      const targetId = await resolveUserId(c, invocation);
      if (!targetId) {
        await c.reply(deps.i18n.t(lang, 'common.userNotFound')).catch(() => undefined);
        return;
      }
      await deps.prisma.chatApproval.upsert({
        where: {
          botId_chatId_telegramId: {
            botId,
            chatId: String(chatId),
            telegramId: BigInt(targetId),
          },
        },
        create: {
          botId,
          chatId: String(chatId),
          telegramId: BigInt(targetId),
          reason: invocation.reason || null,
          approvedAt: new Date().toISOString(),
        },
        update: { reason: invocation.reason || null },
      });
      await c
        .reply(deps.i18n.t(lang, 'approvals.approved', { user: await describeUser(c, targetId) }), {
          parse_mode: 'HTML',
        })
        .catch(() => undefined);
      deps.adminLog.emit({
        botId,
        chatId,
        category: 'admin',
        text: `${c.from!.first_name} approved ${targetId}`,
      });
    },

    /**
     * Handles /unapprove <target>.
     */
    async handleUnapprove(c, botId): Promise<void> {
      const group = await groupContext(deps, c, botId);
      if (!group) return;
      const { chatId, lang } = group;
      if (!(await requireCapability(deps, c, botId, chatId, lang, 'restrict'))) return;

      const invocation = parseInvocation(c, false);
      const targetId = await resolveUserId(c, invocation);
      if (!targetId) {
        await c.reply(deps.i18n.t(lang, 'common.userNotFound')).catch(() => undefined);
        return;
      }
      const removed = await deps.prisma.chatApproval
        .delete({
          where: {
            botId_chatId_telegramId: {
              botId,
              chatId: String(chatId),
              telegramId: BigInt(targetId),
            },
          },
        })
        .then(() => true)
        .catch(() => false);
      if (removed) {
        await c
          .reply(
            deps.i18n.t(lang, 'approvals.unapproved', {
              user: await describeUser(c, targetId),
            }),
            {
              parse_mode: 'HTML',
            },
          )
          .catch(() => undefined);
      }
    },

    /**
     * Handles /approval <target> — checks approval status.
     */
    async handleApprovalStatus(c, botId): Promise<void> {
      const group = await groupContext(deps, c, botId);
      if (!group) return;
      const { chatId, lang } = group;
      if (!(await requireCapability(deps, c, botId, chatId, lang, 'restrict'))) return;

      const invocation = parseInvocation(c, false);
      const targetId = await resolveUserId(c, invocation);
      if (!targetId) {
        await c.reply(deps.i18n.t(lang, 'common.userNotFound')).catch(() => undefined);
        return;
      }
      const row = await deps.prisma.chatApproval.findUnique({
        where: {
          botId_chatId_telegramId: {
            botId,
            chatId: String(chatId),
            telegramId: BigInt(targetId),
          },
        },
      });
      await c
        .reply(
          row
            ? deps.i18n.t(lang, 'approvals.isApproved', {
                user: await describeUser(c, targetId),
                reason: escapeHtml(row.reason ?? ''),
              })
            : deps.i18n.t(lang, 'approvals.notApproved', {
                user: await describeUser(c, targetId),
              }),
          { parse_mode: 'HTML' },
        )
        .catch(() => undefined);
    },

    /**
     * Handles /approved — lists approved users.
     */
    async handleApprovedList(c, botId): Promise<void> {
      const group = await groupContext(deps, c, botId);
      if (!group) return;
      const { chatId, lang } = group;
      if (!(await requireCapability(deps, c, botId, chatId, lang, 'restrict'))) return;

      const rows = await deps.prisma.chatApproval.findMany({
        where: { botId, chatId: String(chatId) },
        orderBy: { telegramId: 'asc' },
        take: 100,
      });
      if (rows.length === 0) {
        await c.reply(deps.i18n.t(lang, 'approvals.approvalEmpty')).catch(() => undefined);
        return;
      }
      const lines = rows.map(
        (row) =>
          `• <a href="tg://user?id=${row.telegramId}">${row.telegramId}</a>${row.reason ? ` — ${escapeHtml(row.reason)}` : ''}`,
      );
      await c
        .reply(
          `${deps.i18n.t(lang, 'approvals.approvedList', { count: rows.length })}\n${lines.join('\n')}`,
          {
            parse_mode: 'HTML',
          },
        )
        .catch(() => undefined);
    },

    /**
     * Handles /unapproveall — owner only.
     */
    async handleUnapproveAll(c, botId): Promise<void> {
      const group = await groupContext(deps, c, botId);
      if (!group) return;
      const { chatId, lang } = group;
      if (!(await deps.adminGate.isOwner(c.api, chatId, c.from!.id))) {
        await c.reply(deps.i18n.t(lang, 'common.adminOnly')).catch(() => undefined);
        return;
      }
      await deps.prisma.chatApproval.deleteMany({ where: { botId, chatId: String(chatId) } });
      await c.reply(deps.i18n.t(lang, 'approvals.approvedAllCleared')).catch(() => undefined);
      deps.adminLog.emit({
        botId,
        chatId,
        category: 'settings',
        text: `${c.from!.first_name} cleared all approvals`,
      });
    },
  };
}
