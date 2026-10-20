import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { BotModel } from './bot.model';
import { DiagnosticsService } from './diagnostics.service';
import { BotPoolService } from '../bot-engine/bot-pool.service';
import { ChatSettingsService } from '../bot-engine/chat-settings.service';
import { findModule } from '../bot-engine/module-registry';
import { callGetMe } from '../common/utils/telegram.util';
import { AiAssistantService } from '../modules/ai-assistant/ai-assistant.service';
import type { CreateBotDto, UpdateBotDto, UpdateModuleStateDto } from './dto/bots.dto';
import { StudioException } from '../common/errors/studio-error';
import { SystemSettingsService } from '../database/system-settings.service';
import { SimulatorService } from '../bot-engine/simulator.service';
import { AuditService } from '../database/audit.service';
import { isValidTimeZone, safeTimeZone } from '../common/utils/tz.util';
import { safeJsonObjectParse } from '../common/utils/json.util';
import { listModuleStates } from './module-states';

/**
 * Bot row with runtime enrichment for the dashboard.
 * @interface BotWithStatus
 */
export interface BotWithStatus {
  id: string;
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

/** Config keys whose values are credentials and must never echo to GETs. */
const SECRET_KEY_PATTERN = /apikey|api_key|secret|token/i;

/** Sentinel the client sends back for an untouched masked secret. */
export const MASKED_SECRET = '__MASKED__';

/**
 * Replaces credential-shaped config values with the masked sentinel so API
 * reads cannot leak secrets (bot tokens are masked the same way upstream).
 * @param {Record<string, unknown>} config - Effective module config.
 * @returns {Record<string, unknown>} Config with secret values masked.
 */
function maskSecrets(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    out[key] =
      SECRET_KEY_PATTERN.test(key) && typeof value === 'string' && value.length > 0
        ? MASKED_SECRET
        : value;
  }
  return out;
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
   * @param {ChatSettingsService} chatSettings - Per-chat override layer (cache invalidation).
   * @param {DiagnosticsService} diagnostics - Diagnostic health-check engine.
   */
  constructor(
    private readonly botModel: BotModel,
    private readonly prisma: PrismaService,
    private readonly pool: BotPoolService,
    private readonly aiService: AiAssistantService,
    private readonly settings: SystemSettingsService,
    private readonly simulator: SimulatorService,
    private readonly audit: AuditService,
    private readonly chatSettings: ChatSettingsService,
    private readonly diagnostics: DiagnosticsService,
  ) {}

  /**
   * Reads bot-level operational settings (IANA time zone).
   * @param {number} botId - Bot identifier.
   * @returns {Promise<{timezone: string}>} Effective settings.
   */
  async getBotSettings(botId: string): Promise<{ timezone: string }> {
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
    botId: string,
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
   * Counters are gathered with three groupBy queries total (not 3 per bot).
   * @returns {Promise<BotWithStatus[]>} All registered bots.
   */
  async findAll(): Promise<BotWithStatus[]> {
    const bots = await this.botModel.findAll();
    const ids = bots.map((row) => row.id);
    const [moduleCounts, appCounts, userCounts] =
      ids.length > 0
        ? await Promise.all([
            this.prisma.botModule.groupBy({
              by: ['botId'],
              where: { botId: { in: ids }, isEnabled: 1 },
              _count: { _all: true },
            }),
            this.prisma.miniApp.groupBy({
              by: ['botId'],
              where: { botId: { in: ids } },
              _count: { _all: true },
            }),
            this.prisma.botUser.groupBy({
              by: ['botId'],
              where: { botId: { in: ids } },
              _count: { _all: true },
            }),
          ])
        : [[], [], []];
    const toMap = (rows: Array<{ botId: string; _count: { _all: number } }>) =>
      new Map(rows.map((r) => [r.botId, r._count._all]));
    const modulesMap = toMap(moduleCounts);
    const appsMap = toMap(appCounts);
    const usersMap = toMap(userCounts);

    return bots.map((row) => ({
      id: row.id,
      name: row.name,
      token: maskToken(row.token),
      username: row.username,
      first_name: row.firstName,
      is_active: row.isActive,
      created_at: row.createdAt,
      status: this.pool.getStatus(row.id, row.isActive === 1),
      activeModules: modulesMap.get(row.id) ?? 0,
      miniApps: appsMap.get(row.id) ?? 0,
      subscribers: usersMap.get(row.id) ?? 0,
      dailyVolume: this.pool.getDailyVolume(row.id),
    }));
  }

  /**
   * Fetches a single bot with metrics.
   * @param {number} id - Studio bot identifier.
   * @returns {Promise<BotWithStatus>} Enriched bot record.
   * @throws {NotFoundException} When the bot does not exist.
   */
  async findOne(id: string): Promise<BotWithStatus> {
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
  private throwNotFound(id: string): never {
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
  async update(id: string, dto: UpdateBotDto): Promise<BotWithStatus> {
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
  async remove(id: string): Promise<void> {
    this.pool.destroyBot(id);
    await this.botModel.delete(id);
    this.audit.log('bot.delete', { botId: id });
  }

  /**
   * Lists every module with its effective state and config for a bot.
   * @param {number} botId - Studio bot identifier.
   * @returns {Promise<Array<Record<string, unknown>>>} Registry entries merged with persisted state.
   */
  async listModules(botId: string): Promise<Array<Record<string, unknown>>> {
    const states = await listModuleStates(this.botModel, botId);
    return states.map((state) => ({
      ...state,
      config: maskSecrets(state.config),
    }));
  }

  /**
   * Toggles or reconfigures a module and hot-reloads the bot runtime. Masked
   * secret sentinels in the payload preserve the previously stored value, and
   * the per-chat override cache is invalidated so effective configs merge the
   * new bot-level state immediately.
   * @param {number} botId - Studio bot identifier.
   * @param {string} moduleKey - Module registry key.
   * @param {UpdateModuleStateDto} dto - Enabled flag and config payload.
   * @returns {Promise<Record<string, unknown>>} Updated module descriptor.
   * @throws {NotFoundException} When bot or module key is unknown.
   */
  async updateModule(
    botId: string,
    moduleKey: string,
    dto: UpdateModuleStateDto,
  ): Promise<Record<string, unknown>> {
    const bot = await this.botModel.findById(botId);
    if (!bot) {
      throw new NotFoundException(`Bot ${botId} not found`);
    }
    const definition = findModule(moduleKey);
    if (!definition) throw new NotFoundException(`Module ${moduleKey} not found`);

    const existing = await this.prisma.botModule.findUnique({
      where: { botId_moduleKey: { botId, moduleKey } },
    });
    const stored = safeJsonObjectParse(
      existing?.configJson,
      {},
      `bot_modules:${botId}:${moduleKey}`,
    );
    const merged: Record<string, unknown> = { ...stored };
    for (const [key, value] of Object.entries(dto.config ?? {})) {
      if (value === MASKED_SECRET) continue;
      merged[key] = value;
    }

    await this.botModel.upsertModule(
      botId,
      moduleKey,
      dto.isEnabled ? 1 : 0,
      JSON.stringify(merged),
    );
    this.chatSettings.invalidate(botId);

    await this.pool.restartBot(botId);
    this.audit.log('module.update', { botId, moduleKey, isEnabled: dto.isEnabled });
    const modules = await this.listModules(botId);
    return modules.find((module) => module.key === moduleKey)!;
  }

  /**
   * Runs diagnostic health checks on bot permissions and runtime status
   * (delegates to the dedicated DiagnosticsService).
   * @param {number} botId - Studio bot identifier.
   * @returns {Promise<Record<string, unknown>>} Diagnostic report with actionable recommendations.
   */
  async getDiagnostics(botId: string): Promise<Record<string, unknown>> {
    return this.diagnostics.getDiagnostics(botId);
  }

  /**
   * Applies a coordinated starter feature bundle in one click.
   * @param {number} botId - Studio bot identifier.
   * @param {string} presetKey - Bundle key (ecommerce/community/support/growth).
   * @returns {Promise<Record<string, unknown>>} Result and enabled module keys.
   */
  async applyPreset(botId: string, presetKey: string): Promise<Record<string, unknown>> {
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

    // One transaction: a crash mid-preset cannot leave a half-provisioned set.
    await this.prisma.$transaction(
      modulesToEnable.map((key) => {
        const definition = findModule(key);
        return this.prisma.botModule.upsert({
          where: { botId_moduleKey: { botId, moduleKey: key } },
          create: {
            botId,
            moduleKey: key,
            isEnabled: 1,
            configJson: JSON.stringify(definition?.defaultConfig ?? {}),
          },
          update: {
            isEnabled: 1,
          },
        });
      }),
    );
    this.chatSettings.invalidate(botId);

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
    botId: string,
    text: string,
    options: {
      chatType?: 'private' | 'supergroup' | 'group';
      event?: 'message' | 'join' | 'leave' | 'chat_member';
    } = {},
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
    botId: string,
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
  async cloneBot(botId: string, data: { name?: string; token: string }): Promise<BotWithStatus> {
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

    // Copy every bot-scoped artifact in one transaction: a crash mid-clone
    // used to leave a half-cloned bot (modules without mini apps, etc.).
    await this.prisma.$transaction(async (tx) => {
      // 1. Clone modules
      const modules = await tx.botModule.findMany({ where: { botId } });
      for (const m of modules) {
        await tx.botModule.create({
          data: {
            botId: newBot.id,
            moduleKey: m.moduleKey,
            isEnabled: m.isEnabled,
            configJson: m.configJson,
          },
        });
      }

      // 2. Clone autoresponders
      const autoresponders = await tx.autoresponder.findMany({ where: { botId } });
      for (const a of autoresponders) {
        await tx.autoresponder.create({
          data: {
            botId: newBot.id,
            command: a.command,
            responseText: a.responseText,
            mediaUrl: a.mediaUrl,
            buttonsJson: a.buttonsJson,
            isActive: a.isActive,
            chatId: a.chatId,
            scope: a.scope,
            matchMode: a.matchMode,
            adminOnly: a.adminOnly,
            repeatSeconds: a.repeatSeconds,
            deletePreviousResponse: a.deletePreviousResponse,
            replyToMessage: a.replyToMessage,
            mediaData: a.mediaData,
            mediaMime: a.mediaMime,
            mediaFileName: a.mediaFileName,
          },
        });
      }

      // 3. Clone drip campaigns
      const drips = await tx.dripCampaign.findMany({
        where: { botId },
      });
      for (const drip of drips) {
        await tx.dripCampaign.create({
          data: {
            botId: newBot.id,
            name: drip.name,
            stepsJson: drip.stepsJson,
            isActive: drip.isActive,
          },
        });
      }

      // 4. Clone mini apps (fresh slugs: slugs are globally unique)
      const miniApps = await tx.miniApp.findMany({ where: { botId } });
      for (const app of miniApps) {
        const cloneSlug = `${app.slug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        await tx.miniApp.create({
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
      const settings = await tx.botSetting.findMany({ where: { botId } });
      for (const s of settings) {
        if (
          s.key.startsWith('spin_') ||
          s.key.startsWith('forms_') ||
          s.key.startsWith('giveaway_')
        ) {
          continue;
        }
        await tx.botSetting.create({
          data: {
            botId: newBot.id,
            key: s.key,
            value: s.value,
          },
        });
      }
    });

    await this.pool.restartBot(newBot.id);
    this.logger.log(`Cloned bot ${botId} -> ${newBot.id} (@${check.bot.username})`);
    return this.findOne(newBot.id);
  }

  /**
   * Exports full configuration bundle of a bot (excluding sensitive credentials).
   */
  async exportConfig(botId: string): Promise<Record<string, unknown>> {
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
        const parsedConfig = safeJsonObjectParse(
          m.configJson,
          {},
          `export:${botId}:${m.moduleKey}`,
        );
        if (m.moduleKey === 'ai-assistant') {
          delete parsedConfig.apiKey;
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
        chatId: a.chatId,
        scope: a.scope,
        matchMode: a.matchMode,
        adminOnly: a.adminOnly,
        repeatSeconds: a.repeatSeconds,
        deletePreviousResponse: a.deletePreviousResponse,
        replyToMessage: a.replyToMessage,
        mediaBase64: a.mediaData ? Buffer.from(a.mediaData).toString('base64') : null,
        mediaMime: a.mediaMime,
        mediaFileName: a.mediaFileName,
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
   * Imports a configuration bundle into an existing bot. Idempotent: modules
   * and chat overrides upsert by natural key, autoresponders/drips/mini apps
   * match by command/name and update in place instead of duplicating. Mini
   * Apps — historically dropped by the importer — are restored. The whole
   * bundle applies in one transaction; a failure leaves the bot untouched.
   */
  async importConfig(
    botId: string,
    bundle: Record<string, unknown>,
  ): Promise<{
    success: boolean;
    importedModules: number;
    importedAutoresponders: number;
    importedDrips: number;
    importedMiniApps: number;
  }> {
    const bot = await this.botModel.findById(botId);
    if (!bot) this.throwNotFound(botId);

    // Bundle contract: refuse unknown/absent versions instead of applying a
    // shape the importer does not understand (a partial import is worse than
    // a loud failure).
    const version = String(bundle.version ?? '');
    if (!['1.0', '1.1'].includes(version)) {
      throw new StudioException(
        'IMPORT_UNSUPPORTED_VERSION',
        `Unsupported export bundle version: ${version || '(missing)'} — re-export the bot with the current studio version`,
      );
    }

    let moduleCount = 0;
    let autoresponderCount = 0;
    let dripCount = 0;
    let miniAppCount = 0;

    await this.prisma.$transaction(async (tx) => {
      if (Array.isArray(bundle.modules)) {
        for (const m of bundle.modules) {
          if (!m || typeof m !== 'object' || !('moduleKey' in m)) continue;
          const moduleKey = String((m as Record<string, unknown>).moduleKey);
          // Unknown keys would create dead rows the runtime can never attach.
          if (!findModule(moduleKey)) continue;
          const config = (m as Record<string, unknown>).config;
          const configJson = config ? JSON.stringify(config) : null;
          await tx.botModule.upsert({
            where: { botId_moduleKey: { botId, moduleKey } },
            create: {
              botId,
              moduleKey,
              isEnabled: Number((m as Record<string, unknown>).isEnabled) || 0,
              configJson,
            },
            update: {
              isEnabled: Number((m as Record<string, unknown>).isEnabled) || 0,
              configJson,
            },
          });
          moduleCount++;
        }
      }

      if (Array.isArray(bundle.autoresponders)) {
        for (const a of bundle.autoresponders) {
          if (!a || typeof a !== 'object' || !('command' in a)) continue;
          const row = a as Record<string, unknown>;
          const command = String(row.command);
          const data = {
            responseText: String(row.responseText ?? ''),
            mediaUrl: row.mediaUrl ? String(row.mediaUrl) : null,
            buttonsJson: row.buttonsJson ? String(row.buttonsJson) : null,
            isActive: Number(row.isActive ?? 1),
            chatId: row.chatId ? String(row.chatId) : null,
            scope: String(row.scope ?? 'all'),
            matchMode: String(row.matchMode ?? 'keyword'),
            adminOnly: Number(row.adminOnly ?? 0),
            repeatSeconds: Number(row.repeatSeconds ?? 0),
            deletePreviousResponse: Number(
              row.deletePreviousResponse ?? row.delete_previous_response ?? 0,
            ),
            replyToMessage: Number(
              row.replyToMessage === true ||
                row.replyToMessage === 1 ||
                row.reply_to_message === true ||
                row.reply_to_message === 1
                ? 1
                : 0,
            ),
            ...(row.mediaBase64
              ? {
                  mediaData: Buffer.from(String(row.mediaBase64), 'base64'),
                  mediaMime: row.mediaMime ? String(row.mediaMime) : null,
                  mediaFileName: row.mediaFileName ? String(row.mediaFileName) : null,
                }
              : {}),
          };
          const existing = await tx.autoresponder.findFirst({
            where: { botId, command },
            orderBy: { id: 'asc' },
          });
          if (existing) {
            await tx.autoresponder.update({ where: { id: existing.id }, data });
          } else {
            await tx.autoresponder.create({ data: { botId, command, ...data } });
          }
          autoresponderCount++;
        }
      }

      if (Array.isArray(bundle.dripCampaigns)) {
        for (const d of bundle.dripCampaigns) {
          if (!d || typeof d !== 'object') continue;
          const row = d as Record<string, unknown>;
          const name = String(row.name ?? 'Imported Drip');
          const data = {
            stepsJson: String(row.stepsJson ?? '[]'),
            isActive: Number(row.isActive ?? 1),
          };
          const existing = await tx.dripCampaign.findFirst({
            where: { botId, name },
            orderBy: { id: 'asc' },
          });
          if (existing) {
            await tx.dripCampaign.update({ where: { id: existing.id }, data });
          } else {
            await tx.dripCampaign.create({ data: { botId, name, ...data } });
          }
          dripCount++;
        }
      }

      if (Array.isArray(bundle.miniApps)) {
        for (const a of bundle.miniApps) {
          if (!a || typeof a !== 'object' || !('name' in a)) continue;
          const row = a as Record<string, unknown>;
          const name = String(row.name);
          const data = {
            templateType: String(row.templateType ?? 'webview'),
            title: String(row.title ?? name),
            description: row.description ? String(row.description) : null,
            configJson: row.configJson ? String(row.configJson) : null,
            themeJson: row.themeJson ? String(row.themeJson) : null,
            isActive: Number(row.isActive ?? 1),
          };
          const existing = await tx.miniApp.findFirst({
            where: { botId, name },
            orderBy: { id: 'asc' },
          });
          if (existing) {
            await tx.miniApp.update({ where: { id: existing.id }, data });
          } else {
            // Slugs are globally unique — derive a fresh one per import.
            const base =
              name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 32) || 'app';
            const slug = `bot${botId}-${base}-${Date.now().toString(36)}-${Math.random()
              .toString(36)
              .slice(2, 6)}`;
            await tx.miniApp.create({ data: { botId, name, slug, ...data } });
          }
          miniAppCount++;
        }
      }

      if (Array.isArray(bundle.chatModuleSettings)) {
        for (const c of bundle.chatModuleSettings) {
          if (!c || typeof c !== 'object' || !('chatId' in c)) continue;
          const row = c as Record<string, unknown>;
          const chatId = String(row.chatId);
          const moduleKey = String(row.moduleKey ?? '');
          if (!findModule(moduleKey)) continue;
          await tx.chatModuleSetting.upsert({
            where: {
              botId_chatId_moduleKey: { botId, chatId, moduleKey },
            },
            create: {
              botId,
              chatId,
              moduleKey,
              configJson: String(row.configJson ?? '{}'),
            },
            update: { configJson: String(row.configJson ?? '{}') },
          });
        }
      }
    });

    this.chatSettings.invalidate(botId);
    await this.pool.restartBot(botId);
    this.logger.log(
      `Imported configuration bundle into bot ${botId}: ${moduleCount} modules, ` +
        `${autoresponderCount} autoresponders, ${dripCount} drips, ${miniAppCount} mini apps`,
    );
    return {
      success: true,
      importedModules: moduleCount,
      importedAutoresponders: autoresponderCount,
      importedDrips: dripCount,
      importedMiniApps: miniAppCount,
    };
  }
}
