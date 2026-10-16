import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Box, Chip, Stack, Typography, useTheme } from '@mui/material';
import TouchAppRoundedIcon from '@mui/icons-material/TouchAppRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { useTranslation } from 'react-i18next';
import {
  NODE_COLORS,
  NODE_WIDTH,
  TRIGGER_NODE_ID,
  TRIGGER_WIDTH,
  bezierPath,
  bezierPoint,
  collectEdges,
  getWireTarget,
  graphBounds,
  outputPorts,
  type FlowGraph,
  type FlowNode,
  type PortDesc,
  type WireField,
} from './flowEditorModel';
import { NODE_ICONS, PALETTE_TYPES, NodeTypeIconTile } from './nodeVisuals';

/** Canvas viewport: translate + scale applied to the graph layer. */
export interface CanvasViewport {
  x: number;
  y: number;
  k: number;
}

/** Wire fields addressable on the canvas (trigger uses the `start` pseudo-field). */
export type CanvasWireField = WireField | 'start';

/** Connection being dragged from an output port. */
interface WireDrag {
  from: string;
  field: CanvasWireField;
  buttonIndex?: number;
  cursor: { x: number; y: number };
  hover: string | null;
  movedPx: number;
}

/** Node/trigger card drag in progress. */
interface NodeDrag {
  kind: 'node' | 'trigger' | 'pan' | 'pinch';
  pointerId: number;
  startClient: { x: number; y: number };
  startViewport: CanvasViewport;
  origins: Record<string, { x: number; y: number }>;
  moved: boolean;
  /** Pinch start geometry (kind === 'pinch'): container-local midpoint + distance. */
  pinch?: { startDist: number; startMid: { x: number; y: number } };
}

/** Quick "add node" menu opened by dropping on empty canvas. */
interface QuickMenu {
  screen: { x: number; y: number };
  graph: { x: number; y: number };
  wire: { from: string; field: CanvasWireField; buttonIndex?: number } | null;
}

/** Arrow-key nudge deltas for keyboard node movement. */
const ARROW_DELTAS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Imperative surface exposed to the editor shell. */
export interface FlowCanvasHandle {
  /** Fits the viewport around the current graph. */
  fitView: () => void;
  /** Converts screen coordinates to graph coordinates. */
  screenToGraph: (clientX: number, clientY: number) => { x: number; y: number };
  /** Creates a node of `type` dropped at the given screen position. */
  dropNodeAt: (type: FlowNode['type'], clientX: number, clientY: number) => void;
  /** Closes transient overlays (quick menu, pending wire). */
  closeOverlays: () => boolean;
}

/**
 * Interactive flow canvas: pan/zoom viewport, draggable cards, drag-to-wire
 * ports with bezier edges, a quick-add menu on empty drops, and edge deletion
 * affordances. All mutations flow up through callbacks — the canvas itself
 * only owns interaction state.
 * @param {object} props - Component props.
 * @param {FlowGraph} props.graph - Flow graph being edited.
 * @param {string} props.triggerLabel - Short trigger summary for the entry card.
 * @param {{ x: number; y: number }} props.triggerPos - Entry card position.
 * @param {(pos: { x: number; y: number }) => void} props.onTriggerPosChange - Entry card moved.
 * @param {string[]} props.selected - Selected node ids (may include the trigger id).
 * @param {(ids: string[]) => void} props.onSelect - Selection changed.
 * @param {(positions: Record<string, { x: number; y: number }>) => void} props.onNodesMove - Live node positions during a drag.
 * @param {() => void} props.onDragStart - A discrete move began (history snapshot point).
 * @param {(moved: boolean) => void} props.onDragEnd - A move ended; commits history when moved.
 * @param {(from: string, field: CanvasWireField, buttonIndex: number | undefined, to: string) => void} props.onWire - A connection was drawn.
 * @param {(from: string, field: CanvasWireField, buttonIndex?: number) => void} props.onUnwire - An edge was deleted.
 * @param {(type: FlowNode['type'], pos: { x: number; y: number }, wire: { from: string; field: CanvasWireField; buttonIndex?: number } | null) => void} props.onCreateNode - Node created from the quick menu.
 * @param {CanvasViewport} props.viewport - Current viewport.
 * @param {(viewport: CanvasViewport) => void} props.onViewportChange - Viewport changed (pan/zoom).
 * @param {boolean} props.animating - Enables position transitions (auto-layout).
 * @returns {React.ReactElement} The canvas.
 */
function FlowCanvas(
  {
    graph,
    triggerLabel,
    triggerPos,
    onTriggerPosChange,
    selected,
    onSelect,
    onNodesMove,
    onDragStart,
    onDragEnd,
    onWire,
    onUnwire,
    onCreateNode,
    viewport,
    onViewportChange,
    animating,
  }: {
    graph: FlowGraph;
    triggerLabel: string;
    triggerPos: { x: number; y: number };
    onTriggerPosChange: (pos: { x: number; y: number }) => void;
    selected: string[];
    onSelect: (ids: string[]) => void;
    onNodesMove: (positions: Record<string, { x: number; y: number }>) => void;
    onDragStart: () => void;
    onDragEnd: (moved: boolean) => void;
    onWire: (
      from: string,
      field: CanvasWireField,
      buttonIndex: number | undefined,
      to: string,
    ) => void;
    onUnwire: (from: string, field: CanvasWireField, buttonIndex?: number) => void;
    onCreateNode: (
      type: FlowNode['type'],
      pos: { x: number; y: number },
      wire: { from: string; field: CanvasWireField; buttonIndex?: number } | null,
    ) => void;
    viewport: CanvasViewport;
    onViewportChange: (viewport: CanvasViewport) => void;
    animating: boolean;
  },
  ref: React.ForwardedRef<FlowCanvasHandle>,
): React.ReactElement {
  const { t } = useTranslation();
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<NodeDrag | null>(null);
  const wireRef = useRef<WireDrag | null>(null);
  const graphRef = useRef(graph);
  const triggerPosRef = useRef(triggerPos);
  const viewportRef = useRef(viewport);

  const [wire, setWire] = useState<WireDrag | null>(null);
  const [quickMenu, setQuickMenu] = useState<QuickMenu | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [portPoints, setPortPoints] = useState<Record<string, { x: number; y: number }>>({});
  const portPointsRef = useRef<Record<string, { x: number; y: number }>>({});
  const quickMenuRef = useRef<QuickMenu | null>(null);
  /** Live multi-touch pointers for the pinch gesture (screen coordinates). */
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());

  /** Mirrors props/state into refs for event handlers (post-commit). */
  useEffect(() => {
    graphRef.current = graph;
    triggerPosRef.current = triggerPos;
    viewportRef.current = viewport;
    quickMenuRef.current = quickMenu;
  });

  const edges = useMemo(() => collectEdges(graph), [graph]);

  /** Node id -> node lookup, built once per graph change (no O(n) finds). */
  const nodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph]);

  /**
   * Port key for an output port of a node.
   */
  const outKey = useCallback((nodeId: string, field: string, index?: number): string => {
    return `${nodeId}:out:${field}:${index ?? ''}`;
  }, []);

  /**
   * Converts screen coordinates into graph coordinates.
   */
  const toGraph = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const rect = containerRef.current?.getBoundingClientRect();
    const vp = viewportRef.current;
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - vp.x) / vp.k,
      y: (clientY - rect.top - vp.y) / vp.k,
    };
  }, []);

  /**
   * Pinch start geometry from the currently tracked pointers (container-local
   * midpoint + distance), or null with fewer than two pointers.
   */
  const pinchGestureFromPointers = useCallback((): NodeDrag['pinch'] | null => {
    const rect = containerRef.current?.getBoundingClientRect();
    const points = [...pointersRef.current.values()];
    if (!rect || points.length < 2) return null;
    return {
      startMid: {
        x: (points[0].x + points[1].x) / 2 - rect.left,
        y: (points[0].y + points[1].y) / 2 - rect.top,
      },
      startDist: Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)),
    };
  }, []);

  /**
   * Re-measures every port marker into graph coordinates when the DOM
   * geometry can have changed: graph edits (structure + card positions),
   * trigger moves, and the auto-layout animation settling. Deliberately not
   * on every render — port coordinates are viewport-independent graph-space
   * values, so pan/zoom frames skip the measurement pass.
   */
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Expected port keys derived from the graph — used to reject partially
    // painted frames where some markers are not in the DOM yet.
    const expected = new Set<string>([`${TRIGGER_NODE_ID}:out:start:`]);
    for (const node of graph.nodes) {
      expected.add(`${node.id}:in`);
      for (const port of outputPorts(node, () => '')) {
        expected.add(outKey(node.id, port.field, port.buttonIndex));
      }
    }
    // These two also move ports without touching `graph` (trigger card drag,
    // auto-layout animation end) — listed so the effect re-runs for them.
    void triggerPos;
    void animating;
    const rect = container.getBoundingClientRect();
    const vp = viewportRef.current;
    const next: Record<string, { x: number; y: number }> = {};
    container.querySelectorAll<HTMLElement>('[data-point]').forEach((element) => {
      const marker = element.getBoundingClientRect();
      next[element.dataset.point as string] = {
        x: (marker.left + marker.width / 2 - rect.left - vp.x) / vp.k,
        y: (marker.top + marker.height / 2 - rect.top - vp.y) / vp.k,
      };
    });
    const complete = [...expected].every((key) => Object.prototype.hasOwnProperty.call(next, key));
    const previous = portPointsRef.current;
    const changed =
      Object.keys(next).length !== Object.keys(previous).length ||
      Object.entries(next).some(([key, point]) => {
        const old = previous[key];
        return !old || Math.abs(old.x - point.x) > 0.01 || Math.abs(old.y - point.y) > 0.01;
      });
    if (complete && changed) {
      portPointsRef.current = next;
      setPortPoints(next);
    }
  }, [graph, triggerPos, animating, outKey]);

  /** Zooms toward the cursor with a non-passive wheel listener. */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const vp = viewportRef.current;
      const scale = Math.min(2.5, Math.max(0.2, vp.k * Math.exp(-event.deltaY * 0.0014)));
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const graphX = (localX - vp.x) / vp.k;
      const graphY = (localY - vp.y) / vp.k;
      onViewportChange({ k: scale, x: localX - graphX * scale, y: localY - graphY * scale });
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [onViewportChange]);

  /** Closes the quick menu / cancels the wire on Escape. */
  useEffect(() => {
    if (!quickMenu && !wire) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setQuickMenu(null);
        wireRef.current = null;
        setWire(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [quickMenu, wire]);

  /**
   * Opens the quick-add menu at a screen position.
   */
  const openQuickMenu = useCallback(
    (clientX: number, clientY: number, wireInfo: QuickMenu['wire']): void => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setQuickMenu({
        screen: { x: clientX - rect.left, y: clientY - rect.top },
        graph: toGraph(clientX, clientY),
        wire: wireInfo,
      });
    },
    [toGraph],
  );

  /**
   * Pointer-down router: ports start a wire, cards start a drag, empty space
   * starts a pan (and clears selection on plain clicks).
   */
  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-quick-menu]')) return;
      setQuickMenu(null);
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      const port = target.closest<HTMLElement>('[data-port-out]');
      if (port) {
        event.preventDefault();
        const next: WireDrag = {
          from: port.dataset.node as string,
          field: port.dataset.field as CanvasWireField,
          buttonIndex:
            port.dataset.buttonIndex !== undefined ? Number(port.dataset.buttonIndex) : undefined,
          cursor: toGraph(event.clientX, event.clientY),
          hover: null,
          movedPx: 0,
        };
        wireRef.current = next;
        setWire(next);
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }

      const card = target.closest<HTMLElement>('[data-node-card]');
      if (card) {
        if (target.closest('[data-no-drag]')) return;
        event.preventDefault();
        const id = card.dataset.nodeId as string;
        let selection = selected;
        if (event.shiftKey) {
          selection = selected.includes(id)
            ? selected.filter((item) => item !== id)
            : [...selected, id];
        } else if (!selected.includes(id)) {
          selection = [id];
        }
        onSelect(selection);
        const origins: Record<string, { x: number; y: number }> = {};
        if (id === TRIGGER_NODE_ID) {
          origins[TRIGGER_NODE_ID] = { ...triggerPos };
        } else {
          for (const nodeId of selection) {
            if (nodeId === TRIGGER_NODE_ID) {
              origins[TRIGGER_NODE_ID] = { ...triggerPos };
              continue;
            }
            const node = nodeById.get(nodeId);
            origins[nodeId] = { x: node?.x ?? 0, y: node?.y ?? 0 };
          }
        }
        dragRef.current = {
          kind: 'node',
          pointerId: event.pointerId,
          startClient: { x: event.clientX, y: event.clientY },
          startViewport: { ...viewportRef.current },
          origins,
          moved: false,
        };
        onDragStart();
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }

      // Empty canvas: pan (selection clears via the click below) — or pinch
      // zoom once a second finger is down.
      event.preventDefault();
      const pinch = pointersRef.current.size >= 2 ? pinchGestureFromPointers() : null;
      if (pinch) {
        onSelect([]);
        dragRef.current = {
          kind: 'pinch',
          pointerId: event.pointerId,
          startClient: { x: event.clientX, y: event.clientY },
          startViewport: { ...viewportRef.current },
          origins: {},
          moved: false,
          pinch,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      onSelect([]);
      dragRef.current = {
        kind: 'pan',
        pointerId: event.pointerId,
        startClient: { x: event.clientX, y: event.clientY },
        startViewport: { ...viewportRef.current },
        origins: {},
        moved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [nodeById, onDragStart, onSelect, pinchGestureFromPointers, selected, toGraph, triggerPos],
  );

  /**
   * Pointer-move handler: pans, drags cards, and tracks the wire cursor.
   */
  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (pointersRef.current.has(event.pointerId)) {
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      const activeWire = wireRef.current;
      if (activeWire) {
        const cursor = toGraph(event.clientX, event.clientY);
        const movedPx = activeWire.movedPx + Math.abs(event.movementX) + Math.abs(event.movementY);
        const hovered = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest<HTMLElement>('[data-node-card]');
        const hoverId =
          hovered && hovered.dataset.nodeId !== activeWire.from
            ? (hovered.dataset.nodeId as string)
            : null;
        const next = { ...activeWire, cursor, hover: hoverId, movedPx };
        wireRef.current = next;
        setWire(next);
        return;
      }
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === 'pinch' && drag.pinch) {
        const rect = containerRef.current?.getBoundingClientRect();
        const points = [...pointersRef.current.values()];
        if (!rect || points.length < 2) return;
        const mid = {
          x: (points[0].x + points[1].x) / 2 - rect.left,
          y: (points[0].y + points[1].y) / 2 - rect.top,
        };
        const dist = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));
        const startVp = drag.startViewport;
        const k = Math.min(2.5, Math.max(0.2, startVp.k * (dist / drag.pinch.startDist)));
        // Anchor: keep the graph point under the gesture-start midpoint fixed
        // under the live midpoint while the scale changes.
        const anchorX = (drag.pinch.startMid.x - startVp.x) / startVp.k;
        const anchorY = (drag.pinch.startMid.y - startVp.y) / startVp.k;
        onViewportChange({ k, x: mid.x - anchorX * k, y: mid.y - anchorY * k });
        return;
      }
      if (drag.kind === 'pan') {
        onViewportChange({
          ...drag.startViewport,
          x: drag.startViewport.x + (event.clientX - drag.startClient.x),
          y: drag.startViewport.y + (event.clientY - drag.startClient.y),
        });
        return;
      }
      const dx = (event.clientX - drag.startClient.x) / viewportRef.current.k;
      const dy = (event.clientY - drag.startClient.y) / viewportRef.current.k;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      if (!drag.moved) return;
      const positions: Record<string, { x: number; y: number }> = {};
      for (const [id, origin] of Object.entries(drag.origins)) {
        positions[id] = { x: origin.x + dx, y: origin.y + dy };
      }
      if (positions[TRIGGER_NODE_ID]) onTriggerPosChange(positions[TRIGGER_NODE_ID]);
      const nodePositions = { ...positions };
      delete nodePositions[TRIGGER_NODE_ID];
      if (Object.keys(nodePositions).length > 0) onNodesMove(nodePositions);
    },
    [onNodesMove, onTriggerPosChange, onViewportChange, toGraph],
  );

  /**
   * Pointer-up handler: commits drags and wires; empty drops open quick-add.
   */
  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      pointersRef.current.delete(event.pointerId);
      const activeWire = wireRef.current;
      if (activeWire) {
        if (activeWire.hover) {
          onWire(activeWire.from, activeWire.field, activeWire.buttonIndex, activeWire.hover);
        } else if (activeWire.movedPx > 8) {
          openQuickMenu(event.clientX, event.clientY, {
            from: activeWire.from,
            field: activeWire.field,
            buttonIndex: activeWire.buttonIndex,
          });
        }
        wireRef.current = null;
        setWire(null);
        return;
      }
      const drag = dragRef.current;
      if (drag?.kind === 'pinch') {
        // Pinch ends only when fewer than two fingers remain; the remaining
        // finger does not resume panning.
        if (pointersRef.current.size < 2) dragRef.current = null;
        return;
      }
      if (drag && drag.kind !== 'pan') onDragEnd(drag.moved);
      dragRef.current = null;
    },
    [onDragEnd, onWire, openQuickMenu],
  );

  /** Fits the viewport around the positioned nodes and trigger card. */
  const fitView = useCallback((): void => {
    const container = containerRef.current;
    if (!container) return;
    const bounds = graphBounds(graphRef.current, triggerPosRef.current);
    const rect = container.getBoundingClientRect();
    if (!bounds) {
      onViewportChange({ x: 60, y: 60, k: 1 });
      return;
    }
    const padding = 70;
    const k = Math.min(
      1.15,
      Math.max(
        0.2,
        Math.min(
          (rect.width - padding * 2) / Math.max(1, bounds.maxX - bounds.minX),
          (rect.height - padding * 2) / Math.max(1, bounds.maxY - bounds.minY),
        ),
      ),
    );
    onViewportChange({
      k,
      x: (rect.width - (bounds.maxX - bounds.minX) * k) / 2 - bounds.minX * k,
      y: (rect.height - (bounds.maxY - bounds.minY) * k) / 2 - bounds.minY * k,
    });
  }, [onViewportChange]);

  /** Imperative surface for the shell (fit, coordinate math, palette drops). */
  useImperativeHandle(
    ref,
    () => ({
      fitView,
      screenToGraph: (clientX: number, clientY: number) => toGraph(clientX, clientY),
      dropNodeAt: (type: FlowNode['type'], clientX: number, clientY: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        if (
          clientX < rect.left ||
          clientX > rect.right ||
          clientY < rect.top ||
          clientY > rect.bottom
        ) {
          return;
        }
        const point = toGraph(clientX, clientY);
        onCreateNode(type, { x: point.x - NODE_WIDTH / 2, y: point.y - 30 }, null);
      },
      closeOverlays: () => {
        const hadOverlays = quickMenuRef.current !== null || wireRef.current !== null;
        setQuickMenu(null);
        wireRef.current = null;
        setWire(null);
        return hadOverlays;
      },
    }),
    [fitView, onCreateNode, toGraph],
  );

  /**
   * Renders one output port circle.
   */
  function renderPort(
    nodeId: string,
    port: PortDesc,
    color: string,
    wired: boolean,
  ): React.ReactElement {
    const key = outKey(nodeId, port.field, port.buttonIndex);
    return (
      <Box
        key={key}
        data-point={key}
        data-port-out
        data-node={nodeId}
        data-field={port.field}
        data-button-index={port.buttonIndex}
        title={port.label}
        sx={{
          width: 13,
          height: 13,
          borderRadius: '50%',
          border: `2.5px solid ${color}`,
          backgroundColor: wired ? color : theme.palette.background.default,
          cursor: 'crosshair',
          flexShrink: 0,
          transition: 'transform .12s ease, box-shadow .12s ease',
          '&:hover': { transform: 'scale(1.35)' },
        }}
      />
    );
  }

  /**
   * Short secondary line describing node configuration.
   */
  function nodeSummary(node: FlowNode): string {
    if (node.type === 'condition') {
      const opLabel = node.op === 'exists' ? '∃' : node.op === 'contains' ? '⊃' : '=';
      return `${node.variable || '…'} ${opLabel} ${node.op === 'exists' ? '' : node.value || '…'}`.trim();
    }
    if (node.type === 'delay') return `${node.minutes ?? 0} ${t('flows.minutesShort')}`;
    if (node.type === 'settag') return `#${node.tag || '…'}`;
    if (node.type === 'input') return `{${node.variable || '…'}}`;
    return '';
  }

  /**
   * Renders a regular node card.
   */
  function renderNodeCard(node: FlowNode): React.ReactElement {
    const color = NODE_COLORS[node.type];
    const isSelected = selected.includes(node.id);
    const isStart = graph.start === node.id;
    const Icon = NODE_ICONS[node.type];
    const ports = outputPorts(node, t);
    const summary = nodeSummary(node);
    const wiredFields = new Set(
      ports
        .filter((port) => getWireTarget(node, port.field, port.buttonIndex))
        .map((port) => `${port.field}:${port.buttonIndex ?? ''}`),
    );
    const buttonPorts = new Map(
      ports.filter((port) => port.field === 'button').map((port) => [port.buttonIndex ?? -1, port]),
    );
    const footerPorts = ports.filter((port) => port.field !== 'button');
    const dimmed = wire !== null && wire.from !== node.id && wire.hover !== node.id;
    return (
      <Box
        key={node.id}
        data-node-card
        data-node-id={node.id}
        tabIndex={0}
        role="button"
        aria-label={
          summary
            ? `${t(`flows.nodeTypes.${node.type}`)} — ${summary}`
            : t(`flows.nodeTypes.${node.type}`)
        }
        onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect([node.id]);
            return;
          }
          const delta = ARROW_DELTAS[event.key];
          if (!delta) return;
          event.preventDefault();
          const step = event.shiftKey ? 10 : 1;
          onNodesMove({
            [node.id]: { x: (node.x ?? 0) + delta[0] * step, y: (node.y ?? 0) + delta[1] * step },
          });
        }}
        sx={{
          position: 'absolute',
          width: NODE_WIDTH,
          transform: `translate(${node.x ?? 0}px, ${node.y ?? 0}px)`,
          transition: animating ? 'transform 300ms cubic-bezier(.2,.8,.2,1)' : undefined,
          borderRadius: '14px',
          padding: '10px 12px 9px',
          backgroundColor: theme.palette.background.paper,
          border: `1px solid ${isSelected ? color : theme.palette.divider}`,
          boxShadow: isSelected
            ? `0 0 0 2px ${color}44, 0 10px 28px rgba(2,6,23,${dark ? 0.5 : 0.14})`
            : `0 1px 4px rgba(2,6,23,${dark ? 0.4 : 0.08})`,
          cursor: 'grab',
          userSelect: 'none',
          opacity: dimmed ? 0.45 : 1,
          '&:active': { cursor: 'grabbing' },
          '&:focus-visible': { outline: `2px solid ${color}`, outlineOffset: 2 },
        }}
      >
        {/* Input port on the left edge */}
        <Box
          data-point={`${node.id}:in`}
          sx={{
            position: 'absolute',
            left: -8,
            top: '50%',
            marginTop: '-7px',
            width: 14,
            height: 14,
            borderRadius: '50%',
            border: `2.5px solid ${wire?.hover === node.id ? color : theme.palette.divider}`,
            backgroundColor: theme.palette.background.paper,
            transition: 'transform .12s ease, border-color .12s ease',
            ...(wire?.hover === node.id
              ? { transform: 'scale(1.6)', boxShadow: `0 0 0 4px ${color}44` }
              : {}),
          }}
        />
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.25 }}>
          <NodeTypeIconTile type={node.type} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="caption" fontWeight={700} sx={{ lineHeight: 1.2 }}>
              {t(`flows.nodeTypes.${node.type}`)}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              sx={{ display: 'block', lineHeight: 1.2 }}
            >
              {nodeSummary(node)}
            </Typography>
          </Box>
          {isStart && (
            <Chip
              size="small"
              variant="outlined"
              icon={<PlayArrowRoundedIcon sx={{ fontSize: 12 }} />}
              label={t('flows.start')}
              sx={{
                height: 20,
                fontSize: 10,
                color: theme.palette.primary.main,
                borderColor: theme.palette.primary.main,
                '& .MuiChip-iconSmall': { ml: 0.3 },
              }}
            />
          )}
          <Icon sx={{ fontSize: 15, color: `${color}aa`, ml: 0.25 }} />
        </Stack>
        {(node.type === 'message' || node.type === 'input') && (node.text ?? '') !== '' && (
          <Typography
            variant="caption"
            sx={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              opacity: 0.85,
              lineHeight: 1.35,
              mb: 0.5,
              whiteSpace: 'pre-wrap',
            }}
          >
            {node.text}
          </Typography>
        )}
        {(node.buttons ?? []).map((button, index) => {
          const port = buttonPorts.get(index);
          return (
            <Stack
              key={index}
              direction="row"
              spacing={0.75}
              alignItems="center"
              sx={{
                mt: 0.5,
                py: 0.25,
                px: 0.75,
                borderRadius: 1,
                backgroundColor: `${color}12`,
              }}
            >
              {button.url ? (
                <OpenInNewRoundedIcon sx={{ fontSize: 13, color: `${color}cc` }} />
              ) : (
                <TouchAppRoundedIcon sx={{ fontSize: 13, color: `${color}cc` }} />
              )}
              <Typography variant="caption" noWrap sx={{ flex: 1, lineHeight: 1.4 }}>
                {button.text || t('flows.untitledButton')}
              </Typography>
              {port &&
                renderPort(
                  node.id,
                  port,
                  color,
                  wiredFields.has(`${port.field}:${port.buttonIndex ?? ''}`),
                )}
            </Stack>
          );
        })}
        {footerPorts.length > 0 && (
          <Stack spacing={0.25} sx={{ mt: 0.75 }}>
            {footerPorts.map((port) => (
              <Stack
                key={`${port.field}:${port.buttonIndex ?? ''}`}
                direction="row"
                alignItems="center"
                spacing={0.75}
                sx={{ minHeight: 18 }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontSize: 10, lineHeight: 1 }}
                >
                  {port.label}
                </Typography>
                <Box sx={{ flex: 1 }} />
                {renderPort(
                  node.id,
                  port,
                  color,
                  wiredFields.has(`${port.field}:${port.buttonIndex ?? ''}`),
                )}
              </Stack>
            ))}
          </Stack>
        )}
      </Box>
    );
  }

  const dotColor = dark ? 'rgba(148,163,184,0.16)' : 'rgba(100,116,139,0.25)';
  const accent = theme.palette.primary.main;
  const triggerEdge =
    graph.start && portPoints[`${TRIGGER_NODE_ID}:out:start:`] && portPoints[`${graph.start}:in`]
      ? {
          from: portPoints[`${TRIGGER_NODE_ID}:out:start:`],
          to: portPoints[`${graph.start}:in`],
        }
      : null;

  return (
    <Box
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('[data-node-card]') || target.closest('[data-quick-menu]')) return;
        openQuickMenu(event.clientX, event.clientY, null);
      }}
      sx={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        cursor: wire ? 'crosshair' : 'default',
        touchAction: 'none',
        backgroundImage: `radial-gradient(circle, ${dotColor} 1px, transparent 1.1px)`,
        backgroundSize: `${22 * viewport.k}px ${22 * viewport.k}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
    >
      {/* Edge layer */}
      <svg
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
        }}
      >
        <g transform={`translate(${viewport.x},${viewport.y}) scale(${viewport.k})`}>
          {/* Trigger -> start edge */}
          {triggerEdge &&
            (() => {
              const isHot = hoverEdge === '__trigger__';
              const mid = bezierPoint(
                triggerEdge.from.x,
                triggerEdge.from.y,
                triggerEdge.to.x,
                triggerEdge.to.y,
                0.5,
              );
              return (
                <g key="__trigger__">
                  <path
                    d={bezierPath(
                      triggerEdge.from.x,
                      triggerEdge.from.y,
                      triggerEdge.to.x,
                      triggerEdge.to.y,
                    )}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={16 / viewport.k}
                    style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                    onPointerEnter={() => setHoverEdge('__trigger__')}
                    onPointerLeave={() =>
                      setHoverEdge((current) => (current === '__trigger__' ? null : current))
                    }
                  />
                  <path
                    d={bezierPath(
                      triggerEdge.from.x,
                      triggerEdge.from.y,
                      triggerEdge.to.x,
                      triggerEdge.to.y,
                    )}
                    fill="none"
                    stroke="#eab308"
                    strokeWidth={(isHot ? 2.6 : 1.8) / viewport.k}
                    strokeOpacity={isHot ? 0.95 : 0.6}
                    strokeLinecap="round"
                    pointerEvents="none"
                  />
                  {isHot && (
                    <g
                      transform={`translate(${mid.x},${mid.y - 14 / viewport.k})`}
                      style={{ cursor: 'pointer' }}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        onUnwire(TRIGGER_NODE_ID, 'start');
                        setHoverEdge(null);
                      }}
                    >
                      <circle
                        r={9 / viewport.k}
                        fill={theme.palette.background.paper}
                        stroke={theme.palette.error.main}
                        strokeWidth={1.6 / viewport.k}
                      />
                      <path
                        d={`M ${-3.5 / viewport.k} ${-3.5 / viewport.k} L ${3.5 / viewport.k} ${3.5 / viewport.k} M ${-3.5 / viewport.k} ${3.5 / viewport.k} L ${3.5 / viewport.k} ${-3.5 / viewport.k}`}
                        stroke={theme.palette.error.main}
                        strokeWidth={1.6 / viewport.k}
                        strokeLinecap="round"
                      />
                    </g>
                  )}
                </g>
              );
            })()}

          {edges.map((edge) => {
            const fromPoint = portPoints[outKey(edge.from, edge.field, edge.buttonIndex)];
            const toPoint = portPoints[`${edge.to}:in`];
            if (!fromPoint || !toPoint) return null;
            const fromNode = nodeById.get(edge.from);
            const color = fromNode ? NODE_COLORS[fromNode.type] : accent;
            const isHot = hoverEdge === edge.id;
            const mid = bezierPoint(fromPoint.x, fromPoint.y, toPoint.x, toPoint.y, 0.5);
            const label =
              edge.field === 'button'
                ? (fromNode?.buttons?.[edge.buttonIndex ?? 0]?.text ?? '')
                : edge.field === 'nextTrue'
                  ? t('flows.trueBranch')
                  : edge.field === 'nextFalse'
                    ? t('flows.falseBranch')
                    : '';
            const shortLabel = label.length > 18 ? `${label.slice(0, 17)}…` : label;
            const labelWidth = shortLabel ? shortLabel.length * 6.2 + 10 : 0;
            return (
              <g key={edge.id}>
                <path
                  d={bezierPath(fromPoint.x, fromPoint.y, toPoint.x, toPoint.y)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={16 / viewport.k}
                  style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                  onPointerEnter={() => setHoverEdge(edge.id)}
                  onPointerLeave={() =>
                    setHoverEdge((current) => (current === edge.id ? null : current))
                  }
                />
                <path
                  d={bezierPath(fromPoint.x, fromPoint.y, toPoint.x, toPoint.y)}
                  fill="none"
                  stroke={color}
                  strokeWidth={(isHot ? 2.6 : 1.8) / viewport.k}
                  strokeOpacity={isHot ? 0.95 : 0.55}
                  strokeLinecap="round"
                  pointerEvents="none"
                />
                {isHot && (
                  <g
                    transform={`translate(${mid.x},${mid.y - 14 / viewport.k})`}
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      onUnwire(edge.from, edge.field, edge.buttonIndex);
                      setHoverEdge(null);
                    }}
                  >
                    <circle
                      r={9 / viewport.k}
                      fill={theme.palette.background.paper}
                      stroke={theme.palette.error.main}
                      strokeWidth={1.6 / viewport.k}
                    />
                    <path
                      d={`M ${-3.5 / viewport.k} ${-3.5 / viewport.k} L ${3.5 / viewport.k} ${3.5 / viewport.k} M ${-3.5 / viewport.k} ${3.5 / viewport.k} L ${3.5 / viewport.k} ${-3.5 / viewport.k}`}
                      stroke={theme.palette.error.main}
                      strokeWidth={1.6 / viewport.k}
                      strokeLinecap="round"
                    />
                  </g>
                )}
                {shortLabel && !isHot && (
                  <g
                    transform={`translate(${mid.x - labelWidth / 2},${mid.y - 7 / viewport.k})`}
                    pointerEvents="none"
                  >
                    <rect
                      width={labelWidth}
                      height={14 / viewport.k}
                      rx={4 / viewport.k}
                      fill={theme.palette.background.paper}
                      stroke={theme.palette.divider}
                      strokeWidth={1 / viewport.k}
                    />
                    <text
                      x={labelWidth / 2}
                      y={10 / viewport.k}
                      textAnchor="middle"
                      fontSize={9 / viewport.k}
                      fill={theme.palette.text.secondary}
                      style={{ userSelect: 'none' }}
                    >
                      {shortLabel}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Wire in progress */}
          {wire &&
            (() => {
              const fromPoint =
                wire.from === TRIGGER_NODE_ID
                  ? portPoints[`${TRIGGER_NODE_ID}:out:start:`]
                  : portPoints[outKey(wire.from, wire.field, wire.buttonIndex)];
              if (!fromPoint) return null;
              const targetPoint =
                wire.hover && wire.hover !== TRIGGER_NODE_ID
                  ? portPoints[`${wire.hover}:in`]
                  : undefined;
              const end = targetPoint ?? wire.cursor;
              return (
                <g pointerEvents="none">
                  <path
                    d={bezierPath(fromPoint.x, fromPoint.y, end.x, end.y)}
                    fill="none"
                    stroke={accent}
                    strokeWidth={2 / viewport.k}
                    strokeDasharray={`${6 / viewport.k} ${4 / viewport.k}`}
                    strokeLinecap="round"
                  />
                  <circle cx={end.x} cy={end.y} r={4 / viewport.k} fill={accent} />
                </g>
              );
            })()}
        </g>
      </svg>

      {/* Nodes layer */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          transform: `translate(${viewport.x}px,${viewport.y}px) scale(${viewport.k})`,
          transformOrigin: '0 0',
        }}
      >
        {/* Trigger entry card */}
        <Box
          data-node-card
          data-node-id={TRIGGER_NODE_ID}
          tabIndex={0}
          role="button"
          aria-label={`${t('flows.triggerLabel')}: ${triggerLabel}`}
          onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect([TRIGGER_NODE_ID]);
              return;
            }
            const delta = ARROW_DELTAS[event.key];
            if (!delta) return;
            event.preventDefault();
            const step = event.shiftKey ? 10 : 1;
            onTriggerPosChange({
              x: triggerPos.x + delta[0] * step,
              y: triggerPos.y + delta[1] * step,
            });
          }}
          sx={{
            position: 'absolute',
            width: TRIGGER_WIDTH,
            transform: `translate(${triggerPos.x}px,${triggerPos.y}px)`,
            transition: animating ? 'transform 300ms cubic-bezier(.2,.8,.2,1)' : undefined,
            borderRadius: '14px',
            padding: '10px 12px',
            backgroundColor: dark ? 'rgba(234,179,8,0.05)' : 'rgba(234,179,8,0.04)',
            border: `1.5px dashed ${
              selected.includes(TRIGGER_NODE_ID) ? '#eab308' : 'rgba(234,179,8,0.5)'
            }`,
            cursor: 'grab',
            userSelect: 'none',
            boxShadow: selected.includes(TRIGGER_NODE_ID)
              ? '0 0 0 2px rgba(234,179,8,0.3)'
              : 'none',
            '&:focus-visible': { outline: '2px solid #eab308', outlineOffset: 2 },
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <NodeTypeIconTile type="trigger" />
            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="caption"
                fontWeight={700}
                sx={{ lineHeight: 1.2, display: 'block' }}
              >
                {t('flows.triggerLabel')}
              </Typography>
              <Typography
                variant="caption"
                noWrap
                sx={{ lineHeight: 1.2, display: 'block', color: '#eab308' }}
              >
                {triggerLabel}
              </Typography>
            </Box>
          </Stack>
          <Stack
            direction="row"
            alignItems="center"
            spacing={0.75}
            sx={{ mt: 0.75, minHeight: 18 }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
              {t('flows.start')}
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Box
              data-point={`${TRIGGER_NODE_ID}:out:start:`}
              data-port-out
              data-node={TRIGGER_NODE_ID}
              data-field="start"
              title={t('flows.start')}
              sx={{
                width: 13,
                height: 13,
                borderRadius: '50%',
                border: '2.5px solid #eab308',
                backgroundColor: graph.start ? '#eab308' : theme.palette.background.default,
                cursor: 'crosshair',
                flexShrink: 0,
                transition: 'transform .12s ease',
                '&:hover': { transform: 'scale(1.35)' },
              }}
            />
          </Stack>
        </Box>

        {graph.nodes.map((node) => renderNodeCard(node))}
      </Box>

      {/* Empty canvas hint */}
      {graph.nodes.length === 0 && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <Box
            sx={{
              border: `1px dashed ${theme.palette.divider}`,
              borderRadius: 3,
              px: 3,
              py: 2,
              textAlign: 'center',
              backgroundColor: dark ? 'rgba(17,23,38,0.6)' : 'rgba(255,255,255,0.6)',
            }}
          >
            <Typography variant="body2" fontWeight={600}>
              {t('flows.emptyCanvas')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('flows.emptyCanvasHint')}
            </Typography>
          </Box>
        </Box>
      )}

      {/* Quick-add menu */}
      {quickMenu && (
        <Box
          data-quick-menu
          sx={{
            position: 'absolute',
            left: quickMenu.screen.x,
            top: quickMenu.screen.y,
            zIndex: 10,
            borderRadius: 2,
            border: `1px solid ${theme.palette.divider}`,
            backgroundColor: theme.palette.background.paper,
            boxShadow: `0 12px 32px rgba(2,6,23,${dark ? 0.55 : 0.18})`,
            py: 0.5,
            px: 0.5,
            minWidth: 175,
            maxHeight: 300,
            overflowY: 'auto',
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ px: 1.25, py: 0.5, display: 'block' }}
          >
            {quickMenu.wire ? t('flows.connectNewNode') : t('flows.addNode')}
          </Typography>
          {PALETTE_TYPES.map((type) => {
            const Icon = NODE_ICONS[type];
            return (
              <Stack
                key={type}
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{
                  px: 1.25,
                  py: 0.6,
                  borderRadius: 1.5,
                  cursor: 'pointer',
                  '&:hover': {
                    backgroundColor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.05)',
                  },
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onCreateNode(type, quickMenu.graph, quickMenu.wire);
                  setQuickMenu(null);
                }}
              >
                <NodeTypeIconTile type={type} size={22} />
                <Typography variant="body2">{t(`flows.nodeTypes.${type}`)}</Typography>
                <Box sx={{ flex: 1 }} />
                <Icon sx={{ fontSize: 14, color: 'text.secondary' }} />
              </Stack>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

/**
 * Flow canvas with a typed imperative handle for the editor shell.
 */
const FlowCanvasWithRef = forwardRef(FlowCanvas);
FlowCanvasWithRef.displayName = 'FlowCanvas';
export default FlowCanvasWithRef;
