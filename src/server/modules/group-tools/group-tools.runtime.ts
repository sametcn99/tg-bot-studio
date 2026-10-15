import { Injectable } from '@nestjs/common';
import type { Context } from 'grammy';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { AdminGateService } from '../../bot-engine/admin-gate.service';
import { AdminLogService } from '../../bot-engine/admin-log.service';
import { BotI18nService, type BotLanguage } from '../../bot-engine/bot-i18n.service';
import { ChatSettingsService } from '../../bot-engine/chat-settings.service';
import { CommandAccessService } from '../../bot-engine/command-access.service';
import {
  displayName,
  escapeHtml,
  resolveTarget,
  userMentionHtml,
} from '../../common/utils/telegram-text.util';

/** the reference bot's disableable command list (mapped onto this bot's commands). */
const DISABLEABLE_COMMANDS = [
  'adminlist',
  'approval',
  'approved',
  'filters',
  'flood',
  'id',
  'info',
  'kickme',
  'locks',
  'locktypes',
  'notes',
  'rules',
  'warns',
  'report',
];

/**
 * Runtime for the Group Admin Tools module: pins (incl. permapin and loud),
 * linked-channel controls, user reports (/report, @admin), admin listing,
 * promote/demote, /id and /info lookups, echo, and per-group command
 * disabling.
 */
@Injectable()
export class GroupToolsRuntime extends BotModuleHandler {
  /** Registry key of the module. */
  readonly moduleKey = 'group-tools';

  /**
   * @param {AdminGateService} adminGate - Telegram permission gate.
   * @param {AdminLogService} adminLog - Admin action log bus.
   * @param {BotI18nService} i18n - Bot-reply localization.
   * @param {ChatSettingsService} chatSettings - Per-chat config layer.
   * @param {CommandAccessService} commandAccess - Disabled-command gate.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly adminGate: AdminGateService,
    private readonly adminLog: AdminLogService,
    private readonly i18n: BotI18nService,
    private readonly chatSettings: ChatSettingsService,
    private readonly commandAccess: CommandAccessService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches the tools commands and linked-channel middleware.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot, botId } = ctx;

    // --- Pins -------------------------------------------------------------
    bot.command('pin', (c) => this.handlePin(c, botId));
    bot.command('permapin', (c) => this.handlePermapin(c, botId));
    bot.command('unpin', (c) => this.handleUnpin(c, botId, false));
    bot.command('unpinall', (c) => this.handleUnpin(c, botId, true));

    // --- Linked channel ---------------------------------------------------
    bot.command('antichannelpin', (c) => this.handleToggleSetting(c, botId, 'antichannelPins'));
    bot.command('cleanlinked', (c) => this.handleToggleSetting(c, botId, 'cleanLinked'));
    bot.on('message', (c) => this.handleLinkedChannelPost(c, botId));

    // --- Reports ----------------------------------------------------------
    bot.command('report', (c) => this.handleReport(c, botId));
    bot.command('reports', (c) => this.handleReportsToggle(c, botId));
    // @admin text trigger (reply-based).
    bot.on('message:text', (c) => this.handleAdminMention(c, botId));

    // --- Admin tooling ----------------------------------------------------
    bot.command('adminlist', (c) => this.handleAdminList(c, botId));
    bot.command('promote', (c) => this.handlePromote(c, botId, true));
    bot.command('demote', (c) => this.handlePromote(c, botId, false));
    bot.command('anonadmin', (c) => this.handleToggleSetting(c, botId, 'anonAdmin'));

    // --- Lookups & echo ---------------------------------------------------
    bot.command('id', (c) => this.handleId(c, botId));
    bot.command('info', (c) => this.handleInfo(c, botId));
    bot.command('echo', (c) => this.handleEcho(c, botId));
    bot.command('say', (c) => this.handleEcho(c, botId));

    // --- Command disabling ------------------------------------------------
    bot.command('disable', (c) => this.handleDisable(c, botId, true));
    bot.command('enable', (c) => this.handleDisable(c, botId, false));
    bot.command('disabled', (c) => this.handleDisabledList(c, botId));
    bot.command('disableable', (c) => this.handleDisableableList(c, botId));
    bot.command('disabledel', (c) => this.handleDisabledDel(c, botId));
    bot.command('disableadmin', (c) => this.handleDisableAdmin(c, botId));
  }

  /**
   * Shared group + language + disabled-command guard.
   *
   * @param {Context} c - grammY command context.
   * @param {number} botId - Studio bot id.
   * @param {string} command - Bare command name for the disable gate.
   * @returns {Promise<{ chatId: number; lang: BotLanguage } | null>} Null when blocked.
   */
  private async guard(
    c: Context,
    botId: number,
    command: string,
  ): Promise<{ chatId: number; lang: BotLanguage } | null> {
    if (c.chat?.type !== 'supergroup' && c.chat?.type !== 'group') return null;
    if (!c.from) return null;
    const chatId = c.chat.id;
    // Bot-to-bot gate mirrors group-moderation.
    if (c.from.is_bot) {
      const b2b = await this.chatSettings.getEffectiveConfig(botId, chatId, 'bot2bot');
      const mode = String(b2b.mode ?? 'off');
      if (mode === 'off') return null;
      if (mode === 'admin' && !(await this.adminGate.isAdmin(c.api, chatId, c.from.id))) {
        return null;
      }
    }
    const allowed = await this.commandAccess.isCommandAllowed(
      c.api,
      botId,
      chatId,
      c.from.id,
      command,
      { delete: () => c.deleteMessage() },
    );
    if (!allowed) return null;
    const lang = await this.i18n.getChatLanguage(botId, chatId);
    return { chatId, lang };
  }

  /**
   * Capability check replying localized errors.
   */
  private async require(
    c: Context,
    botId: number,
    chatId: number,
    lang: BotLanguage,
    capability: Parameters<AdminGateService['hasCapability']>[3],
  ): Promise<boolean> {
    const allowed = await this.adminGate.hasCapability(c.api, chatId, c.from!.id, capability);
    if (allowed) return true;
    const config = await this.chatSettings.getEffectiveConfig(botId, chatId, 'group-moderation');
    if (config.adminError !== false) {
      const isAdmin = await this.adminGate.isAdmin(c.api, chatId, c.from!.id);
      await c
        .reply(this.i18n.t(lang, isAdmin ? 'common.missingPermission' : 'common.adminOnly'))
        .catch(() => undefined);
    }
    return false;
  }

  /**
   * Handles /pin [loud] — pins the replied message.
   */
  private async handlePin(c: Context, botId: number): Promise<void> {
    const group = await this.guard(c, botId, 'pin');
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.require(c, botId, chatId, lang, 'pin'))) return;
    const replied = c.msg?.reply_to_message;
    if (!replied) return;
    const loud = String(typeof c.match === 'string' ? c.match : '')
      .trim()
      .toLowerCase();
    const ok = await c.api.pinChatMessage(chatId, replied.message_id, {
      disable_notification: loud !== 'loud',
    });
    if (ok) {
      await c.reply(this.i18n.t(lang, 'pins.pinned')).catch(() => undefined);
      this.adminLog.emit({
        botId,
        chatId,
        category: 'admin',
        text: `${c.from!.first_name} pinned a message`,
      });
    }
  }

  /**
   * Handles /permapin <text> — sends then pins a bot message.
   */
  private async handlePermapin(c: Context, botId: number): Promise<void> {
    const group = await this.guard(c, botId, 'permapin');
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.require(c, botId, chatId, lang, 'pin'))) return;
    const text = String(typeof c.match === 'string' ? c.match : '').trim();
    if (!text) return;
    const sent = await c.api
      .sendMessage(chatId, text, { parse_mode: 'HTML' })
      .catch(() => null);
    if (!sent) return;
    await c.api.pinChatMessage(chatId, sent.message_id, { disable_notification: true });
    this.adminLog.emit({
      botId,
      chatId,
      category: 'admin',
      text: `${c.from!.first_name} permapinned: ${text.slice(0, 80)}`,
    });
  }

  /**
   * Handles /unpin and /unpinall.
   */
  private async handleUnpin(c: Context, botId: number, all: boolean): Promise<void> {
    const group = await this.guard(c, botId, all ? 'unpinall' : 'unpin');
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.require(c, botId, chatId, lang, 'pin'))) return;
    const ok = all
      ? await c.api.unpinAllChatMessages(chatId).catch(() => false)
      : await c.api.unpinChatMessage(chatId).catch(() => false);
    if (ok) {
      await c.reply(this.i18n.t(lang, all ? 'pins.unpinnedAll' : 'pins.unpinned')).catch(
        () => undefined,
      );
    }
  }

  /**
   * Handles /antichannelpin and /cleanlinked (plus /anonadmin) toggles.
   */
  private async handleToggleSetting(c: Context, botId: number, field: string): Promise<void> {
    const group = await this.guard(c, botId, field);
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.require(c, botId, chatId, lang, 'change_info'))) return;

    const args = String(typeof c.match === 'string' ? c.match : '')
      .trim()
      .toLowerCase();
    const enable = ['on', 'yes', 'true'].includes(args);
    const disable = ['off', 'no', 'false'].includes(args);
    if (!enable && !disable) {
      await c.reply(this.i18n.t(lang, 'common.error')).catch(() => undefined);
      return;
    }
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      [field]: enable,
    });
    await c.reply(this.i18n.t(lang, 'common.done')).catch(() => undefined);
    this.adminLog.emit({
      botId,
      chatId,
      category: 'settings',
      text: `${c.from!.first_name} set ${field} to ${enable ? 'on' : 'off'}`,
    });
  }

  /**
   * Middleware for linked-channel posts: unpins auto-pinned posts when
   * antichannelpin is on, deletes them entirely when cleanlinked is on.
   */
  private async handleLinkedChannelPost(c: Context, botId: number): Promise<void> {
    if (!c.chat || (c.chat.type !== 'supergroup' && c.chat.type !== 'group')) return;
    if (!c.msg?.sender_chat || c.msg.sender_chat.id === c.chat.id) return; // anonymous admin
    const config = await this.chatSettings.getEffectiveConfig(botId, c.chat.id, this.moduleKey);
    if (config.cleanLinked === true) {
      await c.deleteMessage().catch(() => undefined);
      return;
    }
    if (config.antichannelPins === true) {
      // Best effort: channel posts arrive already pinned by Telegram.
      await c.api.unpinChatMessage(c.chat.id).catch(() => undefined);
    }
  }

  /**
   * Handles /report — notifies all admins about the replied message.
   */
  private async handleReport(c: Context, botId: number): Promise<void> {
    const group = await this.guard(c, botId, 'report');
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.adminGate.isAdmin(c.api, chatId, c.from!.id))) {
      await this.notifyAdmins(c, botId, chatId, lang);
      return; // admins cannot report (reference parity) — but still notify? No: ignore.
    }
  }

  /**
   * Notifies admins with invisible mentions of the reported message.
   */
  private async notifyAdmins(
    c: Context,
    botId: number,
    chatId: number,
    lang: BotLanguage,
  ): Promise<void> {
    const admins = await this.adminGate.getAdmins(c.api, chatId);
    const mentions = admins
      .filter((admin) => admin.status === 'administrator' || admin.status === 'creator')
      .filter((admin) => !admin.user.is_bot && !('is_anonymous' in admin && admin.is_anonymous))
      .map((admin) =>
        admin.user.username
          ? `@${admin.user.username}`
          : `<a href="tg://user?id=${admin.user.id}">&#8203;</a>`,
      )
      .join(' ');
    const reporter = userMentionHtml(c.from!);
    const reported = c.msg?.reply_to_message?.from
      ? userMentionHtml(c.msg.reply_to_message.from)
      : '?';
    await c
      .reply(`${this.i18n.t(lang, 'reports.reported')} ${mentions}\n${reporter} → ${reported}`, {
        parse_mode: 'HTML',
      })
      .catch(() => undefined);
    this.adminLog.emit({
      botId,
      chatId,
      category: 'reports',
      text: `${c.from!.first_name} reported ${reported}`,
    });
  }

  /**
   * Handles /reports on|off.
   */
  private async handleReportsToggle(c: Context, botId: number): Promise<void> {
    const group = await this.guard(c, botId, 'reports');
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.require(c, botId, chatId, lang, 'change_info'))) return;
    const args = String(typeof c.match === 'string' ? c.match : '')
      .trim()
      .toLowerCase();
    const enable = ['on', 'yes', 'true'].includes(args);
    const disable = ['off', 'no', 'false'].includes(args);
    if (!enable && !disable) {
      await c.reply(this.i18n.t(lang, 'common.error')).catch(() => undefined);
      return;
    }
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      reportsEnabled: enable,
    });
    await c.reply(this.i18n.t(lang, enable ? 'reports.reportsOn' : 'reports.reportsOff')).catch(
      () => undefined,
    );
  }

  /**
   * Handles the @admin trigger in reply to a message.
   */
  private async handleAdminMention(c: Context, botId: number): Promise<void> {
    if (!c.chat || (c.chat.type !== 'supergroup' && c.chat.type !== 'group')) return;
    if (!c.msg?.reply_to_message) return;
    if (!c.msg.text?.trim().toLowerCase().startsWith('@admin')) return;
    const config = await this.chatSettings.getEffectiveConfig(botId, c.chat.id, this.moduleKey);
    if (config.reportsEnabled === false) return;
    if (await this.adminGate.isAdmin(c.api, c.chat.id, c.from!.id)) return;
    const lang = await this.i18n.getChatLanguage(botId, c.chat.id);
    await this.notifyAdmins(c, botId, c.chat.id, lang);
  }

  /**
   * Handles /adminlist.
   */
  private async handleAdminList(c: Context, botId: number): Promise<void> {
    const group = await this.guard(c, botId, 'adminlist');
    if (!group) return;
    const { chatId } = group;
    const admins = await this.adminGate.getAdmins(c.api, chatId);
    const lines = admins.map((admin) => {
      const badge = admin.status === 'creator' ? '👑' : '🛡';
      const name = escapeHtml(displayName(admin.user));
      const handle = admin.user.username ? ` (@${admin.user.username})` : '';
      return `${badge} ${name}${handle}${'is_anonymous' in admin && admin.is_anonymous ? ' 🕶' : ''}`;
    });
    await c.reply(lines.join('\n') || '—', { parse_mode: 'HTML' }).catch(() => undefined);
  }

  /**
   * Handles /promote and /demote (intersection privileges, reference model).
   */
  private async handlePromote(c: Context, botId: number, promote: boolean): Promise<void> {
    const group = await this.guard(c, botId, promote ? 'promote' : 'demote');
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.require(c, botId, chatId, lang, 'promote'))) return;

    const replyUser = c.msg?.reply_to_message?.from;
    const args = String(typeof c.match === 'string' ? c.match : '').trim();
    const { userId, username, rest } = resolveTarget(args, replyUser);
    let targetId = userId ?? null;
    if (!targetId && username) {
      const chat = await c.api.getChat(`@${username}`).catch(() => null);
      if (chat && chat.type === 'private') targetId = Number(chat.id);
    }
    if (!targetId) {
      await c.reply(this.i18n.t(lang, 'common.userNotFound')).catch(() => undefined);
      return;
    }
    void rest;

    const privileges = promote
      ? {
          can_manage_chat: true,
          can_delete_messages: true,
          can_manage_video_chats: true,
          can_restrict_members: true,
          can_change_info: true,
          can_invite_users: true,
          can_pin_messages: true,
          can_manage_topics: true,
          can_promote_members: false, // never cascade promotion rights
        }
      : {};
    const ok = await c.api.promoteChatMember(chatId, targetId, privileges).catch(() => false);
    if (ok) {
      await c.reply(this.i18n.t(lang, 'common.done')).catch(() => undefined);
      this.adminLog.emit({
        botId,
        chatId,
        category: 'admin',
        text: `${c.from!.first_name} ${promote ? 'promoted' : 'demoted'} ${targetId}`,
      });
    }
  }

  /**
   * Handles /id [target].
   */
  private async handleId(c: Context, botId: number): Promise<void> {
    const group = await this.guard(c, botId, 'id');
    if (!group) return;
    const { chatId, lang } = group;
    const args = String(typeof c.match === 'string' ? c.match : '').trim();
    const replyUser = c.msg?.reply_to_message?.from;
    const { userId } = resolveTarget(args, replyUser);
    if (userId) {
      await c
        .reply(this.i18n.t(lang, 'info.userId', { id: userId }), { parse_mode: 'HTML' })
        .catch(() => undefined);
    } else {
      await c
        .reply(this.i18n.t(lang, 'info.chatId', { id: chatId }), { parse_mode: 'HTML' })
        .catch(() => undefined);
    }
  }

  /**
   * Handles /info [target] — user profile snapshot.
   */
  private async handleInfo(c: Context, botId: number): Promise<void> {
    const group = await this.guard(c, botId, 'info');
    if (!group) return;
    const { chatId, lang } = group;
    const args = String(typeof c.match === 'string' ? c.match : '').trim();
    const replyUser = c.msg?.reply_to_message?.from;
    const { userId, username } = resolveTarget(args, replyUser);
    let targetId = userId ?? c.from!.id;
    if (!userId && username) {
      const chat = await c.api.getChat(`@${username}`).catch(() => null);
      if (chat && chat.type === 'private') targetId = Number(chat.id);
    }

    const member = await c.api.getChatMember(chatId, targetId).catch(() => null);
    const name = escapeHtml(member ? displayName(member.user) : `User ${targetId}`);
    const handle = member?.user.username ? `@${member.user.username}` : '—';
    const isMember = member
      ? ['member', 'administrator', 'creator', 'restricted'].includes(member.status)
      : false;
    await c
      .reply(
        this.i18n.t(lang, 'info.userInfo', {
          name,
          id: targetId,
          username: handle,
          member: isMember ? '✓' : '✗',
        }),
        { parse_mode: 'HTML' },
      )
      .catch(() => undefined);
  }

  /**
   * Handles /echo and /say — repeats text as the bot (admin only).
   */
  private async handleEcho(c: Context, botId: number): Promise<void> {
    const group = await this.guard(c, botId, 'echo');
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.require(c, botId, chatId, lang, 'change_info'))) return;
    const text = String(typeof c.match === 'string' ? c.match : '').trim();
    if (!text) return;
    await c.deleteMessage().catch(() => undefined);
    await c.api.sendMessage(chatId, text, { parse_mode: 'HTML' }).catch(() => undefined);
  }

  /**
   * Handles /disable and /enable.
   */
  private async handleDisable(c: Context, botId: number, disable: boolean): Promise<void> {
    const group = await this.guard(c, botId, disable ? 'disable' : 'enable');
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.require(c, botId, chatId, lang, 'change_info'))) return;

    const command = String(typeof c.match === 'string' ? c.match : '')
      .trim()
      .replace(/^\//, '')
      .toLowerCase();
    if (!DISABLEABLE_COMMANDS.includes(command)) {
      await c.reply(this.i18n.t(lang, 'disable.notDisableable')).catch(() => undefined);
      return;
    }
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    const current = Array.isArray(override.disabledCommands)
      ? [...(override.disabledCommands as string[])]
      : [];
    const next = disable
      ? [...new Set([...current, command])]
      : current.filter((item) => item !== command);
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      disabledCommands: next,
    });
    await c
      .reply(this.i18n.t(lang, disable ? 'disable.disabled' : 'disable.enabled', { command }))
      .catch(() => undefined);
    this.adminLog.emit({
      botId,
      chatId,
      category: 'settings',
      text: `${c.from!.first_name} ${disable ? 'disabled' : 'enabled'} /${command}`,
    });
  }

  /**
   * Handles /disabled — lists disabled commands.
   */
  private async handleDisabledList(c: Context, botId: number): Promise<void> {
    const group = await this.guard(c, botId, 'disabled');
    if (!group) return;
    const { chatId, lang } = group;
    const config = await this.chatSettings.getEffectiveConfig(botId, chatId, this.moduleKey);
    const disabled = Array.isArray(config.disabledCommands)
      ? (config.disabledCommands as string[])
      : [];
    await c
      .reply(
        disabled.length > 0
          ? this.i18n.t(lang, 'disable.listTitle', { list: disabled.map((d) => `/${d}`).join(', ') })
          : this.i18n.t(lang, 'disable.none'),
      )
      .catch(() => undefined);
  }

  /**
   * Handles /disableable — lists disableable commands.
   */
  private async handleDisableableList(c: Context, botId: number): Promise<void> {
    const group = await this.guard(c, botId, 'disableable');
    if (!group) return;
    await c.reply(DISABLEABLE_COMMANDS.map((command) => `/${command}`).join(', ')).catch(
      () => undefined,
    );
  }

  /**
   * Handles /disabledel on|off.
   */
  private async handleDisabledDel(c: Context, botId: number): Promise<void> {
    const group = await this.guard(c, botId, 'disabledel');
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.require(c, botId, chatId, lang, 'change_info'))) return;
    const enable = ['on', 'yes', 'true'].includes(
      String(typeof c.match === 'string' ? c.match : '').trim().toLowerCase(),
    );
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      disabledDelete: enable,
    });
    await c.reply(this.i18n.t(lang, 'common.done')).catch(() => undefined);
  }

  /**
   * Handles /disableadmin on|off.
   */
  private async handleDisableAdmin(c: Context, botId: number): Promise<void> {
    const group = await this.guard(c, botId, 'disableadmin');
    if (!group) return;
    const { chatId, lang } = group;
    if (!(await this.require(c, botId, chatId, lang, 'change_info'))) return;
    const enable = ['on', 'yes', 'true'].includes(
      String(typeof c.match === 'string' ? c.match : '').trim().toLowerCase(),
    );
    const override = (await this.chatSettings.getOverride(botId, chatId, this.moduleKey)) ?? {};
    await this.chatSettings.setOverride(botId, chatId, this.moduleKey, {
      ...override,
      disableAdmin: enable,
    });
    await c.reply(this.i18n.t(lang, 'common.done')).catch(() => undefined);
  }
}
