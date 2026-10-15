import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { BotModel } from '../models/bot.model';
import { BotPoolService } from '../bot-engine/bot-pool.service';
import { MODULE_REGISTRY, findModule } from '../bot-engine/module-registry';
import { callGetMe } from '../common/utils/telegram.util';
import { AiAssistantService } from '../modules/ai-assistant/ai-assistant.service';
import type { CreateBotDto, UpdateBotDto, UpdateModuleStateDto } from './dto/bots.dto';
import { StudioException } from '../common/errors/studio-error';
import { SystemSettingsService } from '../database/system-settings.service';
import { SimulatorService } from '../bot-engine/simulator.service';
import { AuditService } from '../database/audit.service';
import { isValidTimeZone, safeTimeZone } from '../common/utils/tz.util';

/**
 * Bot row with runtime enrichment for the dashboard.
 * @interface BotWithStatus
 */
export interface BotWithStatus {
  id: number;
  name: string;
  token: string;
  username: string | null;
  first_name: string | null;
  is_active: number;
  created_at: string | null;
  status: string;
  activeModules: number;
  miniApps: number;
  subscribers: number;
  dailyVolume: number;
}

function maskToken(token: string): string {
  if (!token || token.length < 10) return '••••••••';
  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

/**
 * Bot CRUD and per-bot module toggle management.
 */
@Injectable()
export class BotsService {
  private readonly logger = new Logger(BotsService.name);

  /**
   * @param {BotModel} botModel - Domain model for bots and modules.
   * @param {PrismaService} prisma - Prisma ORM access service.
   * @param {BotPoolService} pool - Multi-bot runtime pool.
   * @param {AiAssistantService} aiService - AI service gateway.
   * @param {SystemSettingsService} settings - Per-bot operational settings.
   */
  constructor(
    private readonly botModel: BotModel,
    private readonly prisma: PrismaService,
    private readonly pool: BotPoolService,
    private readonly aiService: AiAssistantService,
    private readonly settings: SystemSettingsService,
    private readonly simulator: SimulatorService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Reads bot-level operational settings (IANA time zone).
   * @param {number} botId - Bot identifier.
   * @returns {Promise<{timezone: string}>} Effective settings.
   */
  async getBotSettings(botId: number): Promise<{ timezone: string }> {
    await this.botModel.findById(botId);
    return { timezone: safeTimeZone(this.settings.getBotSetting(botId, 'timezone')) };
  }

  /**
   * Updates bot-level operational settings.
   * @param {number} botId - Bot identifier.
   * @param {{timezone?: string}} body - Patch payload.
   * @returns {Promise<{timezone: string}>} Effective settings after the update.
   * @throws {StudioException} When the zone name is not a valid IANA zone.
   */
  async updateBotSettings(
    botId: number,
    body: { timezone?: string },
  ): Promise<{ timezone: string }> {
    await this.botModel.findById(botId);
    const requested = String(body.timezone ?? '').trim();
    if (requested && !isValidTimeZone(requested)) {
      throw new StudioException('INVALID_TIMEZONE', 'Unknown IANA time zone');
    }
    this.settings.setBotSetting(botId, 'timezone', requested || 'UTC');
    return { timezone: requested || 'UTC' };
  }

  /**
   * Lists all bots enriched with runtime status and audience metrics.
   * @returns {Promise<BotWithStatus[]>} All registered bots.
   */
  async findAll(): Promise<BotWithStatus[]> {
    const bots = await this.botModel.findAll();

    return Promise.all(
      bots.map(async (row) => {
        const [activeModules, miniApps, subscribers] = await Promise.all([
          this.botModel.countActiveModules(row.id),
          this.botModel.countMiniApps(row.id),
          this.botModel.countSubscribers(row.id),
        ]);

        return {
          id: row.id,
          name: row.name,
          token: maskToken(row.token),
          username: row.username,
          first_name: row.firstName,
          is_active: row.isActive,
          created_at: row.createdAt,
          status: this.pool.getStatus(row.id, row.isActive === 1),
          activeModules,
          miniApps,
          subscribers,
          dailyVolume: this.pool.getDailyVolume(row.id),
        };
      }),
    );
  }

  /**
   * Fetches a single bot with metrics.
   * @param {number} id - Studio bot identifier.
   * @returns {Promise<BotWithStatus>} Enriched bot record.
   * @throws {NotFoundException} When the bot does not exist.
   */
  async findOne(id: number): Promise<BotWithStatus> {
    const bot = await this.botModel.findById(id);
    if (!bot) this.throwNotFound(id);

    const [activeModules, miniApps, subscribers] = await Promise.all([
      this.botModel.countActiveModules(bot.id),
      this.botModel.countMiniApps(bot.id),
      this.botModel.countSubscribers(bot.id),
    ]);

    return {
      id: bot.id,
      name: bot.name,
      token: maskToken(bot.token),
      username: bot.username,
      first_name: bot.firstName,
      is_active: bot.isActive,
      created_at: bot.createdAt,
      status: this.pool.getStatus(bot.id, bot.isActive === 1),
      activeModules,
      miniApps,
      subscribers,
      dailyVolume: this.pool.getDailyVolume(bot.id),
    };
  }

  /**
   * Throws the shared not-found error for a bot id.
   * @param {number} id - Studio bot identifier.
   * @throws {NotFoundException} Always.
   */
  private throwNotFound(id: number): never {
    throw new NotFoundException(`Bot ${id} not found`);
  }

  /**
   * Registers a bot after validating its token against Telegram `getMe`.
   * @param {CreateBotDto} dto - Token and optional display name.
   * @returns {Promise<BotWithStatus>} The created bot with metrics.
   * @throws {BadRequestException} When Telegram rejects the token.
   */
  async create(dto: CreateBotDto): Promise<BotWithStatus> {
    const check = await callGetMe(dto.token);
    if (!check.ok || !check.bot) {
      throw new BadRequestException(
        `Telegram rejected the token: ${check.description ?? 'unknown error'}`,
      );
    }

    const existing = await this.botModel.findByToken(dto.token);
    if (existing) {
      throw new StudioException('BOT_TOKEN_DUPLICATE', 'This bot token is already registered');
    }

    const created = await this.botModel.create({
      name: dto.name || check.bot.first_name,
      token: dto.token,
      username: check.bot.username,
      firstName: check.bot.first_name,
    });

    await this.pool.restartBot(created.id);
    return this.findOne(created.id);
  }

  /**
   * Updates bot metadata or enabled state, restarting the poller as needed.
   * @param {number} id - Studio bot identifier.
   * @param {UpdateBotDto} dto - Patch fields.
   * @returns {Promise<BotWithStatus>} Updated bot record.
   * @throws {NotFoundException} When the bot does not exist.
   */
  async update(id: number, dto: UpdateBotDto): Promise<BotWithStatus> {
    const existing = await this.botModel.findById(id);
    if (!existing) throw new NotFoundException(`Bot ${id} not found`);

    await this.botModel.update(id, {
      name: dto.name,
      isActive: dto.isActive !== undefined ? (dto.isActive ? 1 : 0) : undefined,
    });

    await this.pool.restartBot(id);
    return this.findOne(id);
  }

  /**
   * Deletes a bot, stops its poller, and cascades removal across all bot-scoped rows.
   * @param {number} id - Studio bot identifier.
   * @returns {Promise<void>} Resolves once fully removed.
   */
  async remove(id: number): Promise<void> {
    this.pool.destroyBot(id);
    await this.botModel.delete(id);
    this.audit.log('bot.delete', { botId: id });
  }

  /**
   * Lists every module with its effective state and config for a bot.
   * @param {number} botId - Studio bot identifier.
   * @returns {Promise<Array<Record<string, unknown>>>} Registry entries merged with persisted state.
   */
  async listModules(botId: number): Promise<Array<Record<string, unknown>>> {
    const rows = await this.botModel.listModules(botId);
    const byKey = new Map(rows.map((row) => [row.moduleKey, row]));

    return MODULE_REGISTRY.map((definition) => {
      const row = byKey.get(definition.key);
      const stored = row?.configJson ? (JSON.parse(row.configJson) as Record<string, unknown>) : {};
      return {
        key: definition.key,
        name: definition.name,
        category: definition.category,
        description: definition.description,
        isEnabled: Boolean(row?.isEnabled),
        config: { ...definition.defaultConfig, ...stored },
      };
    });
  }

  /**
   * Toggles or reconfigures a module and hot-reloads the bot runtime.
   * @param {number} botId - Studio bot identifier.
   * @param {string} moduleKey - Module registry key.
   * @param {UpdateModuleStateDto} dto - Enabled flag and config payload.
   * @returns {Promise<Record<string, unknown>>} Updated module descriptor.
   * @throws {NotFoundException} When bot or module key is unknown.
   */
  async updateModule(
    botId: number,
    moduleKey: string,
    dto: UpdateModuleStateDto,
  ): Promise<Record<string, unknown>> {
    const bot = await this.botModel.findById(botId);
    if (!bot) {
      throw new NotFoundException(`Bot ${botId} not found`);
    }
    const definition = findModule(moduleKey);
    if (!definition) throw new NotFoundException(`Module ${moduleKey} not found`);

    await this.botModel.upsertModule(
      botId,
      moduleKey,
      dto.isEnabled ? 1 : 0,
      JSON.stringify(dto.config ?? {}),
    );

    await this.pool.restartBot(botId);
    this.audit.log('module.update', { botId, moduleKey, isEnabled: dto.isEnabled });
    const modules = await this.listModules(botId);
    return modules.find((module) => module.key === moduleKey)!;
  }

  /**
   * Runs diagnostic health checks on bot permissions and runtime status.
   * @param {number} botId - Studio bot identifier.
   * @returns {Promise<Record<string, unknown>>} Diagnostic report with actionable recommendations.
   */
  async getDiagnostics(botId: number): Promise<Record<string, unknown>> {
    const row = await this.botModel.findById(botId);
    if (!row) throw new NotFoundException(`Bot ${botId} not found`);

    const check = await callGetMe(row.token);
    const runtimeStatus = this.pool.getStatus(botId, row.isActive === 1);
    const groupCount = await this.prisma.chatConnection.count({
      where: { botId, isActive: 1 },
    });
    const activeModules = (await this.listModules(botId)).filter((m) => m.isEnabled);

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
        details: `Poller crashed and is automatically recovering (retry attempt ${runtimeInfo.retryCount}/3). Last error: ${runtimeInfo.lastError}`,
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

  /**
   * Applies a coordinated starter feature bundle in one click.
   * @param {number} botId - Studio bot identifier.
   * @param {string} presetKey - Bundle key (ecommerce/community/support/growth).
   * @returns {Promise<Record<string, unknown>>} Result and enabled module keys.
   */
  async applyPreset(botId: number, presetKey: string): Promise<Record<string, unknown>> {
    const bot = await this.botModel.findById(botId);
    if (!bot) {
      throw new NotFoundException(`Bot ${botId} not found`);
    }

    const presetBundles: Record<string, string[]> = {
      ecommerce: ['start-menu', 'vip-subs', 'support', 'paid-media'],
      community: ['welcome', 'captcha', 'moderation', 'message-score', 'giveaways'],
      support: ['support', 'ai-assistant', 'autoresponder'],
      growth: ['referrals', 'broadcast', 'drip', 'quizzes'],
    };

    const modulesToEnable = presetBundles[presetKey];
    if (!modulesToEnable) {
      throw new StudioException('PRESET_UNKNOWN', `Unknown preset bundle: ${presetKey}`);
    }

    for (const key of modulesToEnable) {
      const definition = findModule(key);
      await this.botModel.upsertModule(
        botId,
        key,
        1,
        JSON.stringify(definition?.defaultConfig ?? {}),
      );
    }

    await this.pool.restartBot(botId);
    return {
      success: true,
      presetKey,
      enabledModules: modulesToEnable,
    };
  }

  /**
   * Simulates an incoming Telegram message dispatch for in-studio sandbox testing.
   * @param {number} botId - Studio bot identifier.
   * @param {string} text - Message text or command.
   * @returns {Promise<object>} Simulated bot response (text, photo, buttons).
   */
  async simulateMessage(
    botId: number,
    text: string,
    options: { chatType?: 'private' | 'supergroup' | 'group'; event?: 'message' | 'join' | 'leave' | 'chat_member' } = {},
  ): Promise<{
    text: string;
    mediaUrl?: string | null;
    buttons?: Array<{ text: string; url?: string; callback_data?: string }>;
  }> {
    // Delegates to the real grammY middleware chain: every enabled module
    // runtime processes the sandbox message exactly like live traffic.
    return this.simulator.send(botId, { text, ...options });
  }

  /**
   * Simulates a callback button press through the real module chain.
   * @param {number} botId - Studio bot identifier.
   * @param {string} callbackData - callback_data payload of the pressed button.
   * @returns {Promise<object>} Simulated bot response.
   */
  async simulateCallback(
    botId: number,
    callbackData: string,
    chatType: 'private' | 'supergroup' | 'group' = 'private',
  ): Promise<{
    text: string;
    mediaUrl?: string | null;
    buttons?: Array<{ text: string; url?: string; callback_data?: string }>;
  }> {
    return this.simulator.send(botId, { callbackData, chatType });
  }

  /**
   * Clones an existing bot's complete module setup, autoresponders, drip flows,
   * and mini-apps to a new bot with a new token.
   */
  async cloneBot(botId: number, data: { name?: string; token: string }): Promise<BotWithStatus> {
    const original = await this.botModel.findById(botId);
    if (!original) this.throwNotFound(botId);

    const token = data.token.trim();
    if (!token)
      throw new StudioException('CLONE_TOKEN_REQUIRED', 'New bot token is required for cloning');

    const check = await callGetMe(token);
    if (!check.ok || !check.bot) {
      throw new BadRequestException(check.description || 'Invalid Telegram bot token');
    }

    const cloneName = data.name?.trim() || `${original.name} (Clone)`;
    const newBot = await this.botModel.create({
      name: cloneName,
      token,
      username: check.bot.username ?? null,
      firstName: check.bot.first_name ?? null,
    });

    // 1. Clone modules
    const modules = await this.prisma.botModule.findMany({ where: { botId } });
    for (const m of modules) {
      await this.prisma.botModule.create({
        data: {
          botId: newBot.id,
          moduleKey: m.moduleKey,
          isEnabled: m.isEnabled,
          configJson: m.configJson,
        },
      });
    }

    // 2. Clone autoresponders
    const autoresponders = await this.prisma.autoresponder.findMany({ where: { botId } });
    for (const a of autoresponders) {
      await this.prisma.autoresponder.create({
        data: {
          botId: newBot.id,
          command: a.command,
          responseText: a.responseText,
          mediaUrl: a.mediaUrl,
          buttonsJson: a.buttonsJson,
          isActive: a.isActive,
        },
      });
    }

    // 3. Clone drip campaigns
    const drips = await this.prisma.dripCampaign.findMany({
      where: { botId },
    });
    for (const drip of drips) {
      await this.prisma.dripCampaign.create({
        data: {
          botId: newBot.id,
          name: drip.name,
          stepsJson: drip.stepsJson,
          isActive: drip.isActive,
        },
      });
    }

    // 4. Clone mini apps
    const miniApps = await this.prisma.miniApp.findMany({ where: { botId } });
    for (const app of miniApps) {
      const cloneSlug = `${app.slug}-${Date.now().toString(36)}`;
      await this.prisma.miniApp.create({
        data: {
          botId: newBot.id,
          name: `${app.name} (Clone)`,
          slug: cloneSlug,
          templateType: app.templateType,
          title: app.title,
          description: app.description,
          iconUrl: app.iconUrl,
          configJson: app.configJson,
          themeJson: app.themeJson,
          isActive: app.isActive,
        },
      });
    }

    // 5. Clone relevant bot settings
    const settings = await this.prisma.botSetting.findMany({ where: { botId } });
    for (const s of settings) {
      if (
        s.key.startsWith('spin_') ||
        s.key.startsWith('forms_') ||
        s.key.startsWith('giveaway_')
      ) {
        continue;
      }
      await this.prisma.botSetting.create({
        data: {
          botId: newBot.id,
          key: s.key,
          value: s.value,
        },
      });
    }

    await this.pool.restartBot(newBot.id);
    this.logger.log(`Cloned bot ${botId} -> ${newBot.id} (@${check.bot.username})`);
    return this.findOne(newBot.id);
  }

  /**
   * Exports full configuration bundle of a bot (excluding sensitive credentials).
   */
  async exportConfig(botId: number): Promise<Record<string, unknown>> {
    const bot = await this.botModel.findById(botId);
    if (!bot) this.throwNotFound(botId);

    const modules = await this.prisma.botModule.findMany({ where: { botId } });
    const autoresponders = await this.prisma.autoresponder.findMany({ where: { botId } });
    const drips = await this.prisma.dripCampaign.findMany({
      where: { botId },
    });
    const miniApps = await this.prisma.miniApp.findMany({ where: { botId } });
    const chatModuleSettings = await this.prisma.chatModuleSetting.findMany({ where: { botId } });

    return {
      version: '1.1',
      exportedAt: new Date().toISOString(),
      botName: bot.name,
      modules: modules.map((m) => {
        let parsedConfig: Record<string, unknown> = {};
        if (m.configJson) {
          try {
            parsedConfig = JSON.parse(m.configJson) as Record<string, unknown>;
            if (m.moduleKey === 'ai-assistant') {
              delete parsedConfig.apiKey;
            }
          } catch {}
        }
        return {
          moduleKey: m.moduleKey,
          isEnabled: m.isEnabled,
          config: parsedConfig,
        };
      }),
      autoresponders: autoresponders.map((a) => ({
        command: a.command,
        responseText: a.responseText,
        mediaUrl: a.mediaUrl,
        buttonsJson: a.buttonsJson,
        isActive: a.isActive,
      })),
      dripCampaigns: drips.map((d) => ({
        name: d.name,
        stepsJson: d.stepsJson,
        isActive: d.isActive,
      })),
      miniApps: miniApps.map((a) => ({
        name: a.name,
        templateType: a.templateType,
        title: a.title,
        description: a.description,
        configJson: a.configJson,
        themeJson: a.themeJson,
        isActive: a.isActive,
      })),
      chatModuleSettings: chatModuleSettings.map((c) => ({
        chatId: c.chatId,
        moduleKey: c.moduleKey,
        configJson: c.configJson,
      })),
    };
  }

  /**
   * Imports a configuration bundle into an existing bot.
   */
  async importConfig(
    botId: number,
    bundle: Record<string, unknown>,
  ): Promise<{ success: boolean; importedModules: number }> {
    const bot = await this.botModel.findById(botId);
    if (!bot) this.throwNotFound(botId);

    let count = 0;
    if (Array.isArray(bundle.modules)) {
      for (const m of bundle.modules) {
        if (!m || typeof m !== 'object' || !('moduleKey' in m)) continue;
        const configJson = (m as any).config ? JSON.stringify((m as any).config) : null;
        await this.prisma.botModule.upsert({
          where: { botId_moduleKey: { botId, moduleKey: String((m as any).moduleKey) } },
          create: {
            botId,
            moduleKey: String((m as any).moduleKey),
            isEnabled: Number((m as any).isEnabled) || 0,
            configJson,
          },
          update: {
            isEnabled: Number((m as any).isEnabled) || 0,
            configJson,
          },
        });
        count++;
      }
    }

    if (Array.isArray(bundle.autoresponders)) {
      for (const a of bundle.autoresponders) {
        if (!a || typeof a !== 'object' || !('command' in a)) continue;
        await this.prisma.autoresponder.create({
          data: {
            botId,
            command: String((a as any).command),
            responseText: String((a as any).responseText ?? ''),
            mediaUrl: (a as any).mediaUrl ? String((a as any).mediaUrl) : null,
            buttonsJson: (a as any).buttonsJson ? String((a as any).buttonsJson) : null,
            isActive: Number((a as any).isActive ?? 1),
          },
        });
      }
    }

    if (Array.isArray(bundle.dripCampaigns)) {
      for (const d of bundle.dripCampaigns) {
        if (!d || typeof d !== 'object') continue;
        await this.prisma.dripCampaign.create({
          data: {
            botId,
            name: String((d as any).name ?? 'Imported Drip'),
            stepsJson: String((d as any).stepsJson ?? '[]'),
            isActive: Number((d as any).isActive ?? 1),
          },
        });
      }
    }

    if (Array.isArray(bundle.chatModuleSettings)) {
      for (const c of bundle.chatModuleSettings) {
        if (!c || typeof c !== 'object' || !('chatId' in c)) continue;
        await this.prisma.chatModuleSetting.upsert({
          where: {
            botId_chatId_moduleKey: {
              botId,
              chatId: String((c as any).chatId),
              moduleKey: String((c as any).moduleKey),
            },
          },
          create: {
            botId,
            chatId: String((c as any).chatId),
            moduleKey: String((c as any).moduleKey),
            configJson: String((c as any).configJson ?? '{}'),
          },
          update: { configJson: String((c as any).configJson ?? '{}') },
        });
      }
    }

    await this.pool.restartBot(botId);
    this.logger.log(`Imported configuration bundle into bot ${botId}`);
    return { success: true, importedModules: count };
  }
}
