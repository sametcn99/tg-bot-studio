import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../services/api';
import PageHeader from '../../components/PageHeader';
import { useModuleDocs } from '../../context/ModuleDocsContext';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useSnackbar } from '../../context/SnackbarContext';
import type { ModuleEntry } from '../../registry/modules';
import { localizedErrorMessage } from '../../utils/errors';
import { formatDate } from '../../utils/format';
import FlowEditorDialog from './flow-editor/FlowEditorDialog';
import {
  NODE_COLORS,
  TRIGGER_WIDTH,
  autoLayout,
  collectEdges,
  graphBounds,
  isFullyPositioned,
  type FlowGraph,
  type FlowNode,
} from './flow-editor/flowEditorModel';

/** Flow row from the API. */
interface FlowRow {
  id: string;
  name: string;
  triggerType: 'command' | 'keyword' | 'start';
  triggerValue: string;
  isActive: boolean;
  graph: FlowGraph;
  updatedAt: string | null;
}

/**
 * Visual Flow Builder page: a gallery of flow cards with live graph
 * thumbnails; each card opens the full-screen drag-and-drop canvas editor.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {ModuleEntry} props.module - Flows catalog entry.
 * @returns {React.ReactElement} The page.
 */
export default function FlowBuilderPage({
  botId,
  module,
}: {
  botId: string;
  module: ModuleEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  const theme = useTheme();
  const { openDocs } = useModuleDocs();
  const { showSuccess, showError } = useSnackbar();
  const [flows, setFlows] = useState<FlowRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorFlow, setEditorFlow] = useState<FlowRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTriggerType, setNewTriggerType] = useState<'command' | 'keyword' | 'start'>('command');
  const [newTriggerValue, setNewTriggerValue] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId]);

  /**
   * Reloads the flow list.
   * @returns {void}
   */
  function reload(): void {
    apiFetch<FlowRow[]>(`/api/bots/${botId}/flows`)
      .then(setFlows)
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }

  /**
   * Creates a flow with a starter message node and opens the editor.
   * @returns {void}
   */
  function createFlow(): void {
    const name = newName.trim();
    if (!name) return;
    const start: FlowNode = {
      id: `n${Math.random().toString(36).slice(2, 8)}`,
      type: 'message',
      text: '',
      buttons: [],
      x: 320,
      y: 120,
    };
    const graph: FlowGraph = { start: start.id, nodes: [start] };
    apiFetch<FlowRow>(`/api/bots/${botId}/flows`, {
      method: 'POST',
      body: JSON.stringify({
        name,
        triggerType: newTriggerType,
        triggerValue: newTriggerValue.trim(),
        graph,
        isActive: true,
      }),
    })
      .then((created) => {
        setCreating(false);
        setNewName('');
        setNewTriggerValue('');
        reload();
        setEditorFlow(created);
      })
      .catch((err: Error) => showError(localizedErrorMessage(err)));
  }

  /**
   * Toggles a flow without opening the editor.
   */
  function toggleFlow(flow: FlowRow, active: boolean): void {
    apiFetch(`/api/bots/${botId}/flows/${flow.id}/active?value=${active}`, { method: 'PATCH' })
      .then(reload)
      .catch((err: Error) => showError(localizedErrorMessage(err)));
  }

  /**
   * Deletes a flow after confirmation.
   * @returns {void}
   */
  function confirmDelete(): void {
    if (deleteId === null) return;
    apiFetch(`/api/bots/${botId}/flows/${deleteId}`, { method: 'DELETE' })
      .then(() => {
        setDeleteId(null);
        reload();
      })
      .catch((err: Error) => showError(localizedErrorMessage(err)));
  }

  /**
   * Runs the flow trigger in the sandbox simulator.
   */
  function testFlow(flow: FlowRow): void {
    const message =
      flow.triggerType === 'command'
        ? flow.triggerValue
        : flow.triggerType === 'keyword'
          ? `test ${flow.triggerValue}`
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
  }

  /**
   * Short trigger summary for chips.
   */
  function triggerSummary(flow: FlowRow): string {
    if (flow.triggerType === 'start') return '/start';
    if (!flow.triggerValue)
      return t(`flows.trigger${flow.triggerType === 'command' ? 'Command' : 'Keyword'}`);
    return flow.triggerType === 'command' ? flow.triggerValue : `“${flow.triggerValue}”`;
  }

  return (
    <Box>
      <PageHeader
        title={module.name}
        subtitle={module.description}
        onDocs={() => openDocs(module)}
        actions={
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreating(true)}
          >
            {t('flows.newFlow')}
          </Button>
        }
      />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))',
          gap: 2,
        }}
      >
        {(flows ?? []).map((flow) => (
          <Card
            key={flow.id}
            sx={{
              transition: 'border-color .15s ease, box-shadow .15s ease',
              '&:hover': {
                borderColor: 'primary.main',
                boxShadow: `0 6px 20px rgba(2,6,23,${theme.palette.mode === 'dark' ? 0.45 : 0.1})`,
              },
            }}
          >
            <CardActionArea onClick={() => setEditorFlow(flow)}>
              <CardContent sx={{ pb: '12px !important' }}>
                <Stack
                  direction="row"
                  sx={{
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    mb: 1.25,
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{
                      alignItems: 'center',
                      minWidth: 0,
                    }}
                  >
                    <Typography variant="subtitle2" noWrap>
                      {flow.name}
                    </Typography>
                    {!flow.isActive && (
                      <Chip
                        size="small"
                        label={t('status.inactive')}
                        sx={{ height: 20, fontSize: 10 }}
                      />
                    )}
                  </Stack>
                  <Chip
                    size="small"
                    variant="outlined"
                    icon={<BoltRoundedIcon sx={{ fontSize: 13 }} />}
                    label={triggerSummary(flow)}
                    sx={{
                      height: 24,
                      '&.MuiChip-sizeSmall > .MuiChip-icon': { ml: 0.75 },
                      flexShrink: 0,
                    }}
                  />
                </Stack>
                <FlowThumb graph={flow.graph} />
              </CardContent>
            </CardActionArea>
            <Stack
              direction="row"
              sx={{
                alignItems: 'center',
                justifyContent: 'space-between',
                px: 2,
                pb: 1.5,
              }}
            >
              <Stack direction="row" spacing={2}>
                <Typography
                  variant="caption"
                  sx={{
                    color: 'text.secondary',
                  }}
                >
                  {t('flows.nodeCount', { count: flow.graph.nodes.length })}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: 'text.secondary',
                  }}
                >
                  {formatDate(flow.updatedAt)}
                </Typography>
              </Stack>
              <Stack
                direction="row"
                spacing={0.25}
                sx={{
                  alignItems: 'center',
                }}
              >
                <Switch
                  checked={flow.isActive}
                  onChange={(event) => toggleFlow(flow, event.target.checked)}
                  size="small"
                  slotProps={{
                    input: { 'aria-label': flow.name },
                  }}
                />
                <Tooltip title={t('flows.test')}>
                  <IconButton
                    size="small"
                    onClick={() => testFlow(flow)}
                    aria-label={t('flows.test')}
                  >
                    <PlayArrowIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('actions.edit')}>
                  <IconButton
                    size="small"
                    onClick={() => setEditorFlow(flow)}
                    aria-label={t('actions.edit')}
                  >
                    <EditOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('actions.delete')}>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => setDeleteId(flow.id)}
                    aria-label={t('actions.delete')}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>
          </Card>
        ))}
      </Box>
      {flows !== null && flows.length === 0 && (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 6 }}>
            <Typography
              variant="body2"
              sx={{
                color: 'text.secondary',
              }}
            >
              {t('flows.empty')}
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* Create dialog */}
      <Dialog open={creating} onClose={() => setCreating(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('flows.newFlow')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.25} sx={{ pt: 1 }}>
            <TextField
              size="small"
              label={t('flows.flowName')}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              fullWidth
              autoFocus
            />
            <Box>
              <Typography
                variant="caption"
                sx={{
                  color: 'text.secondary',
                  display: 'block',
                  mb: 0.75,
                }}
              >
                {t('flows.triggerType')}
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                fullWidth
                value={newTriggerType}
                onChange={(_, value) => value && setNewTriggerType(value)}
              >
                <ToggleButton value="command">{t('flows.triggerCommand')}</ToggleButton>
                <ToggleButton value="keyword">{t('flows.triggerKeyword')}</ToggleButton>
                <ToggleButton value="start">{t('flows.triggerStart')}</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            {newTriggerType !== 'start' && (
              <TextField
                size="small"
                label={t('flows.triggerValue')}
                value={newTriggerValue}
                onChange={(event) => setNewTriggerValue(event.target.value)}
                placeholder={newTriggerType === 'command' ? '/pricing' : 'price'}
                helperText={
                  newTriggerType === 'command' ? t('flows.triggerCommandHelp') : undefined
                }
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <KeyboardDoubleArrowRightIcon fontSize="small" color="action" />
                      </InputAdornment>
                    ),
                  },
                }}
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreating(false)}>{t('actions.cancel')}</Button>
          <Button variant="contained" onClick={createFlow} disabled={!newName.trim()}>
            {t('actions.create')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Editor */}
      {editorFlow && (
        <FlowEditorDialog
          botId={botId}
          flow={editorFlow}
          onClose={() => setEditorFlow(null)}
          onSaved={reload}
        />
      )}

      <ConfirmDialog
        open={deleteId !== null}
        title={t('flows.deleteTitle')}
        message={t('flows.deleteMessage')}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </Box>
  );
}

/**
 * Scaled-down graph thumbnail for flow cards: trigger square, colored node
 * dots, and their connections, laid out with the tidy algorithm when the
 * stored graph has no canvas positions yet.
 * @param {object} props - Component props.
 * @param {FlowGraph} props.graph - Flow graph to preview.
 * @returns {React.ReactElement} Inline SVG thumbnail.
 */
function FlowThumb({ graph }: { graph: FlowGraph }): React.ReactElement {
  const { t } = useTranslation();
  const theme = useTheme();
  const width = 320;
  const height = 96;
  if (graph.nodes.length === 0) {
    return (
      <Box
        sx={{
          height,
          borderRadius: 1.5,
          border: `1px dashed ${theme.palette.divider}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Typography
          variant="caption"
          sx={{
            color: 'text.secondary',
          }}
        >
          {t('flows.noNodes')}
        </Typography>
      </Box>
    );
  }
  const positioned = isFullyPositioned(graph)
    ? graph
    : autoLayout({ ...graph, nodes: graph.nodes.map((node) => ({ ...node })) });
  const startNode = positioned.nodes.find((node) => node.id === positioned.start);
  const triggerPos = { x: (startNode?.x ?? 0) - 240, y: startNode?.y ?? 60 };
  const bounds = graphBounds(positioned, triggerPos);
  if (!bounds) return <Box sx={{ height }} />;
  const padding = 10;
  const scale = Math.min(
    (width - padding * 2) / Math.max(1, bounds.maxX - bounds.minX),
    (height - padding * 2) / Math.max(1, bounds.maxY - bounds.minY),
    1,
  );
  const offsetX =
    padding - bounds.minX * scale + (width - padding * 2 - (bounds.maxX - bounds.minX) * scale) / 2;
  const offsetY =
    padding -
    bounds.minY * scale +
    (height - padding * 2 - (bounds.maxY - bounds.minY) * scale) / 2;
  const px = (x: number): number => x * scale + offsetX;
  const py = (y: number): number => y * scale + offsetY;
  const edges = collectEdges(positioned);
  const center = (node: FlowNode): { cx: number; cy: number } => ({
    cx: px(node.x ?? 0) + 5,
    cy: py(node.y ?? 0) + 7,
  });
  return (
    <Box
      sx={{
        height,
        borderRadius: 1.5,
        backgroundColor:
          theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(15,23,42,0.025)',
        border: `1px solid ${theme.palette.divider}`,
        overflow: 'hidden',
      }}
    >
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
        {startNode && (
          <line
            x1={px(triggerPos.x) + TRIGGER_WIDTH * scale}
            y1={py(triggerPos.y) + 10}
            x2={center(startNode).cx}
            y2={center(startNode).cy}
            stroke="#eab308"
            strokeOpacity={0.6}
            strokeWidth={1.4}
          />
        )}
        {edges.map((edge) => {
          const from = positioned.nodes.find((node) => node.id === edge.from);
          const to = positioned.nodes.find((node) => node.id === edge.to);
          if (!from || !to) return null;
          const a = center(from);
          const b = center(to);
          return (
            <path
              key={edge.id}
              d={`M ${a.cx} ${a.cy} C ${a.cx + 18} ${a.cy}, ${b.cx - 18} ${b.cy}, ${b.cx} ${b.cy}`}
              fill="none"
              stroke={NODE_COLORS[from.type]}
              strokeOpacity={0.45}
              strokeWidth={1.2}
            />
          );
        })}
        {startNode && (
          <rect
            x={px(triggerPos.x)}
            y={py(triggerPos.y)}
            width={Math.max(14, TRIGGER_WIDTH * scale)}
            height={Math.max(10, 34 * scale)}
            rx={4}
            fill="rgba(234,179,8,0.12)"
            stroke="#eab308"
            strokeDasharray="3 2"
            strokeWidth={1}
          />
        )}
        {positioned.nodes.map((node) => {
          const dot = center(node);
          return (
            <circle
              key={node.id}
              cx={dot.cx}
              cy={dot.cy}
              r={5.5}
              fill={NODE_COLORS[node.type]}
              fillOpacity={0.85}
              stroke={theme.palette.background.paper}
              strokeWidth={1.5}
            />
          );
        })}
      </svg>
    </Box>
  );
}
