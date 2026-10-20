import { Injectable } from '@nestjs/common';
import type { Api } from 'grammy';
import type { ChatMember } from 'grammy/types';
import { GROUP_ANONYMOUS_BOT_ID, CHANNEL_BOT_ID } from '../common/utils/telegram-text.util';

/** Admin capabilities mapped from native Telegram permissions (reference model). */
export type AdminCapability =
  | 'restrict' // ban / mute / kick
  | 'delete' // del / purge
  | 'pin' // pin family
  | 'change_info' // settings (welcome, blocklists, rules, ...)
  | 'promote' // promote / demote
  | 'manage_topics'; // topic commands

/** Cached admin snapshot for one chat. */
interface ChatAdminCache {
  members: ChatMember[];
  /** Admins keyed by Telegram user id. */
  byId: Map<number, ChatMember>;
  cachedAt: number;
}

/** How long a chat's admin list stays cached before refresh (ms). */
const ADMIN_CACHE_TTL_MS = 10 * 60_000;

/**
 * Telegram-native admin permission gate shared by every in-group command
 * module. Mirrors the reference bot's rule that bots never grant permissions beyond what
 * Telegram itself gave the admin. Includes a periodic admin cache (refreshed
 * via /admincache) and anonymous-admin handling.
 */
@Injectable()
export class AdminGateService {
  private readonly cache = new Map<string, ChatAdminCache>();

  /**
   * Resolves whether a user id denotes an anonymous admin sender (the group's
   * anonymous bot or a channel-linked sender).
   *
   * @param {number} userId - Sender id from the update.
   * @param {number} chatId - Target chat id.
   * @returns {boolean} True when the sender acts as the anonymous group admin.
   */
  isAnonymousAdmin(userId: number, chatId: number): boolean {
    return userId === GROUP_ANONYMOUS_BOT_ID || userId === CHANNEL_BOT_ID || userId === chatId;
  }

  /**
   * Fetches (and caches) the admin list of a chat.
   *
   * @param {Api} api - grammY API handle of the live bot.
   * @param {number} chatId - Target chat id.
   * @param {boolean} force - Bypass the cache and refresh immediately.
   * @returns {Promise<ChatMember[]>} Current administrators of the chat.
   */
  async getAdmins(api: Api, chatId: number, force = false): Promise<ChatMember[]> {
    const key = String(chatId);
    const cached = this.cache.get(key);
    if (!force && cached && Date.now() - cached.cachedAt < ADMIN_CACHE_TTL_MS) {
      return cached.members;
    }
    const raw = await api.getChatAdministrators(chatId).catch(() => [] as ChatMember[]);
    const members = Array.isArray(raw) ? raw : [];
    this.cache.set(key, {
      members,
      byId: new Map(members.map((member) => [member.user.id, member])),
      cachedAt: Date.now(),
    });
    return members;
  }

  /**
   * Resolves a member's admin membership, treating anonymous-admin senders as
   * administrators with full (non-owner) privileges — the reference bot's `/anonadmin on`
   * behaviour, applied universally because Bot API cannot verify them.
   *
   * @param {Api} api - grammY API handle of the live bot.
   * @param {number} chatId - Target chat id.
   * @param {number} userId - Sender id.
   * @returns {Promise<ChatMember | null>} Matching admin entry, or null.
   */
  async getMemberAdmin(api: Api, chatId: number, userId: number): Promise<ChatMember | null> {
    if (this.isAnonymousAdmin(userId, chatId)) {
      return this.syntheticAnonymousAdmin();
    }
    await this.getAdmins(api, chatId);
    const entry = this.cache.get(String(chatId));
    return entry?.byId.get(userId) ?? null;
  }

  /**
   * Checks plain admin status (creator or administrator).
   *
   * @param {Api} api - grammY API handle of the live bot.
   * @param {number} chatId - Target chat id.
   * @param {number} userId - Sender id.
   * @returns {Promise<boolean>} True when the sender administrates the chat.
   */
  async isAdmin(api: Api, chatId: number, userId: number): Promise<boolean> {
    const admin = await this.getMemberAdmin(api, chatId, userId);
    return admin?.status === 'administrator' || admin?.status === 'creator';
  }

  /**
   * Checks whether the sender is the chat owner/creator.
   *
   * @param {Api} api - grammY API handle of the live bot.
   * @param {number} chatId - Target chat id.
   * @param {number} userId - Sender id.
   * @returns {Promise<boolean>} True only for the creator (or anonymous
   * channel-owner senders, which Telegram maps to the chat itself).
   */
  async isOwner(api: Api, chatId: number, userId: number): Promise<boolean> {
    if (userId === chatId) return true; // channel-linked owner posts
    const admin = await this.getMemberAdmin(api, chatId, userId);
    return admin?.status === 'creator';
  }

  /**
   * Checks a reference-mapped capability derived from native Telegram privileges.
   * Owners always pass; anonymous admins pass everything except implicit
   * ownership (matching the reference bot's anonadmin caveat).
   *
   * @param {Api} api - grammY API handle of the live bot.
   * @param {number} chatId - Target chat id.
   * @param {number} userId - Sender id.
   * @param {AdminCapability} capability - Required capability.
   * @returns {Promise<boolean>} True when the sender holds the capability.
   */
  async hasCapability(
    api: Api,
    chatId: number,
    userId: number,
    capability: AdminCapability,
  ): Promise<boolean> {
    const admin = await this.getMemberAdmin(api, chatId, userId);
    if (!admin) return false;
    if (admin.status === 'creator') return true;
    if (admin.status !== 'administrator') return false;
    const privileges = admin as unknown as { [key: string]: unknown };

    switch (capability) {
      case 'restrict':
        return privileges.can_restrict_members === true;
      case 'delete':
        return privileges.can_delete_messages === true;
      case 'pin':
        return privileges.can_pin_messages === true;
      case 'change_info':
        return privileges.can_change_info === true;
      case 'promote':
        return privileges.can_promote_members === true;
      case 'manage_topics':
        return privileges.can_manage_topics === true;
      default:
        return false;
    }
  }

  /**
   * Drops cached admin lists. Passing a chatId targets one chat; otherwise
   * every cache entry is cleared (used by /admincache and bot restarts).
   *
   * @param {number} [chatId] - Optional chat id to refresh.
   * @returns {void}
   */
  refresh(chatId?: number): void {
    if (chatId === undefined) {
      this.cache.clear();
      return;
    }
    this.cache.delete(String(chatId));
  }

  /**
   * Builds the synthetic full-privilege admin entry for anonymous senders.
   *
   * @returns {ChatMember} Administrator entry granting all non-owner rights.
   */
  private syntheticAnonymousAdmin(): ChatMember {
    return {
      status: 'administrator',
      user: {
        id: GROUP_ANONYMOUS_BOT_ID,
        is_bot: true,
        first_name: 'Anonymous Admin',
      },
      can_be_edited: false,
      can_manage_chat: true,
      can_delete_messages: true,
      can_manage_video_chats: true,
      can_restrict_members: true,
      can_promote_members: false,
      can_change_info: true,
      can_invite_users: true,
      can_post_stories: false,
      can_edit_stories: false,
      can_delete_stories: false,
      can_pin_messages: true,
      can_manage_topics: true,
      is_anonymous: true,
    } as ChatMember;
  }
}
