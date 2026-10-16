import { Injectable } from '@nestjs/common';
import type { Flow, FlowState } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { FlowGraph } from './flow.entity';

/**
 * Model managing flow definitions and per-user flow sessions via Prisma.
 */
@Injectable()
export class FlowModel {
  /**
   * @param {PrismaService} prisma - Prisma ORM access service.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Parses a stored graph JSON with graceful fallback to an empty graph.
   * @param {string | null} raw - Stored `graph_json`.
   * @returns {FlowGraph} Parsed graph.
   */
  parseGraph(raw: string | null): FlowGraph {
    if (!raw) return { start: '', nodes: [] };
    try {
      const parsed = JSON.parse(raw) as FlowGraph;
      if (!parsed || !Array.isArray(parsed.nodes)) return { start: '', nodes: [] };
      return { start: String(parsed.start ?? ''), nodes: parsed.nodes };
    } catch {
      return { start: '', nodes: [] };
    }
  }

  /**
   * Lists flow definitions of a bot.
   * @param {number} botId - Owning bot id.
   * @returns {Promise<Flow[]>} Flow rows, newest first.
   */
  async list(botId: number): Promise<Flow[]> {
    return this.prisma.flow.findMany({ where: { botId }, orderBy: { id: 'desc' } });
  }

  /**
   * Finds one flow scoped to its bot.
   */
  async findById(botId: number, id: number): Promise<Flow | null> {
    return this.prisma.flow.findFirst({ where: { id, botId } });
  }

  /**
   * Finds an active flow triggered by a private-chat command or keyword.
   * @param {number} botId - Owning bot id.
   * @param {'command' | 'keyword' | 'start'} triggerType - Trigger kind.
   * @param {string} triggerValue - Normalized trigger text.
   * @returns {Promise<Flow | null>} Matching active flow.
   */
  async findByTrigger(
    botId: number,
    triggerType: 'command' | 'keyword' | 'start',
    triggerValue: string,
  ): Promise<Flow | null> {
    return this.prisma.flow.findFirst({
      where: { botId, isActive: 1, triggerType, triggerValue },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Creates a flow.
   */
  async create(data: {
    botId: number;
    name: string;
    triggerType: string;
    triggerValue: string;
    graphJson: string;
  }): Promise<Flow> {
    const now = new Date().toISOString();
    return this.prisma.flow.create({ data: { ...data, createdAt: now, updatedAt: now } });
  }

  /**
   * Updates flow definition fields.
   */
  async update(botId: number, id: number, data: Partial<Flow>): Promise<Flow> {
    return this.prisma.flow.update({
      where: { id },
      data: { ...data, updatedAt: new Date().toISOString() },
    });
  }

  /**
   * Deletes a flow and (by cascade) its sessions.
   */
  async remove(botId: number, id: number): Promise<void> {
    await this.prisma.flow.deleteMany({ where: { id, botId } });
  }

  /**
   * Reads the session of a user inside a flow.
   */
  async findState(flowId: number, telegramId: bigint): Promise<FlowState | null> {
    return this.prisma.flowState.findUnique({
      where: { flowId_telegramId: { flowId, telegramId } },
    });
  }

  /**
   * Upserts the session position of a user.
   */
  async saveState(data: {
    botId: number;
    flowId: number;
    telegramId: bigint;
    nodeId: string;
    waitInput: number;
    varsJson?: string | null;
    resumeAt?: string | null;
  }): Promise<FlowState> {
    return this.prisma.flowState.upsert({
      where: {
        flowId_telegramId: { flowId: data.flowId, telegramId: data.telegramId },
      },
      create: {
        botId: data.botId,
        flowId: data.flowId,
        telegramId: data.telegramId,
        nodeId: data.nodeId,
        waitInput: data.waitInput,
        varsJson: data.varsJson ?? null,
        resumeAt: data.resumeAt ?? null,
        updatedAt: new Date().toISOString(),
      },
      update: {
        nodeId: data.nodeId,
        waitInput: data.waitInput,
        varsJson: data.varsJson ?? null,
        resumeAt: data.resumeAt ?? null,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Removes the session of a user inside a flow.
   */
  async clearState(flowId: number, telegramId: bigint): Promise<void> {
    await this.prisma.flowState
      .delete({ where: { flowId_telegramId: { flowId, telegramId } } })
      .catch(() => undefined);
  }

  /**
   * Lists sessions whose delay elapsed, across every active flow of a bot.
   * @param {number} botId - Owning bot id.
   * @param {string} nowIso - Current time (ISO).
   * @returns {Promise<Array<{state: FlowState; flow: Flow}>>} Due continuations.
   */
  async findDueStates(
    botId: number,
    nowIso: string,
  ): Promise<Array<{ state: FlowState; flow: Flow }>> {
    const states = await this.prisma.flowState.findMany({
      where: { botId, resumeAt: { not: null, lte: nowIso } },
      take: 200,
    });
    if (states.length === 0) return [];
    const flowIds = [...new Set(states.map((s) => s.flowId))];
    const flows = await this.prisma.flow.findMany({
      where: { id: { in: flowIds }, isActive: 1 },
    });
    const byId = new Map(flows.map((f) => [f.id, f]));
    return states
      .map((state) => {
        const flow = byId.get(state.flowId);
        return flow ? { state, flow } : null;
      })
      .filter((pair): pair is { state: FlowState; flow: Flow } => pair !== null);
  }

  /**
   * Deletes every session of a flow (used on flow redefinition).
   */
  async clearFlowStates(flowId: number): Promise<void> {
    await this.prisma.flowState.deleteMany({ where: { flowId } });
  }
}
