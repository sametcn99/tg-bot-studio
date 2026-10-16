/**
 * Pure model for the visual flow editor: node contract, port/edge derivation,
 * graph mutations, tidy auto-layout, and canvas geometry. Rendering-free so it
 * can be reasoned about (and later tested) in isolation.
 * @module pages/modules/flow-editor/flowEditorModel
 */

/** One node of a flow graph (client mirror of the server contract). */
export interface FlowNode {
  id: string;
  type: 'message' | 'input' | 'condition' | 'delay' | 'settag' | 'end';
  text?: string;
  mediaUrl?: string;
  buttons?: Array<{ text: string; url?: string; next?: string }>;
  variable?: string;
  op?: 'equals' | 'contains' | 'exists';
  value?: string;
  nextTrue?: string;
  nextFalse?: string;
  next?: string;
  minutes?: number;
  tag?: string;
  /** Canvas position persisted alongside the flow; ignored by the runtime. */
  x?: number;
  /** Canvas position persisted alongside the flow; ignored by the runtime. */
  y?: number;
}

/** Flow graph document. */
export interface FlowGraph {
  start: string;
  nodes: FlowNode[];
}

/** Fields of a node that can point at another node. */
export type WireField = 'next' | 'nextTrue' | 'nextFalse' | 'button';

/** Pseudo-node id used for the draggable trigger entry card. */
export const TRIGGER_NODE_ID = '__trigger__';

/** Canvas card width for regular nodes. */
export const NODE_WIDTH = 252;

/** Canvas card width for the trigger entry card. */
export const TRIGGER_WIDTH = 200;

/** Accent color per node type — works on both light and dark canvases. */
export const NODE_COLORS: Record<FlowNode['type'], string> = {
  message: '#2563eb',
  input: '#7c3aed',
  condition: '#d97706',
  delay: '#0891b2',
  settag: '#16a34a',
  end: '#64748b',
};

/** One output port of a node card. */
export interface PortDesc {
  field: WireField;
  /** Button row index when `field === 'button'`. */
  buttonIndex?: number;
  /** Short label rendered next to the port circle. */
  label: string;
}

/** One resolved connection between two nodes. */
export interface FlowEdge {
  id: string;
  from: string;
  field: WireField;
  buttonIndex?: number;
  to: string;
}

/**
 * Generates a short, readable node id.
 * @returns {string} Unique-enough id for canvas lifetime.
 */
export function newNodeId(): string {
  return `n${Math.random().toString(36).slice(2, 8)}`;
}

/** Module-scoped edit revision — bumped on every committed graph change. */
let editRevision = 0;

/**
 * Bumps and returns the monotonically increasing edit revision. The editor
 * shell calls this on every mutation instead of serializing the whole graph
 * for dirty tracking; `dirty` is then `currentRevision() !== savedRevision`.
 * @returns {number} The new revision.
 */
export function bumpRevision(): number {
  editRevision += 1;
  return editRevision;
}

/**
 * Reads the current edit revision without bumping it.
 * @returns {number} Current revision.
 */
export function currentRevision(): number {
  return editRevision;
}

/**
 * Builds a blank node of the given type.
 * @param {FlowNode['type']} type - Node type to create.
 * @returns {FlowNode} Node with type-appropriate defaults.
 */
export function blankNode(type: FlowNode['type']): FlowNode {
  const base: FlowNode = { id: newNodeId(), type };
  if (type === 'message' || type === 'input') return { ...base, text: '', buttons: [] };
  if (type === 'condition') return { ...base, variable: '', op: 'equals', value: '' };
  if (type === 'delay') return { ...base, minutes: 5 };
  if (type === 'settag') return { ...base, tag: '' };
  return base;
}

/**
 * Lists the output ports of a node. URL buttons open links instead of
 * navigating, so only flow buttons receive ports.
 * @param {FlowNode} node - Node to inspect.
 * @param {(key: string) => string} t - Translator for port labels.
 * @returns {PortDesc[]} Ordered port descriptors.
 */
export function outputPorts(node: FlowNode, t: (key: string) => string): PortDesc[] {
  if (node.type === 'condition') {
    return [
      { field: 'nextTrue', label: t('flows.trueBranch') },
      { field: 'nextFalse', label: t('flows.falseBranch') },
    ];
  }
  if (node.type === 'message' || node.type === 'input') {
    const ports: PortDesc[] = (node.buttons ?? [])
      .map((button, index) => ({ button, index }))
      .filter(({ button }) => !button.url)
      .map(({ button, index }) => ({
        field: 'button' as const,
        buttonIndex: index,
        label: button.text || t('flows.buttonText'),
      }));
    ports.push({
      field: 'next',
      label: t(node.type === 'input' ? 'flows.awaitReply' : 'flows.autoContinue'),
    });
    return ports;
  }
  if (node.type === 'end') return [];
  return [{ field: 'next', label: t('flows.nextNode') }];
}

/**
 * Reads where a wire field points.
 * @param {FlowNode} node - Source node.
 * @param {WireField} field - Wire field.
 * @param {number} [buttonIndex] - Button row for `field === 'button'`.
 * @returns {string | undefined} Target node id when wired.
 */
export function getWireTarget(
  node: FlowNode,
  field: WireField,
  buttonIndex?: number,
): string | undefined {
  if (field === 'button') return node.buttons?.[buttonIndex ?? -1]?.next;
  return node[field] as string | undefined;
}

/**
 * Returns a copy of the node with one wire field repointed.
 * @param {FlowNode} node - Node to patch.
 * @param {WireField} field - Wire field.
 * @param {string | undefined} target - New target id (undefined unwires).
 * @param {number} [buttonIndex] - Button row for `field === 'button'`.
 * @returns {FlowNode} Patched node copy.
 */
export function setWireTarget(
  node: FlowNode,
  field: WireField,
  target: string | undefined,
  buttonIndex?: number,
): FlowNode {
  if (field === 'button') {
    const buttons = [...(node.buttons ?? [])];
    if (buttonIndex !== undefined && buttons[buttonIndex]) {
      buttons[buttonIndex] = { ...buttons[buttonIndex], next: target };
    }
    return { ...node, buttons };
  }
  return { ...node, [field]: target } as FlowNode;
}

/**
 * Collects every resolved edge of the graph.
 * @param {FlowGraph} graph - Flow graph.
 * @returns {FlowEdge[]} Edges keyed by source node + field.
 */
export function collectEdges(graph: FlowGraph): FlowEdge[] {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const edges: FlowEdge[] = [];
  for (const node of graph.nodes) {
    for (const port of outputPorts(node, () => '')) {
      const target = getWireTarget(node, port.field, port.buttonIndex);
      if (target && nodeIds.has(target)) {
        edges.push({
          id: `${node.id}:${port.field}:${port.buttonIndex ?? ''}`,
          from: node.id,
          field: port.field,
          buttonIndex: port.buttonIndex,
          to: target,
        });
      }
    }
  }
  return edges;
}

/**
 * Clears every reference to a node id across the graph (nodes, start, buttons).
 * @param {FlowGraph} graph - Graph to clean.
 * @param {string} id - Node id being removed.
 * @returns {FlowGraph} Graph without the node or its references.
 */
export function removeReferencesTo(graph: FlowGraph, id: string): FlowGraph {
  return {
    start:
      graph.start === id ? (graph.nodes.find((node) => node.id !== id)?.id ?? '') : graph.start,
    nodes: graph.nodes
      .filter((node) => node.id !== id)
      .map((node) => {
        let copy = node;
        for (const field of ['next', 'nextTrue', 'nextFalse'] as const) {
          if (copy[field] === id) copy = setWireTarget(copy, field, undefined);
        }
        if (copy.buttons?.some((button) => button.next === id)) {
          copy = {
            ...copy,
            buttons: copy.buttons.map((button) =>
              button.next === id ? { ...button, next: undefined } : button,
            ),
          };
        }
        return copy;
      }),
  };
}

/**
 * Duplicates a node with a fresh id and all definition fields copied.
 * @param {FlowNode} node - Node to clone.
 * @returns {FlowNode} Clone offset below the original.
 */
export function duplicateNode(node: FlowNode): FlowNode {
  return {
    ...node,
    id: newNodeId(),
    x: (node.x ?? 0) + 40,
    y: (node.y ?? 0) + 60,
  };
}

/**
 * Rough card height estimate used for layout spacing and viewport fitting.
 * @param {FlowNode} node - Node to measure.
 * @returns {number} Estimated pixel height.
 */
export function estimateNodeHeight(node: FlowNode): number {
  let height = 52;
  if (node.type === 'message' || node.type === 'input') {
    if ((node.text ?? '').trim()) height += 42;
    height += (node.buttons ?? []).length * 34 + ((node.buttons ?? []).length ? 10 : 0);
  }
  if (node.type === 'condition') height += 30;
  return height;
}

/**
 * BFS depth of every reachable node from the start entry.
 * @param {FlowGraph} graph - Flow graph.
 * @returns {Map<string, number>} Node id -> hop count from the entry.
 */
function depthMap(graph: FlowGraph): Map<string, number> {
  const depths = new Map<string, number>();
  if (!graph.start || !graph.nodes.some((node) => node.id === graph.start)) return depths;
  const queue = [graph.start];
  depths.set(graph.start, 0);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const node = graph.nodes.find((item) => item.id === id);
    if (!node) continue;
    for (const port of outputPorts(node, () => '')) {
      const target = getWireTarget(node, port.field, port.buttonIndex);
      if (target && !depths.has(target) && graph.nodes.some((item) => item.id === target)) {
        depths.set(target, (depths.get(id) ?? 0) + 1);
        queue.push(target);
      }
    }
  }
  return depths;
}

/**
 * Computes a tidy left-to-right layout: one column per BFS depth, stacked
 * vertically, with unreachable nodes parked in a trailing column.
 * @param {FlowGraph} graph - Graph to position.
 * @returns {FlowGraph} Copy with `x`/`y` assigned to every node.
 */
export function autoLayout(graph: FlowGraph): FlowGraph {
  const depths = depthMap(graph);
  const columns = new Map<number, string[]>();
  const orphans: string[] = [];
  for (const node of graph.nodes) {
    const depth = depths.get(node.id);
    if (depth === undefined) {
      orphans.push(node.id);
    } else {
      const column = columns.get(depth) ?? [];
      column.push(node.id);
      columns.set(depth, column);
    }
  }
  const maxDepth = Math.max(-1, ...columns.keys());
  if (orphans.length > 0) columns.set(maxDepth + 1, orphans);

  const heights = new Map(graph.nodes.map((node) => [node.id, estimateNodeHeight(node)]));
  const positions = new Map<string, { x: number; y: number }>();
  let columnX = 80;
  let maxColumnHeight = 0;
  for (const depth of [...columns.keys()].sort((a, b) => a - b)) {
    const ids = columns.get(depth) ?? [];
    let y = 80;
    for (const id of ids) {
      positions.set(id, { x: columnX, y });
      y += (heights.get(id) ?? 80) + 56;
    }
    maxColumnHeight = Math.max(maxColumnHeight, y);
    columnX += NODE_WIDTH + 130;
  }
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      ...(positions.get(node.id) ?? { x: node.x ?? 0, y: node.y ?? 0 }),
    })),
  };
}

/**
 * Bounding box of positioned nodes (plus the trigger card when included).
 * @param {FlowGraph} graph - Graph to measure.
 * @param {{ x: number; y: number }} [triggerPos] - Trigger card position.
 * @returns {{ minX: number; minY: number; maxX: number; maxY: number } | null} Box or null when empty.
 */
export function graphBounds(
  graph: FlowGraph,
  triggerPos?: { x: number; y: number },
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const boxes = graph.nodes
    .filter((node) => node.x !== undefined && node.y !== undefined)
    .map((node) => ({
      minX: node.x as number,
      minY: node.y as number,
      maxX: (node.x as number) + NODE_WIDTH,
      maxY: (node.y as number) + estimateNodeHeight(node),
    }));
  if (triggerPos) {
    boxes.push({
      minX: triggerPos.x,
      minY: triggerPos.y,
      maxX: triggerPos.x + TRIGGER_WIDTH,
      maxY: triggerPos.y + 92,
    });
  }
  if (boxes.length === 0) return null;
  return {
    minX: Math.min(...boxes.map((box) => box.minX)),
    minY: Math.min(...boxes.map((box) => box.minY)),
    maxX: Math.max(...boxes.map((box) => box.maxX)),
    maxY: Math.max(...boxes.map((box) => box.maxY)),
  };
}

/**
 * Horizontal-handle cubic bezier path between two canvas points.
 * @param {number} x1 - Source x.
 * @param {number} y1 - Source y.
 * @param {number} x2 - Target x.
 * @param {number} y2 - Target y.
 * @returns {string} SVG path `d` attribute.
 */
export function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const handle = Math.max(48, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + handle} ${y1}, ${x2 - handle} ${y2}, ${x2} ${y2}`;
}

/**
 * Point on a horizontal-handle cubic bezier at parameter `t` (for edge labels
 * and delete affordances).
 * @param {number} x1 - Source x.
 * @param {number} y1 - Source y.
 * @param {number} x2 - Target x.
 * @param {number} y2 - Target y.
 * @param {number} t - Curve parameter in [0, 1].
 * @returns {{ x: number; y: number }} Point on the curve.
 */
export function bezierPoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  t: number,
): { x: number; y: number } {
  const handle = Math.max(48, Math.abs(x2 - x1) * 0.45);
  const c1x = x1 + handle;
  const c1y = y1;
  const c2x = x2 - handle;
  const c2y = y2;
  const u = 1 - t;
  const x = u * u * u * x1 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x2;
  const y = u * u * u * y1 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y2;
  return { x, y };
}

/**
 * True when every node has explicit canvas coordinates.
 * @param {FlowGraph} graph - Graph to check.
 * @returns {boolean} False when any node lacks `x`/`y`.
 */
export function isFullyPositioned(graph: FlowGraph): boolean {
  return (
    graph.nodes.length > 0 &&
    graph.nodes.every((node) => node.x !== undefined && node.y !== undefined)
  );
}
