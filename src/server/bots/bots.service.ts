import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { BotModel } from '../models/bot.model';
import { BotPoolService } from '../bot-engine/bot-pool.service';
import { MODULE_REGISTRY, findModule } from '../bot-engine/module-registry';
import { callGetMe } from '../common/utils/telegram.util';
import { AiAssistantService } from '../modules/ai-assistant/ai-assistant.service';
import type { CreateBotDto, UpdateBotDto, UpdateModuleStateDto } from './dto/bots.dto';

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
   */
  constructor(
    private readonly botModel: BotModel,
    private readonly prisma: PrismaService,
    private readonly pool: BotPoolService,
    private readonly aiService: AiAssistantService,
  ) {}

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
      throw new BadRequestException('This bot token is already registered');
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
      ['message-score', 'moderation', 'welcome'].includes(String(m.key)),
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
          'For Message Score and Moderation modules: open @BotFather -> /setprivacy -> Choose bot -> Disable.',
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
      throw new BadRequestException(`Unknown preset bundle: ${presetKey}`);
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
  ): Promise<{
    text: string;
    mediaUrl?: string | null;
    buttons?: Array<{ text: string; url?: string }>;
  }> {
    const row = await this.botModel.findById(botId);
    if (!row) throw new NotFoundException(`Bot ${botId} not found`);

    const trimmed = text.trim();
    const lower = trimmed.toLowerCase();

    // 1. Check Start Menu (/start or /menu)
    if (trimmed.startsWith('/start') || trimmed.startsWith('/menu')) {
      const startMenuModule = await this.botModel.getModule(botId, 'start-menu');
      if (startMenuModule?.isEnabled) {
        const config = startMenuModule.configJson
          ? (JSON.parse(startMenuModule.configJson) as Record<string, unknown>)
          : {};
        const menuItems = await this.prisma.link.findMany({
          where: { botId, isActive: 1 },
          orderBy: { orderIndex: 'asc' },
        });
        const startMessage = String(
          config.startMessage || `Welcome to ${row.name}! Choose an option below:`,
        );
        const buttons = menuItems.map((item) => ({
          text: item.title,
          url: item.url,
        }));
        return {
          text: startMessage.replace('{first_name}', 'Tester').replace('{username}', 'studio_test'),
          buttons,
        };
      }
    }

    // 2. Check Autoresponder (slash commands and keyword triggers)
    const autoresponderModule = await this.botModel.getModule(botId, 'autoresponder');
    if (autoresponderModule?.isEnabled) {
      const rules = await this.prisma.autoresponder.findMany({
        where: { botId, isActive: 1 },
      });
      const cmdText = trimmed.split(/[\s@]/)[0].toLowerCase();
      const matched =
        rules.find((r) => r.command.startsWith('/') && r.command.toLowerCase() === cmdText) ??
        rules.find((r) => !r.command.startsWith('/') && lower.includes(r.command.toLowerCase()));

      if (matched) {
        let buttons: Array<{ text: string; url?: string }> = [];
        if (matched.buttonsJson) {
          try {
            buttons = JSON.parse(matched.buttonsJson) as Array<{ text: string; url?: string }>;
          } catch {
            // ignore
          }
        }
        return {
          text: matched.responseText
            .replace('{first_name}', 'Tester')
            .replace('{username}', 'studio_test'),
          mediaUrl: matched.mediaUrl,
          buttons,
        };
      }
    }

    // 3. Check AI Assistant (with RAG retrieval)
    const aiModule = await this.botModel.getModule(botId, 'ai-assistant');
    if (aiModule?.isEnabled) {
      const config = aiModule.configJson
        ? (JSON.parse(aiModule.configJson) as Record<string, unknown>)
        : {};
      if (config.apiKey) {
        try {
          const reply = await this.aiService.completeWithContext(
            botId,
            999999, // sandbox simulator user id
            config as any,
            [{ role: 'user', content: trimmed }],
          );
          return { text: reply };
        } catch (err: unknown) {
          return { text: `[AI Error]: ${err instanceof Error ? err.message : String(err)}` };
        }
      } else {
        return { text: 'AI Assistant module is enabled, but no API key is set in configuration.' };
      }
    }

    // 4. Default echo response
    return {
      text: `Message received: "${trimmed}". (No matching command, auto-responder, or AI rule found). Try typing /start.`,
    };
  }

  /**
   * Clones an existing bot's complete module setup, autoresponders, drip flows,
   * and mini-apps to a new bot with a new token.
   */
  async cloneBot(botId: number, data: { name?: string; token: string }): Promise<BotWithStatus> {
    const original = await this.botModel.findById(botId);
    if (!original) this.throwNotFound(botId);

    const token = data.token.trim();
    if (!token) throw new BadRequestException('New bot token is required for cloning');

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

    return {
      version: '1.0',
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

    await this.pool.restartBot(botId);
    this.logger.log(`Imported configuration bundle into bot ${botId}`);
    return { success: true, importedModules: count };
  }
}
