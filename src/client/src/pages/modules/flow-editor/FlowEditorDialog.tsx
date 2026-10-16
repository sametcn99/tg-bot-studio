import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  Divider,
  Drawer,
  Fab,
  IconButton,
  InputBase,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import TuneIcon from '@mui/icons-material/Tune';
import CloseIcon from '@mui/icons-material/Close';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';
import RedoRoundedIcon from '@mui/icons-material/RedoRounded';
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded';
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded';
import FitScreenRoundedIcon from '@mui/icons-material/FitScreenRounded';
import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../../services/api';
import { useSnackbar } from '../../../context/SnackbarContext';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { useUnsavedGuard } from '../../../hooks/useUnsavedGuard';
import { localizedErrorMessage } from '../../../utils/errors';
import FlowCanvas, {
  type CanvasViewport,
  type CanvasWireField,
  type FlowCanvasHandle,
} from './FlowCanvas';
import FlowInspector, { type FlowSettings } from './FlowInspector';
import {
  TRIGGER_NODE_ID,
  autoLayout,
  blankNode,
  bumpRevision,
  currentRevision,
  duplicateNode,
  isFullyPositioned,
  removeReferencesTo,
  setWireTarget,
  type FlowGraph,
  type FlowNode,
  type WireField,
} from './flowEditorModel';
import { NODE_ICONS, PALETTE_TYPES, NodeTypeIconTile } from './nodeVisuals';

/** Flow row shape needed by the editor. */
export interface EditorFlow {
  id: number;
  name: string;
  triggerType: 'command' | 'keyword' | 'start';
  triggerValue: string;
  isActive: boolean;
  graph: FlowGraph;
}

/** Editable state snapshot used for undo/redo and dirty tracking. */
interface EditorSnapshot {
  settings: FlowSettings;
  graph: FlowGraph;
}

/** Palette chip being dragged toward the canvas. */
interface PaletteDrag {
  type: FlowNode['type'];
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
}

/**
 * Full-screen visual flow editor: toolbar with undo/redo + zoom + save, a
 * drag-and-drop node palette, the interactive canvas, and a properties
 * inspector. Owns edit state, history, and persistence.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {EditorFlow} props.flow - Flow being edited.
 * @param {() => void} props.onClose - Close the editor.
 * @param {() => void} props.onSaved - Flow persisted (refresh the list).
 * @returns {React.ReactElement} The editor dialog.
 */
export default function FlowEditorDialog({
  botId,
  flow,
  onClose,
  onSaved,
}: {
  botId: number;
  flow: EditorFlow;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const theme = useTheme();
  const { showSuccess, showError } = useSnackbar();
  const canvasRef = useRef<FlowCanvasHandle>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);

  // Mobile layout switches: the palette sidebar hides below `sm`, the
  // inspector below `md` — both become drawers with a FAB trigger instead.
  const isSmallDown = useMediaQuery(theme.breakpoints.down('sm'));
  const isMediumDown = useMediaQuery(theme.breakpoints.down('md'));
  const [paletteDrawerOpen, setPaletteDrawerOpen] = useState(false);
  const [inspectorDrawerOpen, setInspectorDrawerOpen] = useState(false);

  const [settings, setSettings] = useState<FlowSettings>({
    name: flow.name,
    triggerType: flow.triggerType,
    triggerValue: flow.triggerValue,
    isActive: flow.isActive,
  });
  const [graph, setGraph] = useState<FlowGraph>(
    JSON.parse(JSON.stringify(flow.graph)) as FlowGraph,
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewport, setViewport] = useState<CanvasViewport>({ x: 60, y: 60, k: 1 });
  const [triggerPos, setTriggerPos] = useState({ x: 0, y: 80 });
  const [animating, setAnimating] = useState(false);
  const [past, setPast] = useState<EditorSnapshot[]>([]);
  const [future, setFuture] = useState<EditorSnapshot[]>([]);
  const [saving, setSaving] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [paletteDrag, setPaletteDrag] = useState<PaletteDrag | null>(null);

  const stateRef = useRef({ settings, graph, triggerPos });
  const dragSnapshotRef = useRef<EditorSnapshot | null>(null);
  const coalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Mirrors editable state into a ref for event handlers (post-commit). */
  useEffect(() => {
    stateRef.current = { settings, graph, triggerPos };
  });

  // Dirty tracking via the model's monotonic revision counter: mutations bump
  // it, and the serialized JSON is only built when actually saving.
  const [revision, setRevision] = useState(currentRevision);
  const [savedRevision, setSavedRevision] = useState(currentRevision);
  const dirty = revision !== savedRevision;

  /** Bumps the edit revision (call after/with every committed mutation). */
  const bump = useCallback((): void => {
    setRevision(bumpRevision());
  }, []);

  /**
   * Snapshot helper for history entries.
   */
  const snapshot = useCallback((): EditorSnapshot => {
    const current = stateRef.current;
    return {
      settings: { ...current.settings },
      graph: JSON.parse(JSON.stringify(current.graph)) as FlowGraph,
    };
  }, []);

  /**
   * Pushes an undo point for a discrete operation.
   */
  const pushHistory = useCallback((): void => {
    const entry = snapshot();
    setPast((entries) => [...entries.slice(-49), entry]);
    setFuture([]);
  }, [snapshot]);

  /**
   * Pushes a coalesced undo point for rapid edits (text typing).
   */
  const scheduleHistory = useCallback((): void => {
    if (!coalesceTimerRef.current) pushHistory();
    if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current);
    coalesceTimerRef.current = setTimeout(() => {
      coalesceTimerRef.current = null;
    }, 700);
  }, [pushHistory]);

  /**
   * Restores a snapshot (undo/redo share the mechanics).
   */
  const restore = useCallback(
    (entry: EditorSnapshot): void => {
      bump();
      setSettings({ ...entry.settings });
      setGraph(JSON.parse(JSON.stringify(entry.graph)) as FlowGraph);
    },
    [bump],
  );

  /**
   * Undoes the last discrete edit.
   */
  const undo = useCallback((): void => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    const entry = snapshot();
    setPast(past.slice(0, -1));
    setFuture((items) => [...items, entry]);
    restore(previous);
  }, [past, restore, snapshot]);

  /**
   * Redoes the last undone edit.
   */
  const redo = useCallback((): void => {
    if (future.length === 0) return;
    const next = future[future.length - 1];
    const entry = snapshot();
    setFuture(future.slice(0, -1));
    setPast((items) => [...items, entry]);
    restore(next);
  }, [future, restore, snapshot]);

  /**
   * Positions the trigger card just left of the start node.
   */
  const placeTriggerBesideStart = useCallback((current: FlowGraph): { x: number; y: number } => {
    const start = current.nodes.find((node) => node.id === current.start);
    return { x: (start?.x ?? 0) - 240, y: start?.y ?? 80 };
  }, []);

  /** First open: auto-position unplaced graphs, then fit the view. */
  useEffect(() => {
    if (!isFullyPositioned(graph)) {
      const laid = autoLayout(graph);
      setGraph(laid);
      setTriggerPos(placeTriggerBesideStart(laid));
    } else {
      setTriggerPos(placeTriggerBesideStart(graph));
    }
    const timer = setTimeout(() => canvasRef.current?.fitView(), 80);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Keeps selection valid when the graph shrinks. */
  useEffect(() => {
    setSelectedIds((ids) =>
      ids.filter((id) => id === TRIGGER_NODE_ID || graph.nodes.some((node) => node.id === id)),
    );
  }, [graph]);

  /** Palette chip drag: window-level tracking with a ghost preview. */
  useEffect(() => {
    if (!paletteDrag) return;
    const onMove = (event: PointerEvent): void => {
      setPaletteDrag((current) => {
        if (!current) return current;
        const moved =
          current.moved ||
          Math.abs(event.clientX - current.startX) + Math.abs(event.clientY - current.startY) > 6;
        return { ...current, x: event.clientX, y: event.clientY, moved };
      });
    };
    const onUp = (): void => {
      setPaletteDrag((current) => {
        if (current?.moved && canvasRef.current) {
          canvasRef.current.dropNodeAt(current.type, current.x, current.y);
        } else if (current && canvasRef.current && canvasWrapRef.current) {
          const rect = canvasWrapRef.current.getBoundingClientRect();
          canvasRef.current.dropNodeAt(
            current.type,
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
        }
        return null;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [paletteDrag]);

  /**
   * Creates a node (optionally at a position and/or wired from a port).
   */
  const createNode = useCallback(
    (
      type: FlowNode['type'],
      pos: { x: number; y: number },
      wire: { from: string; field: CanvasWireField; buttonIndex?: number } | null,
    ): void => {
      pushHistory();
      bump();
      const node = { ...blankNode(type), x: pos.x, y: pos.y };
      setGraph((current) => {
        let next: FlowGraph = {
          ...current,
          nodes: [...current.nodes, node],
          start: current.start || node.id,
        };
        if (wire && wire.from === TRIGGER_NODE_ID) {
          next = { ...next, start: node.id };
        } else if (wire) {
          next = {
            ...next,
            nodes: next.nodes.map((item) =>
              item.id === wire.from
                ? setWireTarget(item, wire.field as WireField, node.id, wire.buttonIndex)
                : item,
            ),
          };
        }
        return next;
      });
      setSelectedIds([node.id]);
    },
    [bump, pushHistory],
  );

  /**
   * Commits a drawn connection.
   */
  const wireConnection = useCallback(
    (from: string, field: CanvasWireField, buttonIndex: number | undefined, to: string): void => {
      pushHistory();
      bump();
      if (from === TRIGGER_NODE_ID) {
        setGraph((current) => ({ ...current, start: to }));
        return;
      }
      const wireField = field as WireField;
      setGraph((current) => ({
        ...current,
        nodes: current.nodes.map((item) =>
          item.id === from ? setWireTarget(item, wireField, to, buttonIndex) : item,
        ),
      }));
    },
    [bump, pushHistory],
  );

  /**
   * Removes a connection (edge × button or trigger unlink).
   */
  const unwireConnection = useCallback(
    (from: string, field: CanvasWireField, buttonIndex?: number): void => {
      pushHistory();
      bump();
      if (from === TRIGGER_NODE_ID || field === 'start') {
        setGraph((current) => ({ ...current, start: '' }));
        return;
      }
      const wireField = field as WireField;
      setGraph((current) => ({
        ...current,
        nodes: current.nodes.map((item) =>
          item.id === from ? setWireTarget(item, wireField, undefined, buttonIndex) : item,
        ),
      }));
    },
    [bump, pushHistory],
  );

  /**
   * Deletes nodes and every reference to them.
   */
  const deleteNodes = useCallback(
    (ids: string[]): void => {
      pushHistory();
      bump();
      setGraph((current) => {
        let next = current;
        for (const id of ids) next = removeReferencesTo(next, id);
        return next;
      });
      setSelectedIds([]);
    },
    [bump, pushHistory],
  );

  /**
   * Patches one node's definition fields.
   */
  const patchNode = useCallback(
    (id: string, patch: Partial<FlowNode>): void => {
      scheduleHistory();
      bump();
      setGraph((current) => ({
        ...current,
        nodes: current.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
      }));
    },
    [bump, scheduleHistory],
  );

  /**
   * Moves nodes on the canvas (live during drag, no history here).
   */
  const moveNodes = useCallback(
    (positions: Record<string, { x: number; y: number }>): void => {
      bump();
      setGraph((current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          positions[node.id] ? { ...node, ...positions[node.id] } : node,
        ),
      }));
    },
    [bump],
  );

  /**
   * Duplicates a node next to the original.
   */
  const duplicate = useCallback(
    (id: string): void => {
      const node = stateRef.current.graph.nodes.find((item) => item.id === id);
      if (!node) return;
      pushHistory();
      bump();
      const clone = duplicateNode(node);
      setGraph((current) => ({ ...current, nodes: [...current.nodes, clone] }));
      setSelectedIds([clone.id]);
    },
    [bump, pushHistory],
  );

  /**
   * Runs the tidy left-to-right layout and fits the view.
   */
  const runAutoLayout = useCallback((): void => {
    pushHistory();
    bump();
    const laid = autoLayout(graph);
    setAnimating(true);
    setGraph(laid);
    setTriggerPos(placeTriggerBesideStart(laid));
    setTimeout(() => {
      setAnimating(false);
      canvasRef.current?.fitView();
    }, 340);
  }, [bump, graph, placeTriggerBesideStart, pushHistory]);

  /**
   * Zooms by a factor around the canvas center.
   */
  const zoomBy = useCallback((factor: number): void => {
    const rect = canvasWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setViewport((current) => {
      const k = Math.min(2.5, Math.max(0.2, current.k * factor));
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      return {
        k,
        x: cx - ((cx - current.x) / current.k) * k,
        y: cy - ((cy - current.y) / current.k) * k,
      };
    });
  }, []);

  /**
   * Persists the flow definition.
   */
  const save = useCallback((): void => {
    setSaving(true);
    const savedAtRevision = revision;
    apiFetch(`/api/bots/${botId}/flows/${flow.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: settings.name,
        triggerType: settings.triggerType,
        triggerValue: settings.triggerValue,
        graph,
        isActive: settings.isActive,
      }),
    })
      .then(() => {
        setSaving(false);
        setSavedRevision(savedAtRevision);
        showSuccess(t('flows.saved'));
        onSaved();
      })
      .catch((err: Error) => {
        setSaving(false);
        showError(localizedErrorMessage(err));
      });
  }, [botId, flow.id, graph, onSaved, revision, settings, showError, showSuccess, t]);

  /**
   * Runs the flow trigger in the sandbox simulator.
   */
  const testFlow = useCallback((): void => {
    const message =
      settings.triggerType === 'command'
        ? settings.triggerValue
        : settings.triggerType === 'keyword'
          ? `test ${settings.triggerValue}`
          : '/start';
    apiFetch<{ text?: string; unmatched?: boolean }>(`/api/bots/${botId}/simulator/send`, {
      method: 'POST',
      body: JSON.stringify({ message, chatType: 'private' }),
    })
      .then((result) => {
        showSuccess(
          result?.unmatched
            ? t('flows.testNoReply')
            : t('flows.testReply', { text: (result?.text ?? '').slice(0, 120) }),
        );
      })
      .catch((err: Error) => showError(localizedErrorMessage(err)));
  }, [botId, settings.triggerType, settings.triggerValue, showError, showSuccess, t]);

  /**
   * Closes the editor, guarding against unsaved changes.
   */
  const requestClose = useCallback((): void => {
    if (dirty) setCloseConfirm(true);
    else onClose();
  }, [dirty, onClose]);

  /** Global shortcuts (capture phase so the dialog cannot swallow them). */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement;
      const editable =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (event.key === 'Escape') {
        const overlays = canvasRef.current?.closeOverlays() ?? false;
        if (overlays) {
          event.stopPropagation();
          event.preventDefault();
        }
        return;
      }
      if (editable) return;
      const meta = event.ctrlKey || event.metaKey;
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (meta && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      } else if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (dirty && !saving) save();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        const ids = selectedIds.filter((id) => id !== TRIGGER_NODE_ID);
        if (ids.length > 0) {
          event.preventDefault();
          deleteNodes(ids);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [deleteNodes, dirty, redo, save, saving, selectedIds, undo]);

  /**
   * Short trigger summary for chips and the entry card.
   */
  const triggerSummary = (): string => {
    if (settings.triggerType === 'start') return '/start';
    if (!settings.triggerValue)
      return t(`flows.trigger${settings.triggerType === 'command' ? 'Command' : 'Keyword'}`);
    return settings.triggerType === 'command'
      ? settings.triggerValue
      : `“${settings.triggerValue}”`;
  };

  const toolButtonSx = {
    color: 'text.secondary',
    '&:hover': { backgroundColor: 'action.hover' },
  } as const;

  /**
   * Drops a palette block at the center of the canvas (mobile drawer taps —
   * drag-and-drop from the drawer is impractical on phones).
   * @param {FlowNode['type']} type - Node type to create.
   */
  const addNodeFromPalette = useCallback((type: FlowNode['type']): void => {
    const rect = canvasWrapRef.current?.getBoundingClientRect();
    if (!rect || !canvasRef.current) return;
    canvasRef.current.dropNodeAt(type, rect.left + rect.width / 2, rect.top + rect.height / 2);
    setPaletteDrawerOpen(false);
  }, []);

  /** Shared inspector element (desktop sidebar + mobile drawer). */
  const inspector = (
    <FlowInspector
      graph={graph}
      selectedIds={selectedIds}
      settings={settings}
      onPatchSettings={(patch) => {
        scheduleHistory();
        bump();
        setSettings((current) => ({ ...current, ...patch }));
      }}
      onPatchNode={patchNode}
      onSetStart={(id) => {
        pushHistory();
        bump();
        setGraph((current) => ({ ...current, start: id }));
      }}
      onDuplicate={duplicate}
      onDeleteNodes={deleteNodes}
    />
  );

  // Route + tab-close guard while the flow has unsaved edits.
  const unsavedGuard = useUnsavedGuard(dirty);

  return (
    <Dialog
      open
      fullScreen
      onClose={(_, reason) => {
        if (reason !== 'backdropClick') requestClose();
      }}
    >
      <Stack sx={{ height: '100%' }}>
        {/* Toolbar */}
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{
            px: 1.5,
            py: 1,
            borderBottom: `1px solid ${theme.palette.divider}`,
            backgroundColor: theme.palette.background.paper,
          }}
        >
          <IconButton size="small" onClick={requestClose} aria-label={t('actions.close')}>
            <CloseIcon fontSize="small" />
          </IconButton>
          <InputBase
            value={settings.name}
            onChange={(event) => {
              scheduleHistory();
              bump();
              setSettings((current) => ({ ...current, name: event.target.value }));
            }}
            sx={{
              fontWeight: 700,
              fontSize: '1.05rem',
              width: { xs: 130, sm: 260 },
              px: 1,
              borderRadius: 1,
              '&:hover, &:focus-within': { backgroundColor: 'action.hover' },
            }}
            inputProps={{ 'aria-label': t('flows.flowName') }}
          />
          <Chip
            size="small"
            icon={<BoltRoundedIcon sx={{ fontSize: 14 }} />}
            label={triggerSummary()}
            onClick={() => setSelectedIds([TRIGGER_NODE_ID])}
            sx={{
              height: 26,
              '& .MuiChip-iconSmall': { ml: 0.75 },
              borderColor: 'divider',
              cursor: 'pointer',
            }}
            variant="outlined"
          />
          <Box sx={{ flex: 1 }} />
          <Tooltip title={t('flows.undo')}>
            <span>
              <IconButton
                size="small"
                aria-label={t('flows.undo')}
                disabled={past.length === 0}
                onClick={undo}
                sx={toolButtonSx}
              >
                <UndoRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={t('flows.redo')}>
            <span>
              <IconButton
                size="small"
                aria-label={t('flows.redo')}
                disabled={future.length === 0}
                onClick={redo}
                sx={toolButtonSx}
              >
                <RedoRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
          <Tooltip title={t('flows.zoomOut')}>
            <IconButton
              size="small"
              aria-label={t('flows.zoomOut')}
              onClick={() => zoomBy(1 / 1.25)}
              sx={toolButtonSx}
            >
              <ZoomOutRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Typography
            variant="caption"
            sx={{ width: 40, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
          >
            {Math.round(viewport.k * 100)}%
          </Typography>
          <Tooltip title={t('flows.zoomIn')}>
            <IconButton
              size="small"
              aria-label={t('flows.zoomIn')}
              onClick={() => zoomBy(1.25)}
              sx={toolButtonSx}
            >
              <ZoomInRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('flows.fitView')}>
            <IconButton
              size="small"
              aria-label={t('flows.fitView')}
              onClick={() => canvasRef.current?.fitView()}
              sx={toolButtonSx}
            >
              <FitScreenRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('flows.autoLayout')}>
            <IconButton
              size="small"
              aria-label={t('flows.autoLayout')}
              onClick={runAutoLayout}
              sx={toolButtonSx}
            >
              <AccountTreeRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
          <Button
            size="small"
            startIcon={<PlayArrowRoundedIcon />}
            onClick={testFlow}
            sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
          >
            {t('flows.test')}
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<SaveRoundedIcon />}
            disabled={!dirty || saving || !settings.name.trim() || !graph.start}
            onClick={save}
          >
            {t('actions.save')}
            {dirty && (
              <Box
                sx={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  backgroundColor: 'currentColor',
                  ml: 0.75,
                  opacity: 0.9,
                }}
              />
            )}
          </Button>
        </Stack>

        {/* Palette + canvas + inspector */}
        <Stack direction="row" sx={{ flex: 1, minHeight: 0 }}>
          {/* Palette */}
          <Box
            sx={{
              width: 200,
              flexShrink: 0,
              borderRight: `1px solid ${theme.palette.divider}`,
              p: 1.25,
              overflowY: 'auto',
              display: { xs: 'none', sm: 'block' },
            }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              fontWeight={700}
              sx={{ px: 0.75, display: 'block', mb: 1 }}
            >
              {t('flows.palette')}
            </Typography>
            <Stack spacing={0.5}>
              {PALETTE_TYPES.map((type) => (
                <Stack
                  key={type}
                  data-testid={`palette-item-${type}`}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{
                    p: 0.75,
                    borderRadius: 1.5,
                    cursor: 'grab',
                    userSelect: 'none',
                    border: '1px solid transparent',
                    '&:hover': {
                      backgroundColor:
                        theme.palette.mode === 'dark'
                          ? 'rgba(255,255,255,0.05)'
                          : 'rgba(15,23,42,0.04)',
                      borderColor: theme.palette.divider,
                    },
                  }}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    setPaletteDrag({
                      type,
                      startX: event.clientX,
                      startY: event.clientY,
                      x: event.clientX,
                      y: event.clientY,
                      moved: false,
                    });
                  }}
                >
                  <NodeTypeIconTile type={type} size={24} />
                  <Typography variant="body2">{t(`flows.nodeTypes.${type}`)}</Typography>
                </Stack>
              ))}
            </Stack>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', px: 0.75, mt: 2 }}
            >
              {t('flows.paletteHint')}
            </Typography>
          </Box>

          {/* Canvas */}
          <Box ref={canvasWrapRef} sx={{ flex: 1, minWidth: 0, position: 'relative' }}>
            <FlowCanvas
              ref={canvasRef}
              graph={graph}
              triggerLabel={triggerSummary()}
              triggerPos={triggerPos}
              onTriggerPosChange={setTriggerPos}
              selected={selectedIds}
              onSelect={setSelectedIds}
              onNodesMove={moveNodes}
              onDragStart={() => {
                dragSnapshotRef.current = snapshot();
              }}
              onDragEnd={(moved) => {
                const entry = dragSnapshotRef.current;
                dragSnapshotRef.current = null;
                if (moved && entry) {
                  setPast((entries) => [...entries.slice(-49), entry]);
                  setFuture([]);
                }
              }}
              onWire={wireConnection}
              onUnwire={unwireConnection}
              onCreateNode={createNode}
              viewport={viewport}
              onViewportChange={setViewport}
              animating={animating}
            />

            {/* Mobile: palette + inspector are drawers, opened from FABs */}
            {isMediumDown && (
              <Stack spacing={1} sx={{ position: 'absolute', right: 12, bottom: 12, zIndex: 5 }}>
                {isSmallDown && (
                  <Fab
                    size="small"
                    color="primary"
                    aria-label={t('flows.addNode')}
                    onClick={() => setPaletteDrawerOpen(true)}
                  >
                    <AddIcon fontSize="small" />
                  </Fab>
                )}
                <Fab
                  size="small"
                  color="secondary"
                  aria-label={t('flows.inspector')}
                  onClick={() => setInspectorDrawerOpen(true)}
                >
                  <TuneIcon fontSize="small" />
                </Fab>
              </Stack>
            )}
          </Box>

          {/* Inspector (desktop) */}
          <Box sx={{ display: { xs: 'none', md: 'block' } }}>{inspector}</Box>
        </Stack>
      </Stack>

      {/* Mobile palette drawer: tap a block to drop it in the canvas center */}
      <Drawer
        anchor="bottom"
        open={paletteDrawerOpen}
        onClose={() => setPaletteDrawerOpen(false)}
        PaperProps={{
          sx: { maxHeight: '72vh', borderTopLeftRadius: 16, borderTopRightRadius: 16 },
        }}
      >
        <Box sx={{ p: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle2">{t('flows.palette')}</Typography>
            <IconButton
              size="small"
              aria-label={t('actions.close')}
              onClick={() => setPaletteDrawerOpen(false)}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Stack spacing={0.5}>
            {PALETTE_TYPES.map((type) => {
              const Icon = NODE_ICONS[type];
              return (
                <Stack
                  key={type}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  data-testid={`palette-drawer-item-${type}`}
                  sx={{
                    p: 1.25,
                    borderRadius: 1.5,
                    cursor: 'pointer',
                    '&:active': { backgroundColor: 'action.hover' },
                  }}
                  onClick={() => addNodeFromPalette(type)}
                >
                  <NodeTypeIconTile type={type} size={24} />
                  <Typography variant="body2">{t(`flows.nodeTypes.${type}`)}</Typography>
                  <Box sx={{ flex: 1 }} />
                  <Icon sx={{ fontSize: 14, color: 'text.secondary' }} />
                </Stack>
              );
            })}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
            {t('flows.paletteTapHint')}
          </Typography>
        </Box>
      </Drawer>

      {/* Mobile inspector drawer */}
      <Drawer
        anchor="bottom"
        open={inspectorDrawerOpen}
        onClose={() => setInspectorDrawerOpen(false)}
        PaperProps={{
          sx: { maxHeight: '85vh', borderTopLeftRadius: 16, borderTopRightRadius: 16 },
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', px: 1.5, pt: 1 }}>
          <IconButton
            size="small"
            aria-label={t('actions.close')}
            onClick={() => setInspectorDrawerOpen(false)}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
        <Box sx={{ px: 2, pb: 3, overflowY: 'auto' }}>{inspector}</Box>
      </Drawer>

      {/* Palette drag ghost */}
      {paletteDrag && (
        <Box
          sx={{
            position: 'fixed',
            left: paletteDrag.x + 12,
            top: paletteDrag.y + 12,
            zIndex: 2000,
            pointerEvents: 'none',
            opacity: 0.9,
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{
              px: 1.25,
              py: 0.75,
              borderRadius: 2,
              backgroundColor: theme.palette.background.paper,
              border: `1px solid ${theme.palette.divider}`,
              boxShadow: `0 8px 24px rgba(2,6,23,${theme.palette.mode === 'dark' ? 0.5 : 0.15})`,
            }}
          >
            <NodeTypeIconTile type={paletteDrag.type} size={22} />
            <Typography variant="body2">{t(`flows.nodeTypes.${paletteDrag.type}`)}</Typography>
          </Stack>
        </Box>
      )}

      {/* Unsaved-changes guard (dialog close) */}
      <ConfirmDialog
        open={closeConfirm}
        title={t('flows.unsavedTitle')}
        message={t('flows.unsavedMessage')}
        onConfirm={() => {
          setCloseConfirm(false);
          onClose();
        }}
        onCancel={() => setCloseConfirm(false)}
      />

      {/* Unsaved-changes guard (route navigation / tab close) */}
      {unsavedGuard}
    </Dialog>
  );
}
