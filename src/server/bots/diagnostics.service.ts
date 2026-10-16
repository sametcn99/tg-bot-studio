import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { BotPoolService } from '../bot-engine/bot-pool.service';
import { callGetMe } from '../common/utils/telegram.util';
import { BotModel } from './bot.model';
import { listModuleStates } from './module-states';

/**
 * Diagnostic health checks for a bot: Telegram connectivity, runtime poller
 * status, group privacy mode, chat-connection coverage, and usage-based
 * module recommendations. Extracted from BotsService so the CRUD service
 * stays focused on bot lifecycle.
 */
@Injectable()
export class DiagnosticsService {
  /**
   * @param {BotModel} botModel - Bot rows and existence checks.
   * @param {PrismaService} prisma - Prisma ORM access service.
   * @param {BotPoolService} pool - Runtime status source.
   */
  constructor(
    private readonly botModel: BotModel,
    private readonly prisma: PrismaService,
    private readonly pool: BotPoolService,
  ) {}

  /**
   * Runs diagnostic health checks on bot permissions and runtime status.
   * @param {number} botId - Studio bot identifier.
   * @returns {Promise<Record<string, unknown>>} Diagnostic report with actionable recommendations.
   * @throws {NotFoundException} When the bot does not exist.
   */
  async getDiagnostics(botId: number): Promise<Record<string, unknown>> {
    const row = await this.botModel.findById(botId);
    if (!row) throw new NotFoundException(`Bot ${botId} not found`);

    const check = await callGetMe(row.token);
    const runtimeStatus = this.pool.getStatus(botId, row.isActive === 1);
    const groupCount = await this.prisma.chatConnection.count({
      where: { botId, isActive: 1 },
    });
    const activeModules = (await listModuleStates(this.botModel, botId)).filter((m) => m.isEnabled);

    const checks: Array<{
      key: string;
      title: string;
      status: 'pass' | 'warning' | 'error' | 'info';
      details: string;
    }> = [];
    const recommendations: string[] = [];

    // 1. Telegram API connectivity
    if (check.ok && check.bot) {
      checks.push({
        key: 'token',
        title: 'Telegram API Connectivity',
        status: 'pass',
        details: `@${check.bot.username} is responsive to Telegram API.`,
      });
    } else {
      checks.push({
        key: 'token',
        title: 'Telegram API Connectivity',
        status: 'error',
        details: check.description || 'Bot token rejected or Telegram API unreachable.',
      });
      recommendations.push('Verify your BotFather token or generate a new one via @BotFather.');
    }

    // 2. Runtime engine status
    const runtimeInfo = this.pool.getRuntimeInfo(botId);
    if (runtimeStatus === 'active') {
      checks.push({
        key: 'runtime',
        title: 'Studio Runtime Poller',
        status: 'pass',
        details: 'Long-polling engine is running and processing updates in real-time.',
      });
    } else if (runtimeInfo.errorReason === 'token_revoked') {
      checks.push({
        key: 'runtime',
        title: 'Studio Runtime Poller',
        status: 'error',
        details: 'Bot token rejected or revoked (401 Unauthorized). Auto-restart was stopped.',
      });
      recommendations.push(
        'Generate a new bot token via @BotFather and update the bot configuration.',
      );
    } else if (runtimeInfo.errorReason === 'conflict') {
      checks.push({
        key: 'runtime',
        title: 'Studio Runtime Poller',
        status: 'error',
        details:
          'Conflict detected (409 Conflict): Another bot instance or active webhook is using this token.',
      });
      recommendations.push(
        'Ensure no other instances are polling this token and clear any webhook with deleteWebhook.',
      );
    } else if (runtimeInfo.status === 'retrying') {
      checks.push({
        key: 'runtime',
        title: 'Studio Runtime Poller',
        status: 'warning',
        details: `Poller crashed and is automatically recovering (retry attempt ${runtimeInfo.retryCount}). Last error: ${runtimeInfo.lastError}`,
      });
    } else if (runtimeInfo.status === 'failed') {
      checks.push({
        key: 'runtime',
        title: 'Studio Runtime Poller',
        status: 'error',
        details: `Poller failed after ${runtimeInfo.retryCount} restart attempt(s). Error: ${runtimeInfo.lastError || 'Unknown crash'}`,
      });
      recommendations.push('Check the server logs or restart the bot from the dashboard.');
    } else {
      checks.push({
        key: 'runtime',
        title: 'Studio Runtime Poller',
        status: 'warning',
        details: `Poller status is "${runtimeStatus}". Updates are currently paused.`,
      });
      recommendations.push('Toggle the bot status switch to Active in the overview.');
    }

    // 3. Group privacy mode
    const canReadAll = Boolean(check.bot?.can_read_all_group_messages);
    const needsAll = activeModules.some((m) =>
      [
        'message-score',
        'moderation',
        'welcome',
        'locks',
        'group-tools',
        'cleaning',
        'antiraid',
        'autoresponder',
      ].includes(String(m.key)),
    );
    if (canReadAll) {
      checks.push({
        key: 'privacy_mode',
        title: 'Group Privacy Mode',
        status: 'pass',
        details: 'Privacy Mode is disabled. Bot sees all member messages in groups.',
      });
    } else {
      checks.push({
        key: 'privacy_mode',
        title: 'Group Privacy Mode',
        status: needsAll ? 'warning' : 'info',
        details: 'Privacy Mode is enabled. Bot only sees messages mentioning it unless admin.',
      });
      if (needsAll) {
        recommendations.push(
          'For group moderation modules (locks, cleaning, message score, ...): open @BotFather -> /setprivacy -> Choose bot -> Disable, or make the bot a group administrator.',
        );
      }

      // 3b. reference-parity group command modules need admin rights.
      const groupCommandModules = activeModules.filter((m) =>
        ['group-moderation', 'antiraid', 'admin-log', 'topics'].includes(String(m.key)),
      );
      if (groupCommandModules.length > 0) {
        recommendations.push(
          'Group command modules (Group Moderation, AntiRaid, Admin Log, Topics) act only where the bot is a group administrator with the matching Telegram rights (restrict, delete, pin, manage topics).',
        );
      }
    }

    // 4. Chat connections
    if (groupCount > 0) {
      checks.push({
        key: 'connections',
        title: 'Chat Connections Address Book',
        status: 'pass',
        details: `${groupCount} group(s)/channel(s) connected and available for targeting.`,
      });
    } else {
      checks.push({
        key: 'connections',
        title: 'Chat Connections Address Book',
        status: 'warning',
        details: 'No channels or groups connected yet. Schedulers and Giveaways need target chats.',
      });
      recommendations.push('Add your channels or press "Sync from bot" in Chat Connections.');
    }

    // 5. Smart usage-based module recommendations
    const hasSupport = activeModules.some((m) => String(m.key) === 'support');
    const hasAi = activeModules.some((m) => String(m.key) === 'ai-assistant');
    const hasBroadcast = activeModules.some((m) => String(m.key) === 'broadcast');

    if (hasSupport && !hasAi) {
      recommendations.push(
        'Smart suggestion: Support module is active. Enable AI Assistant to auto-reply to FAQs and draft responses.',
      );
    }
    if (groupCount > 0 && !hasBroadcast) {
      recommendations.push(
        'Smart suggestion: Connected channels found. Enable Broadcast module to send scheduled or immediate bulletins.',
      );
    }

    return {
      ok: true,
      botId,
      botInfo: check.bot,
      runtimeStatus,
      runtimeInfo,
      checks,
      recommendations,
    };
  }
}
