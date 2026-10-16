import React from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  InputAdornment,
  MenuItem,
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
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import FlagRoundedIcon from '@mui/icons-material/FlagRounded';
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import { useTranslation } from 'react-i18next';
import {
  TRIGGER_NODE_ID,
  outputPorts,
  getWireTarget,
  type FlowGraph,
  type FlowNode,
  type WireField,
} from './flowEditorModel';
import { NodeTypeIconTile } from './nodeVisuals';

/** Flow-level settings editable from the inspector. */
export interface FlowSettings {
  name: string;
  triggerType: 'command' | 'keyword' | 'start';
  triggerValue: string;
  isActive: boolean;
}

/**
 * Right-hand properties panel of the flow editor. Edits the trigger/flow
 * settings when the entry card is selected, the selected node's fields
 * otherwise, and shows shortcut hints when nothing is selected.
 * @param {object} props - Component props.
 * @param {FlowGraph} props.graph - Flow graph being edited.
 * @param {string[]} props.selectedIds - Selected node ids (may include the trigger pseudo-id).
 * @param {FlowSettings} props.settings - Current flow settings.
 * @param {(patch: Partial<FlowSettings>) => void} props.onPatchSettings - Flow settings changed.
 * @param {(id: string, patch: Partial<FlowNode>) => void} props.onPatchNode - Node field changed.
 * @param {(id: string) => void} props.onSetStart - Make the node the start entry.
 * @param {(id: string) => void} props.onDuplicate - Duplicate the node.
 * @param {(ids: string[]) => void} props.onDeleteNodes - Delete nodes by id.
 * @returns {React.ReactElement} The inspector panel.
 */
export default function FlowInspector({
  graph,
  selectedIds,
  settings,
  onPatchSettings,
  onPatchNode,
  onSetStart,
  onDuplicate,
  onDeleteNodes,
}: {
  graph: FlowGraph;
  selectedIds: string[];
  settings: FlowSettings;
  onPatchSettings: (patch: Partial<FlowSettings>) => void;
  onPatchNode: (id: string, patch: Partial<FlowNode>) => void;
  onSetStart: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDeleteNodes: (ids: string[]) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const theme = useTheme();

  /**
   * Human label for a node used in target selects.
   */
  function nodeOptionLabel(node: FlowNode): string {
    const typeLabel = t(`flows.nodeTypes.${node.type}`);
    const detail =
      node.type === 'message' || node.type === 'input'
        ? (node.text ?? '').slice(0, 20)
        : node.type === 'condition'
          ? node.variable || '…'
          : node.type === 'delay'
            ? `${node.minutes ?? 0}m`
            : node.type === 'settag'
              ? node.tag || '…'
              : '';
    return detail ? `${typeLabel}: ${detail}` : typeLabel;
  }

  /**
   * Select listing every other node as a wire target (fallback for ports).
   */
  function wireSelect(
    nodeId: string,
    field: WireField,
    buttonIndex: number | undefined,
    label: string,
  ): React.ReactElement {
    const node = graph.nodes.find((item) => item.id === nodeId);
    const value = node ? (getWireTarget(node, field, buttonIndex) ?? '') : '';
    return (
      <TextField
        select
        size="small"
        fullWidth
        label={label}
        value={value}
        onChange={(event) => {
          const target = event.target.value || undefined;
          const patch: Partial<FlowNode> =
            field === 'button'
              ? {
                  buttons: (node?.buttons ?? []).map((button, index) =>
                    index === buttonIndex ? { ...button, next: target } : button,
                  ),
                }
              : ({ [field]: target } as Partial<FlowNode>);
          onPatchNode(nodeId, patch);
        }}
      >
        <MenuItem value="">{t('flows.endOfFlow')}</MenuItem>
        {graph.nodes
          .filter((item) => item.id !== nodeId)
          .map((item) => (
            <MenuItem key={item.id} value={item.id}>
              {nodeOptionLabel(item)}
            </MenuItem>
          ))}
      </TextField>
    );
  }

  /**
   * Trigger / flow settings section.
   */
  function renderTriggerSettings(): React.ReactElement {
    return (
      <Stack spacing={2}>
        <Typography variant="subtitle2">{t('flows.flowSettings')}</Typography>
        <TextField
          size="small"
          fullWidth
          label={t('flows.flowName')}
          value={settings.name}
          onChange={(event) => onPatchSettings({ name: event.target.value })}
        />
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
            {t('flows.triggerType')}
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            fullWidth
            value={settings.triggerType}
            onChange={(_, value) => value && onPatchSettings({ triggerType: value })}
          >
            <ToggleButton value="command">{t('flows.triggerCommand')}</ToggleButton>
            <ToggleButton value="keyword">{t('flows.triggerKeyword')}</ToggleButton>
            <ToggleButton value="start">{t('flows.triggerStart')}</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        {settings.triggerType !== 'start' && (
          <TextField
            size="small"
            fullWidth
            label={t('flows.triggerValue')}
            value={settings.triggerValue}
            placeholder={settings.triggerType === 'command' ? '/pricing' : 'price'}
            helperText={
              settings.triggerType === 'command' ? t('flows.triggerCommandHelp') : undefined
            }
            onChange={(event) => onPatchSettings({ triggerValue: event.target.value })}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <KeyboardDoubleArrowRightIcon fontSize="small" color="action" />
                </InputAdornment>
              ),
            }}
          />
        )}
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Typography variant="body2">{t('status.active')}</Typography>
          <Switch
            size="small"
            checked={settings.isActive}
            onChange={(event) => onPatchSettings({ isActive: event.target.checked })}
            inputProps={{ 'aria-label': t('status.active') }}
          />
        </Stack>
        <Divider />
        <Typography variant="caption" color="text.secondary">
          {t('flows.triggerSettingsHint')}
        </Typography>
      </Stack>
    );
  }

  /**
   * Empty-state shortcut hints.
   */
  function renderEmptyState(): React.ReactElement {
    const shortcuts: Array<[string, string]> = [
      [t('flows.shortcutAdd'), t('flows.shortcutAddHint')],
      [t('flows.shortcutWire'), t('flows.shortcutWireHint')],
      [t('flows.shortcutPan'), t('flows.shortcutPanHint')],
      ['Ctrl+Z / Ctrl+Y', t('flows.shortcutUndoHint')],
      ['Del', t('flows.shortcutDeleteHint')],
      ['Ctrl+S', t('flows.shortcutSaveHint')],
    ];
    return (
      <Stack spacing={1.5}>
        <Typography variant="subtitle2">{t('flows.inspector')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t('flows.inspectorEmpty')}
        </Typography>
        <Divider sx={{ my: 0.5 }} />
        <Typography variant="caption" color="text.secondary" fontWeight={700}>
          {t('flows.shortcuts')}
        </Typography>
        {shortcuts.map(([keys, hint]) => (
          <Stack key={keys} direction="row" spacing={1} alignItems="center">
            <Chip
              size="small"
              label={keys}
              sx={{ height: 22, fontSize: 11, fontFamily: 'monospace', flexShrink: 0 }}
            />
            <Typography variant="caption" color="text.secondary">
              {hint}
            </Typography>
          </Stack>
        ))}
      </Stack>
    );
  }

  /**
   * Buttons editor for message/input nodes.
   */
  function renderButtonsEditor(node: FlowNode): React.ReactNode {
    const buttons = node.buttons ?? [];
    return (
      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
          {t('flows.inlineButtons')}
        </Typography>
        <Stack spacing={1.25}>
          {buttons.map((button, index) => {
            const hasUrl = Boolean(button.url);
            return (
              <Stack
                key={index}
                spacing={0.75}
                sx={{
                  p: 1,
                  borderRadius: 1.5,
                  border: `1px solid ${theme.palette.divider}`,
                  backgroundColor:
                    theme.palette.mode === 'dark'
                      ? 'rgba(255,255,255,0.02)'
                      : 'rgba(15,23,42,0.02)',
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField
                    size="small"
                    label={`${t('flows.buttonText')} ${index + 1}`}
                    value={button.text}
                    sx={{ flex: 1 }}
                    onChange={(event) =>
                      onPatchNode(node.id, {
                        buttons: buttons.map((item, i) =>
                          i === index ? { ...item, text: event.target.value } : item,
                        ),
                      })
                    }
                  />
                  <Tooltip title={hasUrl ? t('flows.buttonOpensUrl') : t('flows.buttonNavigates')}>
                    <IconButton
                      size="small"
                      onClick={() =>
                        onPatchNode(node.id, {
                          buttons: buttons.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  url: hasUrl ? undefined : 'https://',
                                  next: hasUrl ? item.next : undefined,
                                }
                              : item,
                          ),
                        })
                      }
                    >
                      <LinkRoundedIcon
                        fontSize="small"
                        color={hasUrl ? 'primary' : 'action'}
                        sx={!hasUrl ? { opacity: 0.4 } : undefined}
                      />
                    </IconButton>
                  </Tooltip>
                  <IconButton
                    size="small"
                    color="error"
                    aria-label={t('actions.delete')}
                    onClick={() =>
                      onPatchNode(node.id, {
                        buttons: buttons.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Stack>
                {hasUrl ? (
                  <TextField
                    size="small"
                    fullWidth
                    label={t('flows.buttonUrl')}
                    placeholder="https://"
                    value={button.url ?? ''}
                    onChange={(event) =>
                      onPatchNode(node.id, {
                        buttons: buttons.map((item, i) =>
                          i === index ? { ...item, url: event.target.value } : item,
                        ),
                      })
                    }
                  />
                ) : (
                  wireSelect(node.id, 'button', index, t('flows.buttonNext'))
                )}
              </Stack>
            );
          })}
          <Button
            size="small"
            startIcon={<AddIcon />}
            disabled={buttons.length >= 8}
            onClick={() => onPatchNode(node.id, { buttons: [...buttons, { text: '' }] })}
          >
            {t('flows.addButton')}
          </Button>
        </Stack>
      </Box>
    );
  }

  /**
   * Selected node editor.
   */
  function renderNodeEditor(node: FlowNode): React.ReactElement {
    return (
      <Stack spacing={2}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <NodeTypeIconTile type={node.type} size={34} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ lineHeight: 1.2 }}>
              {t(`flows.nodeTypes.${node.type}`)}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
              {node.id}
            </Typography>
          </Box>
        </Stack>

        {(node.type === 'message' || node.type === 'input') && (
          <>
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={3}
              label={node.type === 'input' ? t('flows.promptText') : t('flows.messageText')}
              value={node.text ?? ''}
              onChange={(event) => onPatchNode(node.id, { text: event.target.value })}
              helperText={t('flows.placeholdersHelp')}
            />
            <TextField
              size="small"
              fullWidth
              label={t('flows.mediaUrl')}
              value={node.mediaUrl ?? ''}
              onChange={(event) => onPatchNode(node.id, { mediaUrl: event.target.value })}
            />
            {renderButtonsEditor(node)}
          </>
        )}

        {node.type === 'input' && (
          <TextField
            size="small"
            fullWidth
            label={t('flows.variableName')}
            value={node.variable ?? ''}
            onChange={(event) => onPatchNode(node.id, { variable: event.target.value })}
            helperText={t('flows.variableHelp')}
          />
        )}

        {node.type === 'condition' && (
          <>
            <TextField
              size="small"
              fullWidth
              label={t('flows.variableName')}
              value={node.variable ?? ''}
              onChange={(event) => onPatchNode(node.id, { variable: event.target.value })}
            />
            <Stack direction="row" spacing={1}>
              <TextField
                select
                size="small"
                sx={{ minWidth: 120 }}
                label={t('flows.compareOp')}
                value={node.op ?? 'equals'}
                onChange={(event) =>
                  onPatchNode(node.id, { op: event.target.value as FlowNode['op'] })
                }
              >
                <MenuItem value="equals">{t('flows.opEquals')}</MenuItem>
                <MenuItem value="contains">{t('flows.opContains')}</MenuItem>
                <MenuItem value="exists">{t('flows.opExists')}</MenuItem>
              </TextField>
              {node.op !== 'exists' && (
                <TextField
                  size="small"
                  fullWidth
                  label={t('flows.compareValue')}
                  value={node.value ?? ''}
                  onChange={(event) => onPatchNode(node.id, { value: event.target.value })}
                />
              )}
            </Stack>
          </>
        )}

        {node.type === 'delay' && (
          <TextField
            size="small"
            type="number"
            sx={{ maxWidth: 220 }}
            label={t('flows.delayMinutes')}
            value={node.minutes ?? 1}
            onChange={(event) => onPatchNode(node.id, { minutes: Number(event.target.value) })}
          />
        )}

        {node.type === 'settag' && (
          <TextField
            size="small"
            fullWidth
            label={t('flows.tagName')}
            value={node.tag ?? ''}
            onChange={(event) => onPatchNode(node.id, { tag: event.target.value })}
          />
        )}

        {node.type !== 'end' && node.type !== 'condition' && node.type !== 'input' && (
          <Divider sx={{ my: 0.5 }} />
        )}
        {node.type !== 'end' &&
          node.type !== 'condition' &&
          outputPorts(node, t)
            .filter((port) => port.field !== 'button')
            .map((port) => (
              <Box key={port.field}>{wireSelect(node.id, port.field, undefined, port.label)}</Box>
            ))}

        <Divider />
        <Stack direction="row" spacing={1}>
          {graph.start !== node.id && (
            <Button
              size="small"
              startIcon={<FlagRoundedIcon />}
              onClick={() => onSetStart(node.id)}
            >
              {t('flows.setAsStart')}
            </Button>
          )}
          <Button
            size="small"
            startIcon={<ContentCopyRoundedIcon />}
            onClick={() => onDuplicate(node.id)}
          >
            {t('flows.duplicate')}
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button
            size="small"
            color="error"
            startIcon={<DeleteOutlineIcon />}
            onClick={() => onDeleteNodes([node.id])}
          >
            {t('actions.delete')}
          </Button>
        </Stack>
      </Stack>
    );
  }

  /**
   * Multi-selection actions.
   */
  function renderBulkEditor(ids: string[]): React.ReactElement {
    return (
      <Stack spacing={1.5}>
        <Typography variant="subtitle2">{t('flows.multiSelect', { count: ids.length })}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t('flows.multiSelectHint')}
        </Typography>
        <Button
          size="small"
          color="error"
          startIcon={<DeleteOutlineIcon />}
          onClick={() => onDeleteNodes(ids)}
        >
          {t('flows.deleteSelection')}
        </Button>
      </Stack>
    );
  }

  const isTrigger = selectedIds.length === 1 && selectedIds[0] === TRIGGER_NODE_ID;
  const nodeIds = selectedIds.filter((id) => id !== TRIGGER_NODE_ID);
  const singleNode =
    selectedIds.length === 1 && !isTrigger
      ? (graph.nodes.find((item) => item.id === selectedIds[0]) ?? null)
      : null;

  return (
    <Box
      sx={{
        width: 320,
        flexShrink: 0,
        borderLeft: `1px solid ${theme.palette.divider}`,
        overflowY: 'auto',
        p: 2,
      }}
    >
      {isTrigger
        ? renderTriggerSettings()
        : nodeIds.length > 1
          ? renderBulkEditor(nodeIds)
          : singleNode
            ? renderNodeEditor(singleNode)
            : renderEmptyState()}
    </Box>
  );
}
