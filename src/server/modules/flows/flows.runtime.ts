import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { BotModuleHandler, type ModuleRuntimeContext } from '../../bot-engine/bot-module-handler';
import { ModuleHandlerRegistry } from '../../bot-engine/module-handler-registry';
import { FlowModel } from './flow.model';
import { type FlowGraph, type FlowNode } from './flow.entity';
import { PrismaService } from '../../database/prisma.service';
import { renderTemplate } from '../../common/utils/template.util';

/** Callback data prefix routing button presses back into the flow engine. */
const CALLBACK_PREFIX = 'flow:';

/** Safety cap for graph walks (protects against accidental cycles). */
const MAX_STEPS = 50;

/**
 * Visual flow builder runtime. Executes studio-designed conversation trees:
 * commands/keywords/`/start` start a per-user session, message nodes reply,
 * input nodes capture text, condition nodes branch on captured variables,
 * delay nodes schedule continuation, and tag nodes segment the audience.
 *
 * Session state is persistent, so flows survive restarts and run entirely on
 * the live bot AND in the sandbox simulator (same middleware chain).
 */
@Injectable()
export class FlowsRuntime extends BotModuleHandler implements OnModuleDestroy {
  /** Registry key of the module. */
  readonly moduleKey = 'flows';

  private readonly logger = new Logger(FlowsRuntime.name);
  private readonly tickers = new Map<number, ReturnType<typeof setInterval>>();

  /**
   * @param {FlowModel} flowModel - Flow + session persistence.
   * @param {PrismaService} prisma - Prisma ORM access service.
   * @param {ModuleHandlerRegistry} registry - Handler registry (self sign-up).
   */
  constructor(
    private readonly flowModel: FlowModel,
    private readonly prisma: PrismaService,
    registry: ModuleHandlerRegistry,
  ) {
    super();
    registry.register(this);
  }

  /**
   * Attaches flow middleware to the bot: trigger matching, input capture,
   * callback navigation, and the delay sweeper.
   * @param {ModuleRuntimeContext} ctx - Runtime context with bot and config.
   * @returns {void}
   */
  register(ctx: ModuleRuntimeContext): void {
    const { bot, botId } = ctx;

    // Message pipeline: resume waiting inputs first, then trigger matching.
    bot.on(['message', 'channel_post'], async (update, next) => {
      const chat = update.chat;
      const from = update.from;
      if (!chat || chat.type !== 'private' || !from || from.is_bot) {
        await next();
        return;
      }
      const text = update.msg?.text ?? update.msg?.caption ?? '';

      // 1. Continue a waiting input node.
      const handledInput = await this.handleWaitingInput(bot, botId, from.id, text);
      if (handledInput) return;

      // 2. Match a flow trigger.
      const triggered = await this.matchTrigger(bot, botId, from.id, text);
      if (triggered) return;

      await next();
    });

    // Button navigation inside a flow.
    bot.on('callback_query:data', async (update, next) => {
      const data = update.callbackQuery.data ?? '';
      if (!data.startsWith(CALLBACK_PREFIX)) {
        await next();
        return;
      }
      const parts = data.slice(CALLBACK_PREFIX.length).split(':');
      const flowId = Number(parts[0]);
      const sourceNodeId = parts[1] ?? '';
      const buttonIndex = Number(parts[2] ?? 0);
      if (!Number.isFinite(flowId) || !update.from) {
        await update.answerCallbackQuery().catch(() => undefined);
        return;
      }
      const flow = await this.flowModel.findById(botId, flowId);
      if (!flow || flow.isActive !== 1) {
        await update.answerCallbackQuery('This flow is no longer active.').catch(() => undefined);
        return;
      }
      const graph = this.flowModel.parseGraph(flow.graphJson);
      const source = graph.nodes.find((node) => node.id === sourceNodeId);
      const targetId = source?.buttons?.[buttonIndex]?.next ?? source?.next;
      await update.answerCallbackQuery().catch(() => undefined);
      if (!targetId) {
        await this.clearSession(flowId, update.from.id);
        return;
      }
      const vars = await this.readVars(flowId, update.from.id);
      await this.executeFrom(bot, botId, flowId, graph, update.from.id, targetId, vars);
    });

    // Delay sweeper: resume flows whose wait elapsed. Clear any previous
    // ticker first — `register` runs on every restart/retry, and the old
    // interval (holding the dead Bot instance) used to leak per restart.
    // The sandbox simulator never registers a sweeper: its fake API would
    // advance REAL users' sessions without delivering anything.
    if (ctx.sandbox) return;
    const previous = this.tickers.get(botId);
    if (previous) clearInterval(previous);
    const ticker = setInterval(() => {
      void this.resumeDueFlows(bot, botId).catch((error: unknown) => {
        this.logger.warn(
          `Flow sweeper failed for bot ${botId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, 30_000);
    this.tickers.set(botId, ticker);
  }

  /**
   * Stops the delay sweeper of this bot.
   * @returns {void}
   */
  onModuleDestroy(): void {
    for (const ticker of this.tickers.values()) clearInterval(ticker);
    this.tickers.clear();
  }

  /**
   * Feeds a waiting input capture, advancing the session.
   * @returns {Promise<boolean>} True when the message was consumed.
   */
  private async handleWaitingInput(
    bot: Bot,
    botId: number,
    telegramId: number,
    text: string,
  ): Promise<boolean> {
    const states = await this.prisma.flowState.findMany({
      where: { botId, telegramId: BigInt(telegramId), waitInput: 1, resumeAt: null },
      take: 1,
    });
    const state = states[0];
    if (!state) return false;
    const flow = await this.flowModel.findById(botId, state.flowId);
    if (!flow || flow.isActive !== 1) {
      await this.flowModel.clearState(state.flowId, BigInt(telegramId));
      return false;
    }
    if (!text.trim()) return true; // swallow empty messages while waiting
    const graph = this.flowModel.parseGraph(flow.graphJson);
    const node = graph.nodes.find((item) => item.id === state.nodeId);
    if (!node) {
      await this.flowModel.clearState(flow.id, BigInt(telegramId));
      return false;
    }
    const vars = this.parseVars(state.varsJson);
    if (node.variable) vars[node.variable] = text.trim();
    await this.flowModel.saveState({
      botId,
      flowId: flow.id,
      telegramId: BigInt(telegramId),
      nodeId: node.id,
      waitInput: 0,
      varsJson: JSON.stringify(vars),
      resumeAt: null,
    });
    const nextId = node.next;
    if (!nextId) {
      await this.clearSession(flow.id, telegramId);
      return true;
    }
    await this.executeFrom(bot, botId, flow.id, graph, telegramId, nextId, vars);
    return true;
  }

  /**
   * Matches a message against active flow triggers and starts a session.
   * @returns {Promise<boolean>} True when a flow was triggered.
   */
  private async matchTrigger(
    bot: Bot,
    botId: number,
    telegramId: number,
    text: string,
  ): Promise<boolean> {
    if (!text.trim()) return false;
    const flows = await this.prisma.flow.findMany({ where: { botId, isActive: 1 } });
    const lower = text.trim().toLowerCase();
    const commandText = lower.split(/[\s@]/)[0];

    for (const flow of flows) {
      const triggerValue = flow.triggerValue.trim().toLowerCase();
      if (flow.triggerType === 'command') {
        const isCommand =
          triggerValue.startsWith('/') &&
          !triggerValue.includes(' ') &&
          triggerValue === commandText;
        if (!isCommand) continue;
      } else if (flow.triggerType === 'keyword') {
        if (!triggerValue || !lower.includes(triggerValue)) continue;
      } else if (flow.triggerType === 'start') {
        if (commandText !== '/start') continue;
      } else {
        continue;
      }

      const graph = this.flowModel.parseGraph(flow.graphJson);
      if (!graph.start) continue;
      await this.flowModel.clearState(flow.id, BigInt(telegramId));
      await this.executeFrom(bot, botId, flow.id, graph, telegramId, graph.start, {});
      return true;
    }
    return false;
  }

  /**
   * Resumes every session whose delay node elapsed.
   */
  private async resumeDueFlows(bot: Bot, botId: number): Promise<void> {
    try {
      const due = await this.flowModel.findDueStates(botId, new Date().toISOString());
      for (const { state, flow } of due) {
        const graph = this.flowModel.parseGraph(flow.graphJson);
        const vars = this.parseVars(state.varsJson);
        await this.flowModel.saveState({
          botId,
          flowId: flow.id,
          telegramId: state.telegramId,
          nodeId: state.nodeId,
          waitInput: 0,
          varsJson: state.varsJson,
          resumeAt: null,
        });
        await this.executeFrom(
          bot,
          botId,
          flow.id,
          graph,
          Number(state.telegramId),
          state.nodeId,
          vars,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Flow resume sweep failed on bot ${botId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Walks the graph starting at `startNodeId`, executing nodes until the
   * session pauses (input/delay) or ends.
   */
  private async executeFrom(
    bot: Bot,
    botId: number,
    flowId: number,
    graph: FlowGraph,
    telegramId: number,
    startNodeId: string,
    vars: Record<string, string>,
  ): Promise<void> {
    let currentNodeId: string | undefined = startNodeId;
    for (let step = 0; step < MAX_STEPS && currentNodeId; step++) {
      const node = graph.nodes.find((item) => item.id === currentNodeId);
      if (!node) break;

      if (node.type === 'message' || node.type === 'input') {
        const context = await this.buildContext(botId, telegramId, vars);
        const text = renderTemplate(node.text ?? '', context);
        const buttons = node.buttons ?? [];
        if (node.type === 'message') {
          await this.sendFlowMessage(bot, telegramId, text, node.mediaUrl, flowId, node, buttons);
          currentNodeId = node.next;
        } else {
          await this.sendFlowMessage(bot, telegramId, text, node.mediaUrl, flowId, node, buttons);
          await this.flowModel.saveState({
            botId,
            flowId,
            telegramId: BigInt(telegramId),
            nodeId: node.id,
            waitInput: 1,
            varsJson: JSON.stringify(vars),
            resumeAt: null,
          });
          return; // pause until the next user message
        }
      } else if (node.type === 'condition') {
        const variableValue = vars[node.variable ?? ''] ?? '';
        const expected = node.value ?? '';
        let branch: boolean;
        if (node.op === 'exists') branch = variableValue.length > 0;
        else if (node.op === 'contains')
          branch = variableValue.toLowerCase().includes(expected.toLowerCase());
        else branch = variableValue.toLowerCase() === expected.toLowerCase();
        currentNodeId = branch
          ? (node.nextTrue ?? node.nextFalse)
          : (node.nextFalse ?? node.nextTrue);
      } else if (node.type === 'delay') {
        const minutes = Math.max(1, Number(node.minutes ?? 1));
        const resumeAt = new Date(Date.now() + minutes * 60_000).toISOString();
        const nextId = node.next;
        if (!nextId) {
          await this.clearSession(flowId, telegramId);
          return;
        }
        await this.flowModel.saveState({
          botId,
          flowId,
          telegramId: BigInt(telegramId),
          nodeId: nextId,
          waitInput: 0,
          varsJson: JSON.stringify(vars),
          resumeAt,
        });
        return; // pause until the sweeper resumes
      } else if (node.type === 'settag') {
        await this.addTag(botId, telegramId, node.tag ?? '');
        currentNodeId = node.next;
      } else {
        // 'end' or unknown type: conclude the session.
        await this.clearSession(flowId, telegramId);
        return;
      }
    }
    await this.clearSession(flowId, telegramId);
  }

  /**
   * Sends one flow message with optional media and flow-navigation buttons.
   */
  private async sendFlowMessage(
    bot: Bot,
    telegramId: number,
    text: string,
    mediaUrl: string | undefined,
    flowId: number,
    node: FlowNode,
    buttons: Array<{ text: string; url?: string; next?: string }>,
  ): Promise<void> {
    let markup: InlineKeyboard | undefined;
    if (buttons.length > 0) {
      const keyboard = new InlineKeyboard();
      for (let index = 0; index < buttons.length; index++) {
        const button = buttons[index];
        if (button.url) {
          keyboard.url(button.text.slice(0, 64), button.url);
        } else {
          keyboard.text(
            button.text.slice(0, 64),
            `${CALLBACK_PREFIX}${flowId}:${node.id}:${index}`,
          );
        }
        keyboard.row();
      }
      markup = keyboard;
    }

    const media = (mediaUrl ?? '').trim();
    try {
      if (media) {
        const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(media);
        if (isVideo) {
          await bot.api.sendVideo(telegramId, media, {
            caption: text || undefined,
            parse_mode: 'HTML',
            reply_markup: markup,
          });
        } else {
          await bot.api.sendPhoto(telegramId, media, {
            caption: text || undefined,
            parse_mode: 'HTML',
            reply_markup: markup,
          });
        }
        return;
      }
      if (text.trim()) {
        await bot.api.sendMessage(telegramId, text, {
          parse_mode: 'HTML',
          reply_markup: markup,
        });
      } else if (markup) {
        await bot.api.sendMessage(telegramId, '…', { reply_markup: markup });
      }
    } catch (error) {
      // Media delivery can fail (expired file_id, unreachable URL); fall back
      // to plain text so the conversation never stalls.
      this.logger.warn(
        `Flow message media delivery failed (flow ${flowId}, node ${node.id}): ${error instanceof Error ? error.message : String(error)}`,
      );
      if (text.trim()) {
        await bot.api
          .sendMessage(telegramId, text, { parse_mode: 'HTML', reply_markup: markup })
          .catch(() => undefined);
      }
    }
  }

  /**
   * Builds the placeholder context from the user row plus flow variables.
   */
  private async buildContext(
    botId: number,
    telegramId: number,
    vars: Record<string, string>,
  ): Promise<Record<string, string>> {
    const user = await this.prisma.botUser.findUnique({
      where: { botId_telegramId: { botId, telegramId: BigInt(telegramId) } },
    });
    const context: Record<string, string> = {
      ...vars,
      user_id: String(telegramId),
      date: new Date().toISOString().slice(0, 10),
      time: new Date().toISOString().slice(11, 16),
      first_name: user?.firstName ?? '',
      last_name: user?.lastName ?? '',
      username: user?.username ?? '',
      mention: user?.username
        ? `@${user.username}`
        : `<a href="tg://user?id=${telegramId}">${user?.firstName ?? telegramId}</a>`,
      points: String(user?.points ?? 0),
    };
    return context;
  }

  /**
   * Appends a CRM tag to the user's tag list.
   */
  private async addTag(botId: number, telegramId: number, tag: string): Promise<void> {
    const clean = tag.trim();
    if (!clean) return;
    const user = await this.prisma.botUser.findUnique({
      where: { botId_telegramId: { botId, telegramId: BigInt(telegramId) } },
    });
    let tags: string[] = [];
    if (user?.tagsJson) {
      try {
        const parsed = JSON.parse(user.tagsJson) as { tags?: string[] };
        tags = Array.isArray(parsed.tags) ? parsed.tags : [];
      } catch {
        tags = [];
      }
    }
    if (!tags.includes(clean)) tags.push(clean);
    await this.prisma.botUser.upsert({
      where: { botId_telegramId: { botId, telegramId: BigInt(telegramId) } },
      create: {
        botId,
        telegramId: BigInt(telegramId),
        tagsJson: JSON.stringify({ tags }),
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      },
      update: { tagsJson: JSON.stringify({ tags }) },
    });
  }

  /**
   * Parses stored session variables.
   */
  private parseVars(raw: string | null): Record<string, string> {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, String(value ?? '')]),
      );
    } catch {
      return {};
    }
  }

  /**
   * Reads the stored variables of a session (callback continuation).
   */
  private async readVars(flowId: number, telegramId: number): Promise<Record<string, string>> {
    const state = await this.flowModel.findState(flowId, BigInt(telegramId));
    return this.parseVars(state?.varsJson ?? null);
  }

  /**
   * Ends the session of a user inside a flow.
   */
  private async clearSession(flowId: number, telegramId: number): Promise<void> {
    await this.flowModel.clearState(flowId, BigInt(telegramId));
  }
}
