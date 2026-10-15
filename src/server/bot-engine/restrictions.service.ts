import { Injectable } from '@nestjs/common';
import type { Api } from 'grammy';
import type { ChatPermissions } from 'grammy/types';

/** Fully-restricting permission set used for mutes. */
const MUTED_PERMISSIONS: ChatPermissions = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
  can_change_info: false,
  can_invite_users: false,
  can_pin_messages: false,
  can_manage_topics: false,
};

/** Telegram caps until_date at ~1 year; 0 means "forever". */
const FOREVER = 0;

/** Cache entry for a chat's default permissions (used to lift mutes). */
interface DefaultPermissionsCache {
  permissions: ChatPermissions;
  cachedAt: number;
}

/**
 * Shared restriction executor for every moderation surface (manual commands,
 * locks, blocklists, flood, anti-raid). Centralizes ban/unban/kick/mute so
 * every caller applies identical semantics and error tolerance.
 */
@Injectable()
export class RestrictionsService {
  private readonly defaultPermissions = new Map<string, DefaultPermissionsCache>();

  /**
   * Bans a member, optionally temporarily.
   *
   * @param {Api} api - grammY API handle of the bot.
   * @param {number} chatId - Target chat id.
   * @param {number} userId - Member to ban.
   * @param {number} untilSeconds - Duration in seconds; 0 = permanent.
   * @returns {Promise<boolean>} True on success.
   */
  async ban(api: Api, chatId: number, userId: number, untilSeconds = 0): Promise<boolean> {
    const untilDate = untilSeconds > 0 ? Math.floor(Date.now() / 1000) + untilSeconds : FOREVER;
    return api
      .banChatMember(chatId, userId, { until_date: untilDate })
      .then(() => true)
      .catch(() => false);
  }

  /**
   * Lifts a ban (keeps the user flagged as banned in Telegram's cache).
   *
   * @param {Api} api - grammY API handle of the bot.
   * @param {number} chatId - Target chat id.
   * @param {number} userId - Member to unban.
   * @returns {Promise<boolean>} True on success.
   */
  async unban(api: Api, chatId: number, userId: number): Promise<boolean> {
    return api
      .unbanChatMember(chatId, userId, { only_if_banned: true })
      .then(() => true)
      .catch(() => false);
  }

  /**
   * Kicks a member: ban + immediate unban so they may rejoin.
   *
   * @param {Api} api - grammY API handle of the bot.
   * @param {number} chatId - Target chat id.
   * @param {number} userId - Member to kick.
   * @returns {Promise<boolean>} True on success.
   */
  async kick(api: Api, chatId: number, userId: number): Promise<boolean> {
    const banned = await this.ban(api, chatId, userId);
    if (!banned) return false;
    return this.unban(api, chatId, userId);
  }

  /**
   * Mutes (read-only) a member, optionally temporarily.
   *
   * @param {Api} api - grammY API handle of the bot.
   * @param {number} chatId - Target chat id.
   * @param {number} userId - Member to mute.
   * @param {number} untilSeconds - Duration in seconds; 0 = until unmuted.
   * @returns {Promise<boolean>} True on success.
   */
  async mute(api: Api, chatId: number, userId: number, untilSeconds = 0): Promise<boolean> {
    const untilDate = untilSeconds > 0 ? Math.floor(Date.now() / 1000) + untilSeconds : FOREVER;
    return api
      .restrictChatMember(chatId, userId, MUTED_PERMISSIONS, { until_date: untilDate })
      .then(() => true)
      .catch(() => false);
  }

  /**
   * Lifts a mute by restoring the chat's own default member permissions
   * (cached briefly), so unmuted members get exactly the chat baseline.
   *
   * @param {Api} api - grammY API handle of the bot.
   * @param {number} chatId - Target chat id.
   * @param {number} userId - Member to unmute.
   * @returns {Promise<boolean>} True on success.
   */
  async unmute(api: Api, chatId: number, userId: number): Promise<boolean> {
    const permissions = await this.getChatDefaults(api, chatId);
    return api
      .restrictChatMember(chatId, userId, permissions, { until_date: FOREVER })
      .then(() => true)
      .catch(() => false);
  }

  /**
   * Fetches (and caches) a chat's default member permissions, loosened for
   * sending so an unmute never leaves the user restricted below baseline.
   *
   * @param {Api} api - grammY API handle of the bot.
   * @param {number} chatId - Target chat id.
   * @returns {Promise<ChatPermissions>} Permissions to restore on unmute.
   */
  private async getChatDefaults(api: Api, chatId: number): Promise<ChatPermissions> {
    const key = String(chatId);
    const cached = this.defaultPermissions.get(key);
    if (cached && Date.now() - cached.cachedAt < 5 * 60_000) {
      return cached.permissions;
    }
    const chat = await api.getChat(chatId).catch(() => null);
    const base: ChatPermissions = (chat && 'permissions' in chat
      ? { ...(chat.permissions as ChatPermissions) }
      : {}) as ChatPermissions;
    const permissions: ChatPermissions = {
      ...base,
      can_send_messages: true,
      can_send_audios: true,
      can_send_documents: true,
      can_send_photos: true,
      can_send_videos: true,
      can_send_video_notes: true,
      can_send_voice_notes: true,
      can_send_other_messages: true,
      can_add_web_page_previews: true,
    };
    this.defaultPermissions.set(key, { permissions, cachedAt: Date.now() });
    return permissions;
  }
}
