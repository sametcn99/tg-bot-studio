import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../services/api';
import PageHeader from '../../components/PageHeader';
import { useModuleDocs } from '../../context/ModuleDocsContext';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useSnackbar } from '../../context/SnackbarContext';
import type { ModuleEntry } from '../../registry/modules';
import { localizedErrorMessage } from '../../utils/errors';

/** Flow graph node (mirrors the server contract). */
interface FlowNode {
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
}

/** Flow graph document. */
interface FlowGraph {
  start: string;
  nodes: FlowNode[];
}

/** Flow row from the API. */
interface FlowRow {
  id: number;
  name: string;
  triggerType: 'command' | 'keyword' | 'start';
  triggerValue: string;
  isActive: boolean;
  graph: FlowGraph;
  updatedAt: string | null;
}

/** Blank node factory per type. */
function blankNode(type: FlowNode['type'], index: number): FlowNode {
  const id = `n${Date.now().toString(36)}${index}`;
  const base: FlowNode = { id, type };
  if (type === 'message' || type === 'input') return { ...base, text: '', buttons: [] };
  if (type === 'condition') return { ...base, variable: '', op: 'equals', value: '' };
  if (type === 'delay') return { ...base, minutes: 5 };
  if (type === 'settag') return { ...base, tag: '' };
  return base;
}

/**
 * Visual Flow Builder page: multi-step conversation trees with message,
 * input, condition, delay, and tag nodes — testable in the sandbox.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {ModuleEntry} props.module - Flows catalog entry.
 * @returns {React.ReactElement} The page.
 */
export default function FlowBuilderPage({
  botId,
  module,
}: {
  botId: number;
  module: ModuleEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  const { openDocs } = useModuleDocs();
  const { showSuccess, showError } = useSnackbar();
  const [flows, setFlows] = useState<FlowRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorFlow, setEditorFlow] = useState<FlowRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTriggerType, setNewTriggerType] = useState<'command' | 'keyword' | 'start'>('command');
  const [newTriggerValue, setNewTriggerValue] = useState('');
  const [deleteId, setDeleteId] = useState<number | null>(null);

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
   * Creates a flow with a two-node starter graph and opens the editor.
   * @returns {void}
   */
  function createFlow(): void {
    const name = newName.trim();
    if (!name) return;
    const start = blankNode('message', 0);
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

      <Card>
        <CardContent>
          <Stack spacing={1.5}>
            {(flows ?? []).map((flow) => (
              <Stack
                key={flow.id}
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                spacing={1}
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  px: 1.5,
                  py: 1,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="body2" fontWeight={600}>
                      {flow.name}
                    </Typography>
                    <Chip
                      size="small"
                      label={
                        flow.triggerType === 'start'
                          ? '/start'
                          : `${flow.triggerType}: ${flow.triggerValue}`
                      }
                    />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={t('flows.nodeCount', { count: flow.graph.nodes.length })}
                    />
                  </Stack>
                </Box>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Switch
                    checked={flow.isActive}
                    onChange={(event) => toggleFlow(flow, event.target.checked)}
                    size="small"
                    inputProps={{ 'aria-label': flow.name }}
                  />
                  <IconButton
                    size="small"
                    onClick={() => testFlow(flow)}
                    aria-label={t('flows.test')}
                  >
                    <PlayArrowIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => setEditorFlow(flow)}
                    aria-label={t('actions.edit')}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => setDeleteId(flow.id)}
                    aria-label={t('actions.delete')}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Stack>
            ))}
            {flows !== null && flows.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                {t('flows.empty')}
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={creating} onClose={() => setCreating(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('flows.newFlow')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              size="small"
              label={t('flows.flowName')}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              fullWidth
            />
            <TextField
              select
              size="small"
              label={t('flows.triggerType')}
              value={newTriggerType}
              onChange={(event) =>
                setNewTriggerType(event.target.value as 'command' | 'keyword' | 'start')
              }
            >
              <MenuItem value="command">{t('flows.triggerCommand')}</MenuItem>
              <MenuItem value="keyword">{t('flows.triggerKeyword')}</MenuItem>
              <MenuItem value="start">{t('flows.triggerStart')}</MenuItem>
            </TextField>
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
          onSaved={() => {
            setEditorFlow(null);
            reload();
          }}
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
 * Full-screen flow editor dialog: node cards, wiring selectors, and a compact
 * SVG minimap of the graph.
 */
function FlowEditorDialog({
  botId,
  flow,
  onClose,
  onSaved,
}: {
  botId: number;
  flow: FlowRow;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [name, setName] = useState(flow.name);
  const [triggerType, setTriggerType] = useState(flow.triggerType);
  const [triggerValue, setTriggerValue] = useState(flow.triggerValue);
  const [isActive, setIsActive] = useState(flow.isActive);
  const [graph, setGraph] = useState<FlowGraph>(
    JSON.parse(JSON.stringify(flow.graph)) as FlowGraph,
  );

  /** Node id options for wiring selects. */
  const nodeOptions = useMemo(
    () => graph.nodes.map((node) => ({ id: node.id, label: nodeLabel(node) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, t],
  );

  /**
   * Human label for a node (used in minimap and selects).
   */
  function nodeLabel(node: FlowNode): string {
    const typeLabel = t(`flows.nodeTypes.${node.type}`);
    const detail =
      node.type === 'message' || node.type === 'input'
        ? (node.text ?? '').slice(0, 24)
        : node.type === 'condition'
          ? (node.variable ?? '')
          : node.type === 'delay'
            ? `${node.minutes ?? 0}m`
            : node.type === 'settag'
              ? (node.tag ?? '')
              : '';
    return detail ? `${typeLabel}: ${detail}` : typeLabel;
  }

  /**
   * Patches one node.
   */
  function patchNode(id: string, patch: Partial<FlowNode>): void {
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
    }));
  }

  /**
   * Adds a node of the given type and optionally wires it from `fromId`.
   */
  function addNode(
    type: FlowNode['type'],
    fromId?: string,
    field?: 'next' | 'nextTrue' | 'nextFalse',
  ): void {
    setGraph((current) => {
      const node = blankNode(type, current.nodes.length);
      const nodes = [...current.nodes, node];
      if (!fromId || !field) return { ...current, nodes };
      return {
        ...current,
        nodes: nodes.map((item) => (item.id === fromId ? { ...item, [field]: node.id } : item)),
      };
    });
  }

  /**
   * Adds a message node wired as the target of one flow-navigation button.
   */
  function addNodeForButton(nodeId: string, buttonIndex: number): void {
    setGraph((current) => {
      const node = blankNode('message', current.nodes.length);
      return {
        ...current,
        nodes: [
          ...current.nodes.map((item) => {
            if (item.id !== nodeId) return item;
            const buttons = [...(item.buttons ?? [])];
            buttons[buttonIndex] = { ...buttons[buttonIndex], next: node.id };
            return { ...item, buttons };
          }),
          node,
        ],
      };
    });
  }

  /**
   * Removes a node and clears every reference to it.
   */
  function removeNode(id: string): void {
    setGraph((current) => ({
      ...current,
      start:
        current.start === id ? (current.nodes.find((n) => n.id !== id)?.id ?? '') : current.start,
      nodes: current.nodes
        .filter((node) => node.id !== id)
        .map((node) => ({
          ...node,
          next: node.next === id ? undefined : node.next,
          nextTrue: node.nextTrue === id ? undefined : node.nextTrue,
          nextFalse: node.nextFalse === id ? undefined : node.nextFalse,
          buttons: node.buttons?.map((button) =>
            button.next === id ? { ...button, next: undefined } : button,
          ),
        })),
    }));
  }

  /**
   * Saves the flow definition.
   * @returns {void}
   */
  function save(): void {
    apiFetch(`/api/bots/${botId}/flows/${flow.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, triggerType, triggerValue, graph, isActive }),
    })
      .then(() => {
        showSuccess(t('flows.saved'));
        onSaved();
      })
      .catch((err: Error) => showError(localizedErrorMessage(err)));
  }

  /**
   * Renders the wiring select for a node field.
   */
  function nextSelect(
    value: string | undefined,
    onChange: (next: string) => void,
    label: string,
  ): React.ReactElement {
    return (
      <TextField
        select
        size="small"
        fullWidth
        label={label}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      >
        <MenuItem value="">{t('flows.endOfFlow')}</MenuItem>
        {nodeOptions.map((option) => (
          <MenuItem key={option.id} value={option.id}>
            {option.label}
          </MenuItem>
        ))}
        <MenuItem value="__new__">+ {t('flows.newNode')}</MenuItem>
      </TextField>
    );
  }

  /**
   * Handles wiring selects, creating nodes on demand ("+ New node").
   */
  function handleNextChange(
    node: FlowNode,
    field: 'next' | 'nextTrue' | 'nextFalse',
    value: string,
  ): void {
    if (value === '__new__') {
      addNode('message', node.id, field);
      return;
    }
    patchNode(node.id, { [field]: value || undefined } as Partial<FlowNode>);
  }

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>{t('flows.editTitle', { name: flow.name })}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TextField
              size="small"
              label={t('flows.flowName')}
              value={name}
              onChange={(event) => setName(event.target.value)}
              fullWidth
            />
            <TextField
              select
              size="small"
              sx={{ minWidth: 150 }}
              label={t('flows.triggerType')}
              value={triggerType}
              onChange={(event) =>
                setTriggerType(event.target.value as 'command' | 'keyword' | 'start')
              }
            >
              <MenuItem value="command">{t('flows.triggerCommand')}</MenuItem>
              <MenuItem value="keyword">{t('flows.triggerKeyword')}</MenuItem>
              <MenuItem value="start">{t('flows.triggerStart')}</MenuItem>
            </TextField>
            {triggerType !== 'start' && (
              <TextField
                size="small"
                sx={{ minWidth: 160 }}
                label={t('flows.triggerValue')}
                value={triggerValue}
                onChange={(event) => setTriggerValue(event.target.value)}
              />
            )}
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="caption">{t('status.active')}</Typography>
              <Switch
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
                inputProps={{ 'aria-label': t('status.active') }}
              />
            </Stack>
          </Stack>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            {/* Node canvas */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ mb: 1 }}
              >
                <TextField
                  select
                  size="small"
                  sx={{ minWidth: 260 }}
                  label={t('flows.startNode')}
                  value={graph.start}
                  onChange={(event) => setGraph((c) => ({ ...c, start: event.target.value }))}
                >
                  {nodeOptions.map((option) => (
                    <MenuItem key={option.id} value={option.id}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
                <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                  {(['message', 'input', 'condition', 'delay', 'settag'] as const).map((type) => (
                    <Button
                      key={type}
                      size="small"
                      variant="outlined"
                      onClick={() => addNode(type)}
                    >
                      + {t(`flows.nodeTypes.${type}`)}
                    </Button>
                  ))}
                </Stack>
              </Stack>

              <Stack spacing={1.5}>
                {graph.nodes.map((node) => (
                  <Card
                    key={node.id}
                    variant="outlined"
                    sx={{
                      borderLeft: 4,
                      borderLeftColor: node.id === graph.start ? 'primary.main' : 'divider',
                    }}
                  >
                    <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Stack spacing={1.5}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Stack direction="row" spacing={1} alignItems="center">
                            {node.id === graph.start && (
                              <Chip size="small" color="primary" label={t('flows.start')} />
                            )}
                            <TextField
                              select
                              size="small"
                              sx={{ minWidth: 130 }}
                              value={node.type}
                              onChange={(event) =>
                                patchNode(node.id, {
                                  type: event.target.value as FlowNode['type'],
                                })
                              }
                            >
                              {(
                                ['message', 'input', 'condition', 'delay', 'settag', 'end'] as const
                              ).map((type) => (
                                <MenuItem key={type} value={type}>
                                  {t(`flows.nodeTypes.${type}`)}
                                </MenuItem>
                              ))}
                            </TextField>
                          </Stack>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => removeNode(node.id)}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Stack>

                        {(node.type === 'message' || node.type === 'input') && (
                          <>
                            <TextField
                              size="small"
                              fullWidth
                              multiline
                              minRows={2}
                              label={
                                node.type === 'input'
                                  ? t('flows.promptText')
                                  : t('flows.messageText')
                              }
                              value={node.text ?? ''}
                              onChange={(event) => patchNode(node.id, { text: event.target.value })}
                              helperText={t('flows.placeholdersHelp')}
                            />
                            <TextField
                              size="small"
                              fullWidth
                              label={t('flows.mediaUrl')}
                              value={node.mediaUrl ?? ''}
                              onChange={(event) =>
                                patchNode(node.id, { mediaUrl: event.target.value })
                              }
                            />
                            {(node.buttons ?? []).map((button, index) => (
                              <Stack key={index} direction="row" spacing={1} alignItems="center">
                                <TextField
                                  size="small"
                                  label={t('flows.buttonText')}
                                  value={button.text}
                                  sx={{ flex: 1 }}
                                  onChange={(event) => {
                                    const buttons = [...(node.buttons ?? [])];
                                    buttons[index] = {
                                      ...buttons[index],
                                      text: event.target.value,
                                    };
                                    patchNode(node.id, { buttons });
                                  }}
                                />
                                <TextField
                                  size="small"
                                  label={t('flows.buttonUrl')}
                                  value={button.url ?? ''}
                                  sx={{ flex: 1 }}
                                  placeholder="https://"
                                  onChange={(event) => {
                                    const buttons = [...(node.buttons ?? [])];
                                    buttons[index] = {
                                      ...buttons[index],
                                      url: event.target.value || undefined,
                                    };
                                    patchNode(node.id, { buttons });
                                  }}
                                />
                                <TextField
                                  select
                                  size="small"
                                  sx={{ minWidth: 170 }}
                                  label={t('flows.buttonNext')}
                                  value={button.next ?? ''}
                                  onChange={(event) => {
                                    const next = event.target.value;
                                    if (next === '__new__') {
                                      addNodeForButton(node.id, index);
                                      return;
                                    }
                                    const buttons = [...(node.buttons ?? [])];
                                    buttons[index] = {
                                      ...buttons[index],
                                      next: next || undefined,
                                    };
                                    patchNode(node.id, { buttons });
                                  }}
                                >
                                  <MenuItem value="">{t('flows.buttonOpensUrl')}</MenuItem>
                                  {nodeOptions
                                    .filter((option) => option.id !== node.id)
                                    .map((option) => (
                                      <MenuItem key={option.id} value={option.id}>
                                        {option.label}
                                      </MenuItem>
                                    ))}
                                  <MenuItem value="__new__">+ {t('flows.newNode')}</MenuItem>
                                </TextField>
                                <IconButton
                                  size="small"
                                  color="error"
                                  onClick={() =>
                                    patchNode(node.id, {
                                      buttons: (node.buttons ?? []).filter((_, i) => i !== index),
                                    })
                                  }
                                >
                                  <DeleteOutlineIcon fontSize="small" />
                                </IconButton>
                              </Stack>
                            ))}
                            <Button
                              size="small"
                              onClick={() =>
                                patchNode(node.id, {
                                  buttons: [...(node.buttons ?? []), { text: '' }],
                                })
                              }
                            >
                              + {t('flows.addButton')}
                            </Button>
                          </>
                        )}

                        {node.type === 'input' && (
                          <TextField
                            size="small"
                            fullWidth
                            label={t('flows.variableName')}
                            value={node.variable ?? ''}
                            onChange={(event) =>
                              patchNode(node.id, { variable: event.target.value })
                            }
                            helperText={t('flows.variableHelp')}
                          />
                        )}

                        {node.type === 'condition' && (
                          <>
                            <Stack direction="row" spacing={1}>
                              <TextField
                                size="small"
                                label={t('flows.variableName')}
                                value={node.variable ?? ''}
                                onChange={(event) =>
                                  patchNode(node.id, { variable: event.target.value })
                                }
                              />
                              <TextField
                                select
                                size="small"
                                sx={{ minWidth: 120 }}
                                label="op"
                                value={node.op ?? 'equals'}
                                onChange={(event) =>
                                  patchNode(node.id, { op: event.target.value as FlowNode['op'] })
                                }
                              >
                                <MenuItem value="equals">equals</MenuItem>
                                <MenuItem value="contains">contains</MenuItem>
                                <MenuItem value="exists">exists</MenuItem>
                              </TextField>
                              {node.op !== 'exists' && (
                                <TextField
                                  size="small"
                                  label={t('flows.compareValue')}
                                  value={node.value ?? ''}
                                  onChange={(event) =>
                                    patchNode(node.id, { value: event.target.value })
                                  }
                                />
                              )}
                            </Stack>
                            {nextSelect(
                              node.nextTrue,
                              (value) => handleNextChange(node, 'nextTrue', value),
                              t('flows.ifTrue'),
                            )}
                            {nextSelect(
                              node.nextFalse,
                              (value) => handleNextChange(node, 'nextFalse', value),
                              t('flows.ifFalse'),
                            )}
                          </>
                        )}

                        {node.type === 'delay' && (
                          <TextField
                            size="small"
                            type="number"
                            sx={{ maxWidth: 200 }}
                            label={t('flows.delayMinutes')}
                            value={node.minutes ?? 1}
                            onChange={(event) =>
                              patchNode(node.id, { minutes: Number(event.target.value) })
                            }
                          />
                        )}

                        {node.type === 'settag' && (
                          <TextField
                            size="small"
                            label={t('flows.tagName')}
                            value={node.tag ?? ''}
                            onChange={(event) => patchNode(node.id, { tag: event.target.value })}
                          />
                        )}

                        {(node.type === 'message' ||
                          node.type === 'delay' ||
                          node.type === 'settag') &&
                          nextSelect(
                            node.next,
                            (value) => handleNextChange(node, 'next', value),
                            t('flows.nextNode'),
                          )}
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
                {graph.nodes.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    {t('flows.noNodes')}
                  </Typography>
                )}
              </Stack>
            </Box>

            {/* Minimap */}
            <Box sx={{ width: { md: 280 }, flexShrink: 0 }}>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                {t('flows.minimap')}
              </Typography>
              <svg
                viewBox={`0 0 280 ${Math.max(160, graph.nodes.length * 44 + 20)}`}
                style={{
                  width: '100%',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 8,
                }}
                aria-hidden
              >
                {graph.nodes.map((node, index) => {
                  const y = index * 44 + 22;
                  const targets: Array<string | undefined> = [
                    node.next,
                    node.nextTrue,
                    node.nextFalse,
                    ...(node.buttons ?? []).map((button) => button.next),
                  ];
                  return (
                    <g key={node.id}>
                      {targets.map((target, tIndex) => {
                        const targetIndex = graph.nodes.findIndex((item) => item.id === target);
                        if (targetIndex < 0) return null;
                        const y2 = targetIndex * 44 + 22;
                        return (
                          <line
                            key={tIndex}
                            x1={60}
                            y1={y}
                            x2={200}
                            y2={y2}
                            stroke={node.id === graph.start ? '#1976d2' : '#9e9e9e'}
                            strokeWidth={1}
                          />
                        );
                      })}
                      <circle
                        cx={30}
                        cy={y}
                        r={9}
                        fill={node.id === graph.start ? '#1976d2' : '#bdbdbd'}
                      />
                      <text x={48} y={y + 4} fontSize={9}>
                        {nodeLabel(node).slice(0, 18)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </Box>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.cancel')}</Button>
        <Button variant="contained" onClick={save} disabled={!name.trim() || !graph.start}>
          {t('actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
