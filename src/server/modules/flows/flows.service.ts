import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FlowModel } from './flow.model';
import { type FlowGraph } from './flow.entity';
import { BotModel } from '../../bots/bot.model';
import { PrismaService } from '../../database/prisma.service';
import { LiveEventsService } from '../../common/live/live-events.service';

/** Valid flow node types. */
const NODE_TYPES = ['message', 'input', 'condition', 'delay', 'settag', 'end'];

/** Valid flow triggers. */
const TRIGGER_TYPES = ['command', 'keyword', 'start'];

/**
 * Flow CRUD service. Redefining a flow resets its sessions so users restart
 * cleanly on the new graph.
 */
@Injectable()
export class FlowsService {
  /**
   * @param {FlowModel} flowModel - Flow persistence model.
   * @param {BotModel} botModel - Bot existence checks.
   * @param {PrismaService} prisma - Prisma ORM access service.
   * @param {LiveEventsService} live - Live change bus for SSE pings.
   */
  constructor(
    private readonly flowModel: FlowModel,
    private readonly botModel: BotModel,
    private readonly prisma: PrismaService,
    private readonly live: LiveEventsService,
  ) {}

  /**
   * Lists flows of a bot with parsed graph summaries.
   */
  async list(botId: number) {
    const flows = await this.flowModel.list(botId);
    return flows.map((flow) => ({
      id: flow.id,
      botId: flow.botId,
      name: flow.name,
      triggerType: flow.triggerType,
      triggerValue: flow.triggerValue,
      isActive: flow.isActive === 1,
      graph: this.flowModel.parseGraph(flow.graphJson),
      createdAt: flow.createdAt,
      updatedAt: flow.updatedAt,
    }));
  }

  /**
   * Fetches one flow with its parsed graph.
   */
  async findOne(botId: number, id: number) {
    const flow = await this.flowModel.findById(botId, id);
    if (!flow) throw new NotFoundException(`Flow ${id} not found`);
    return {
      id: flow.id,
      botId: flow.botId,
      name: flow.name,
      triggerType: flow.triggerType,
      triggerValue: flow.triggerValue,
      isActive: flow.isActive === 1,
      graph: this.flowModel.parseGraph(flow.graphJson),
      createdAt: flow.createdAt,
      updatedAt: flow.updatedAt,
    };
  }

  /**
   * Creates a flow after validating its graph.
   */
  async create(
    botId: number,
    body: Record<string, unknown>,
  ): Promise<Awaited<ReturnType<FlowsService['findOne']>>> {
    await this.botModel.findById(botId);
    const name = String(body.name ?? '').trim();
    if (!name) throw new BadRequestException('name is required');
    const { triggerType, triggerValue, graphJson } = this.parseDefinition(body);

    const created = await this.flowModel.create({
      botId,
      name,
      triggerType,
      triggerValue,
      graphJson,
    });
    this.live.emit('flows', botId);
    return this.findOne(botId, created.id);
  }

  /**
   * Updates a flow and resets its sessions.
   */
  async update(botId: number, id: number, body: Record<string, unknown>) {
    const flow = await this.flowModel.findById(botId, id);
    if (!flow) throw new NotFoundException(`Flow ${id} not found`);

    const name = body.name !== undefined ? String(body.name).trim() : flow.name;
    if (!name) throw new BadRequestException('name cannot be empty');
    const { triggerType, triggerValue, graphJson, isActive } = this.parseDefinition(
      body,
      flow.triggerType,
      flow.triggerValue,
      flow.graphJson,
      flow.isActive,
    );

    await this.flowModel.update(botId, id, {
      name,
      triggerType,
      triggerValue,
      graphJson,
      isActive,
    });
    // Redefined graphs invalidate in-flight sessions.
    await this.flowModel.clearFlowStates(id);
    this.live.emit('flows', botId);
    return this.findOne(botId, id);
  }

  /**
   * Toggles a flow without touching its definition (keeps sessions).
   */
  async setActive(botId: number, id: number, isActive: boolean) {
    const flow = await this.flowModel.findById(botId, id);
    if (!flow) throw new NotFoundException(`Flow ${id} not found`);
    await this.flowModel.update(botId, id, { isActive: isActive ? 1 : 0 });
    if (!isActive) await this.flowModel.clearFlowStates(id);
    this.live.emit('flows', botId);
    return this.findOne(botId, id);
  }

  /**
   * Deletes a flow.
   */
  async remove(botId: number, id: number) {
    await this.flowModel.remove(botId, id);
    this.live.emit('flows', botId);
    return { success: true };
  }

  /**
   * Validates and serializes the flow definition from a request payload.
   */
  private parseDefinition(
    body: Record<string, unknown>,
    defaultTriggerType = 'command',
    defaultTriggerValue = '',
    defaultGraphJson = '',
    defaultIsActive = 1,
  ): {
    triggerType: string;
    triggerValue: string;
    graphJson: string;
    isActive: number;
  } {
    const triggerType = String(body.triggerType ?? defaultTriggerType);
    if (!TRIGGER_TYPES.includes(triggerType)) {
      throw new BadRequestException(`triggerType must be one of: ${TRIGGER_TYPES.join(', ')}`);
    }
    let triggerValue = String(body.triggerValue ?? defaultTriggerValue).trim();
    if (triggerType === 'start') {
      triggerValue = '';
    } else if (triggerType === 'command') {
      triggerValue = triggerValue.toLowerCase();
      if (!triggerValue.startsWith('/') || triggerValue.includes(' ')) {
        throw new BadRequestException('command triggers must look like /my_command');
      }
    }

    const graph = (body.graph ?? body.graphJson) as FlowGraph | string | undefined;
    const graphJson =
      graph === undefined
        ? defaultGraphJson
        : typeof graph === 'string'
          ? graph
          : JSON.stringify(graph);
    const parsed = this.flowModel.parseGraph(graphJson);
    if (parsed.nodes.length > 0 && !parsed.nodes.some((node) => node.id === parsed.start)) {
      throw new BadRequestException('graph.start must reference an existing node');
    }
    for (const node of parsed.nodes) {
      if (!node.id || !NODE_TYPES.includes(node.type)) {
        throw new BadRequestException(
          `every node needs an id and a type from: ${NODE_TYPES.join(', ')}`,
        );
      }
    }

    const isActive =
      body.isActive !== undefined ? (body.isActive ? 1 : 0) : (defaultIsActive as number);
    return { triggerType, triggerValue, graphJson, isActive };
  }

  /**
   * Counts active sessions per flow for the dashboard.
   */
  async sessionCounts(botId: number): Promise<Record<number, number>> {
    const flows = await this.flowModel.list(botId);
    const counts: Record<number, number> = {};
    for (const flow of flows) {
      counts[flow.id] = await this.prisma.flowState.count({ where: { flowId: flow.id } });
    }
    return counts;
  }
}
