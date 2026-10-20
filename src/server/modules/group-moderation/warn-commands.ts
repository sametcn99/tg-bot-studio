import type { Context } from 'grammy';
import { splitDurationArg, formatDuration } from '../../common/utils/duration.util';
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
 * Handler bundle for the warnings subsystem (/warn family + settings).
 */
export interface WarnHandlers {
  /** /warn, /dwarn, /swarn */
  handleWarn(
    c: Context,
    botId: string,
    options: { delete?: boolean; silent?: boolean },
  ): Promise<void>;
  /** /rmwarn (latest) and /resetwarn (all) */
  handleRemoveWarn(c: Context, botId: string, all: boolean): Promise<void>;
  /** "Remove warn" inline button on warning messages */
  handleRemoveWarnButton(
    c: Context,
    botId: string,
    chatId: number,
    targetId: number,
  ): Promise<void>;
  /** /warns */
  handleListWarns(c: Context, botId: string): Promise<void>;
  /** /setwarnlimit <n> */
  handleSetWarnLimit(c: Context, botId: string): Promise<void>;
  /** /setwarnmode <mode [duration]> */
  handleSetWarnMode(c: Context, botId: string): Promise<void>;
  /** /warntime <duration>|off */
  handleWarnTime(c: Context, botId: string): Promise<void>;
}

/**
 * Builds the warnings handlers as closures over the shared moderation
 * dependencies (extracted from the runtime to keep each command family in
 * its own file).
 * @param {ModerationDeps} deps - Shared service dependencies.
 * @returns {WarnHandlers} Bound handlers.
 */
export function createWarnHandlers(deps: ModerationDeps): WarnHandlers {
  /**
   * Counts a user's unexpired warnings.
   */
  async function countWarns(
    botId: string,
    chatId: number,
    telegramId: number,
    expirySeconds: number,
  ): Promise<number> {
    const cutoff =
      expirySeconds > 0 ? new Date(Date.now() - expirySeconds * 1000).toISOString() : undefined;
    return deps.prisma.chatWarn.count({
      where: {
        botId,
        chatId: String(chatId),
        telegramId: BigInt(telegramId),
        ...(cutoff ? { createdAt: { gte: cutoff } } : {}),
      },
    });
  }

  /**
   * Deletes every warning of a user in a chat.
   */
  async function clearWarns(botId: string, chatId: number, telegramId: number): Promise<void> {
    await deps.prisma.chatWarn.deleteMany({
      where: { botId, chatId: String(chatId), telegramId: BigInt(telegramId) },
    });
  }

  /**
   * Applies the configured punishment when the warn limit is reached.
   */
  async function applyWarnMode(
    c: Context,
    botId: string,
    chatId: number,
    targetId: number,
    warnMode: string,
    warnDuration: number,
  ): Promise<void> {
    const duration = warnDuration > 0 ? warnDuration : undefined;
    switch (warnMode) {
      case 'kick':
        await deps.restrictions.kick(c.api, chatId, targetId);
        break;
      case 'mute':
        await deps.restrictions.mute(c.api, chatId, targetId);
        break;
      case 'tmute':
        await deps.restrictions.mute(c.api, chatId, targetId, duration ?? 3_600);
        break;
      case 'tban':
        await deps.restrictions.ban(c.api, chatId, targetId, duration ?? 86_400);
        break;
      case 'ban':
      default:
        await deps.restrictions.ban(c.api, chatId, targetId);
        break;
    }
    deps.adminLog.emit({
      botId,
      chatId,
      category: 'automated',
      text: `Warn limit reached → ${warnMode} → ${targetId}`,
    });
  }

  return {
    /**
     * Handles /warn, /dwarn, /swarn: records a warning and applies the warn
     * mode once the configured limit is reached.
     */
    async handleWarn(c, botId, options): Promise<void> {
      const group = await groupContext(deps, c, botId);
      if (!group) return;
      const { chatId, lang } = group;
      if (!(await requireCapability(deps, c, botId, chatId, lang, 'restrict'))) return;

      const invocation = parseInvocation(c, false);
      const targetId = await resolveUserId(c, invocation);
      if (!targetId || targetId === c.from!.id) {
        await c.reply(deps.i18n.t(lang, 'common.userNotFound')).catch(() => undefined);
        return;
      }
      if (await deps.adminGate.isAdmin(c.api, chatId, targetId)) {
        await c.reply(deps.i18n.t(lang, 'common.error')).catch(() => undefined);
        return;
      }

      const config = await deps.chatSettings.getEffectiveConfig(botId, chatId, deps.moduleKey);
      const limit = Number(config.warnLimit ?? 3);
      const warnMode = String(config.warnMode ?? 'ban');
      const warnDuration = Number(config.warnDurationSeconds ?? 0);
      const warnTime = Number(config.warnTimeSeconds ?? 0);

      await deps.prisma.chatWarn.create({
        data: {
          botId,
          chatId: String(chatId),
          telegramId: BigInt(targetId),
          reason: invocation.reason || 'No reason given',
          createdAt: new Date().toISOString(),
        },
      });

      if (options.delete || options.silent) {
        if (c.msg?.reply_to_message) {
          await c.api
            .deleteMessage(chatId, c.msg.reply_to_message.message_id)
            .catch(() => undefined);
        }
      }

      const count = await countWarns(botId, chatId, targetId, warnTime);
      deps.adminLog.emit({
        botId,
        chatId,
        category: 'admin',
        text: `${c.from!.first_name} → /warn (${count}/${limit}) → ${targetId}: ${invocation.reason}`,
      });

      if (limit > 0 && count >= limit) {
        await clearWarns(botId, chatId, targetId);
        await applyWarnMode(c, botId, chatId, targetId, warnMode, warnDuration);
        await c
          .reply(
            deps.i18n.t(lang, 'warnings.warnLimitReached', {
              user: await describeUser(c, targetId),
            }),
            {
              parse_mode: 'HTML',
            },
          )
          .catch(() => undefined);
        return;
      }

      if (options.silent) {
        await c.deleteMessage().catch(() => undefined);
        return;
      }

      await c
        .reply(
          deps.i18n.t(lang, 'warnings.warned', {
            user: await describeUser(c, targetId),
            count,
            limit,
            reason: escapeHtml(invocation.reason || ''),
          }),
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: 'Remove warn',
                    callback_data: `gm:rmwarn:${chatId}:${targetId}`,
                  },
                ],
              ],
            },
          },
        )
        .catch(() => undefined);
    },

    /**
     * Handles /rmwarn (latest) and /resetwarn (all).
     */
    async handleRemoveWarn(c, botId, all): Promise<void> {
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
      const config = await deps.chatSettings.getEffectiveConfig(botId, chatId, deps.moduleKey);
      const warnTime = Number(config.warnTimeSeconds ?? 0);

      if (all) {
        await clearWarns(botId, chatId, targetId);
        await c
          .reply(
            deps.i18n.t(lang, 'warnings.warnsReset', { user: await describeUser(c, targetId) }),
            {
              parse_mode: 'HTML',
            },
          )
          .catch(() => undefined);
      } else {
        const latest = await deps.prisma.chatWarn.findFirst({
          where: { botId, chatId: String(chatId), telegramId: BigInt(targetId) },
          orderBy: { createdAt: 'desc' },
        });
        if (latest) {
          await deps.prisma.chatWarn.delete({ where: { id: latest.id } });
        }
        const count = await countWarns(botId, chatId, targetId, warnTime);
        await c
          .reply(
            deps.i18n.t(lang, 'warnings.warnRemoved', {
              user: await describeUser(c, targetId),
              count,
            }),
            {
              parse_mode: 'HTML',
            },
          )
          .catch(() => undefined);
      }
      deps.adminLog.emit({
        botId,
        chatId,
        category: 'admin',
        text: `${c.from!.first_name} → ${all ? '/resetwarn' : '/rmwarn'} → ${targetId}`,
      });
    },

    /**
     * Handles the "Remove warn" inline button on warning messages.
     */
    async handleRemoveWarnButton(c, botId, chatId, targetId): Promise<void> {
      const lang = await deps.i18n.getChatLanguage(botId, chatId);
      if (!c.from || !(await deps.adminGate.hasCapability(c.api, chatId, c.from.id, 'restrict'))) {
        await c
          .answerCallbackQuery({ text: deps.i18n.t(lang, 'common.adminOnly') })
          .catch(() => undefined);
        return;
      }
      const latest = await deps.prisma.chatWarn.findFirst({
        where: { botId, chatId: String(chatId), telegramId: BigInt(targetId) },
        orderBy: { createdAt: 'desc' },
      });
      if (latest) {
        await deps.prisma.chatWarn.delete({ where: { id: latest.id } });
      }
      const config = await deps.chatSettings.getEffectiveConfig(botId, chatId, deps.moduleKey);
      const count = await countWarns(botId, chatId, targetId, Number(config.warnTimeSeconds ?? 0));
      await c
        .answerCallbackQuery({
          text: deps.i18n.t(lang, 'warnings.warnRemoved', { user: '', count }),
        })
        .catch(() => undefined);
      deps.adminLog.emit({
        botId,
        chatId,
        category: 'admin',
        text: `${c.from.first_name} removed a warn via button → ${targetId}`,
      });
    },

    /**
     * Handles /warns — lists a user's active warnings.
     */
    async handleListWarns(c, botId): Promise<void> {
      const group = await groupContext(deps, c, botId);
      if (!group) return;
      const { chatId, lang } = group;
      if (!(await requireCapability(deps, c, botId, chatId, lang, 'restrict'))) return;

      const invocation = parseInvocation(c, false);
      const targetId = (await resolveUserId(c, invocation)) ?? c.from!.id;
      const config = await deps.chatSettings.getEffectiveConfig(botId, chatId, deps.moduleKey);
      const warnTime = Number(config.warnTimeSeconds ?? 0);
      const limit = Number(config.warnLimit ?? 3);
      const count = await countWarns(botId, chatId, targetId, warnTime);

      if (count === 0) {
        await c
          .reply(deps.i18n.t(lang, 'warnings.noWarns', { user: await describeUser(c, targetId) }), {
            parse_mode: 'HTML',
          })
          .catch(() => undefined);
        return;
      }

      const cutoff =
        warnTime > 0 ? new Date(Date.now() - warnTime * 1000).toISOString() : undefined;
      const warns = await deps.prisma.chatWarn.findMany({
        where: {
          botId,
          chatId: String(chatId),
          telegramId: BigInt(targetId),
          ...(cutoff ? { createdAt: { gte: cutoff } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      const lines = warns.map((warn) =>
        deps.i18n.t(lang, 'warnings.warnItem', {
          reason: escapeHtml(warn.reason),
          date: warn.createdAt ?? '',
        }),
      );
      await c
        .reply(
          `${deps.i18n.t(lang, 'warnings.warnList', {
            user: await describeUser(c, targetId),
            count,
            limit,
          })}\n${lines.join('\n')}`,
          { parse_mode: 'HTML' },
        )
        .catch(() => undefined);
    },

    /**
     * Handles /setwarnlimit <n>.
     */
    async handleSetWarnLimit(c, botId): Promise<void> {
      const group = await groupContext(deps, c, botId, { allowUntargeted: true });
      if (!group) return;
      const { chatId, lang } = group;
      if (!(await requireCapability(deps, c, botId, chatId, lang, 'change_info'))) return;
      const value = Number((typeof c.match === 'string' ? c.match : '').trim());
      if (!Number.isFinite(value) || value < 1 || value > 100) {
        await c.reply(deps.i18n.t(lang, 'common.error')).catch(() => undefined);
        return;
      }
      const override = (await deps.chatSettings.getOverride(botId, chatId, deps.moduleKey)) ?? {};
      await deps.chatSettings.setOverride(botId, chatId, deps.moduleKey, {
        ...override,
        warnLimit: value,
      });
      await c
        .reply(deps.i18n.t(lang, 'warnings.warnLimitSet', { limit: value }))
        .catch(() => undefined);
      deps.adminLog.emit({
        botId,
        chatId,
        category: 'settings',
        text: `${c.from!.first_name} set warn limit to ${value}`,
      });
    },

    /**
     * Handles /setwarnmode <kick|ban|tban T|mute|tmute T>.
     */
    async handleSetWarnMode(c, botId): Promise<void> {
      const group = await groupContext(deps, c, botId, { allowUntargeted: true });
      if (!group) return;
      const { chatId, lang } = group;
      if (!(await requireCapability(deps, c, botId, chatId, lang, 'change_info'))) return;

      const args = (typeof c.match === 'string' ? c.match : '').trim();
      const { seconds, rest } = splitDurationArg(args);
      const mode = rest.toLowerCase();

      if (!['kick', 'ban', 'mute', 'tmute', 'tban'].includes(mode)) {
        await c.reply(deps.i18n.t(lang, 'common.error')).catch(() => undefined);
        return;
      }
      if ((mode === 'tban' || mode === 'tmute') && !seconds) {
        await c.reply(deps.i18n.t(lang, 'common.invalidDuration')).catch(() => undefined);
        return;
      }

      const override = (await deps.chatSettings.getOverride(botId, chatId, deps.moduleKey)) ?? {};
      await deps.chatSettings.setOverride(botId, chatId, deps.moduleKey, {
        ...override,
        warnMode: mode,
        warnDurationSeconds: seconds ?? 0,
      });
      await c
        .reply(
          deps.i18n.t(lang, 'warnings.warnModeSet', {
            mode: seconds ? `${mode} ${formatDuration(seconds)}` : mode,
          }),
        )
        .catch(() => undefined);
      deps.adminLog.emit({
        botId,
        chatId,
        category: 'settings',
        text: `${c.from!.first_name} set warn mode to ${mode}`,
      });
    },

    /**
     * Handles /warntime <duration>|off.
     */
    async handleWarnTime(c, botId): Promise<void> {
      const group = await groupContext(deps, c, botId, { allowUntargeted: true });
      if (!group) return;
      const { chatId, lang } = group;
      if (!(await requireCapability(deps, c, botId, chatId, lang, 'change_info'))) return;

      const args = (typeof c.match === 'string' ? c.match : '').trim().toLowerCase();
      const seconds = args === 'off' || args === 'no' ? 0 : (splitDurationArg(args).seconds ?? -1);
      if (seconds < 0) {
        await c.reply(deps.i18n.t(lang, 'common.invalidDuration')).catch(() => undefined);
        return;
      }
      const override = (await deps.chatSettings.getOverride(botId, chatId, deps.moduleKey)) ?? {};
      await deps.chatSettings.setOverride(botId, chatId, deps.moduleKey, {
        ...override,
        warnTimeSeconds: seconds,
      });
      await c
        .reply(
          seconds > 0
            ? deps.i18n.t(lang, 'warnings.warnTimeSet', { duration: formatDuration(seconds) })
            : deps.i18n.t(lang, 'warnings.warnTimeOff'),
        )
        .catch(() => undefined);
    },
  };
}
