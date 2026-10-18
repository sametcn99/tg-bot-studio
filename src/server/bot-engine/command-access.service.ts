import { Injectable } from '@nestjs/common';
import type { Api } from 'grammy';
import { AdminGateService } from './admin-gate.service';
import { ChatSettingsService } from './chat-settings.service';

/**
 * Shared gate for reference-style per-group command disabling. Commands disabled
 * via /disable stop responding for regular members; admins stay exempt
 * unless /disableadmin on, and /disabledel deletes the ignored command.
 */
@Injectable()
export class CommandAccessService {
  /**
   * @param {ChatSettingsService} chatSettings - Per-chat config layer.
   * @param {AdminGateService} adminGate - Telegram permission gate.
   */
  constructor(
    private readonly chatSettings: ChatSettingsService,
    private readonly adminGate: AdminGateService,
  ) {}

  /**
   * Checks whether a sender may invoke a command in a chat.
   *
   * @param {Api} api - grammY API handle of the live bot.
   * @param {number} botId - Studio bot id.
   * @param {number} chatId - Group chat id.
   * @param {number} userId - Sender id.
   * @param {string} command - Bare command name without the slash.
   * @param {object} [ctxMessage] - Optional hooks: `delete` removes the
   * ignored command message when the chat enabled /disabledel.
   * @returns {Promise<boolean>} True when the command may run.
   */
  async isCommandAllowed(
    api: Api,
    botId: string,
    chatId: number,
    userId: number,
    command: string,
    ctxMessage?: { delete: () => Promise<unknown> },
  ): Promise<boolean> {
    const config = await this.chatSettings.getEffectiveConfig(botId, chatId, 'group-tools');
    const disabled = Array.isArray(config.disabledCommands)
      ? (config.disabledCommands as string[])
      : [];
    if (!disabled.includes(command)) return true;

    const applyToAdmins = config.disableAdmin === true;
    if (!applyToAdmins && (await this.adminGate.isAdmin(api, chatId, userId))) {
      return true;
    }
    if (config.disabledDelete === true && ctxMessage) {
      await ctxMessage.delete().catch(() => undefined);
    }
    return false;
  }
}
