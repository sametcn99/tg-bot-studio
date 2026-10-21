import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import LinkIcon from '@mui/icons-material/Link';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import { useUnsavedGuard } from '../hooks/useUnsavedGuard';
import PageHeader from './PageHeader';
import ConfirmDialog from './ConfirmDialog';
import DataTable, { type Column } from './DataTable';
import { ConnectionSelect, ConnectionMultiSelect } from './ConnectionSelect';
import VisualButtonBuilder from './VisualButtonBuilder';
import VisualDripStepsBuilder from './VisualDripStepsBuilder';
import { LoadingState } from './Feedback';
import { useSnackbar } from '../context/SnackbarContext';
import { useModuleDocs } from '../context/ModuleDocsContext';
import { openSimulatorWith } from '../utils/simulatorBus';
import AiGenerateButton from './AiGenerateButton';
import TemplatePicker from './TemplatePicker';
import type { CrudField, ModuleEntry } from '../registry/modules';
import type { ContentTemplateKind } from '../registry/templates';
import { localizedErrorMessage } from '../utils/errors';

/**
 * Form fields that support "Create with AI", mapped to the generation kind.
 */
const AI_FIELD_KINDS: Record<string, string> = {
  responseText: 'autoresponder',
  steps: 'drip-steps',
  buttons: 'buttons',
  messageText: 'broadcast',
};

/**
 * Form fields that offer a curated content template, mapped to template kind.
 */
const TEMPLATE_FIELD_KINDS: Record<string, ContentTemplateKind> = {
  steps: 'drip-steps',
  responseText: 'autoresponder',
};

/**
 * Field widgets too large for the create/edit dialog's two-column grid —
 * they always span the full dialog width.
 */
const WIDE_FORM_FIELD_TYPES = new Set(['textarea', 'json', 'mediaUpload', 'stringList']);

/**
 * Generic bot-scoped CRUD page driven by a registry resource descriptor:
 * a searchable/sortable/paginated data table, a create/edit dialog with
 * busy-state protection, delete confirmation, row reordering for ordered
 * resources, an optional module configuration card, and the standard docs
 * dialog.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {ModuleEntry} props.module - Module catalog entry with `crud`.
 * @returns {React.ReactElement} The CRUD page.
 */
export default function CrudPage({
  botId,
  module,
}: {
  botId: string;
  module: ModuleEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const { openDocs } = useModuleDocs();
  const resource = module.crud!;
  const endpoint = resource.endpoint.replace('{botId}', String(botId));

  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [submitBusy, setSubmitBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
  const [configDirty, setConfigDirty] = useState(false);
  const [reorderBusy, setReorderBusy] = useState(false);
  const theme = useTheme();
  const compactDialogs = useMediaQuery(theme.breakpoints.down('sm'));

  const reload = useCallback(() => {
    apiFetch<Record<string, unknown>[]>(`/api${endpoint}`)
      .then(setRows)
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }, [endpoint]);

  const loading = rows === null;

  useEffect(() => {
    reload();
    apiFetch<Array<{ key: string; isEnabled: boolean; config: Record<string, unknown> }>>(
      `/api/bots/${botId}/modules`,
    )
      .then((modules) => {
        const found = modules.find((entry) => entry.key === module.key);
        setEnabled(found?.isEnabled ?? false);
        setConfig(found?.config ?? {});
      })
      .catch(() => undefined);
  }, [reload, botId, module.key]);

  // Warn before leaving with an open dialog or unsaved module config — both
  // on tab close/reload (beforeunload) and on in-app route changes (blocker).
  const unsavedGuard = useUnsavedGuard(Boolean(form) || configDirty);

  /** The form field driving row order, when the resource is ordered. */
  const orderField = useMemo(
    () => resource.formFields.find((field) => field.key === 'orderIndex'),
    [resource.formFields],
  );

  /** Command-driven resources can trigger their rule from the simulator. */
  const canTestInSimulator = resource.formFields.some((field) => field.key === 'command');

  /**
   * Rows sorted by the order field when present, otherwise as returned.
   * @returns {Record<string, unknown>[]} Display-ordered rows.
   */
  const orderedRows = useMemo(() => {
    if (!rows) return [];
    if (!orderField) return rows;
    const serverKey = serverKeyFor(orderField.key);
    return [...rows].sort((a, b) => Number(a[serverKey] ?? 0) - Number(b[serverKey] ?? 0));
  }, [rows, orderField]);

  /**
   * Opens the create dialog with initial values.
   * @returns {void}
   */
  function openCreate(): void {
    setEditingId(null);
    setForm({ ...resource.initialForm });
  }

  /**
   * Opens the edit dialog seeded from the row.
   * @param {Record<string, unknown>} row - Row being edited.
   * @returns {void}
   */
  function openEdit(row: Record<string, unknown>): void {
    setEditingId(String(row.id));
    const seeded: Record<string, unknown> = { ...resource.initialForm };
    if (row.media_mime !== undefined || row.mediaMime !== undefined) {
      seeded.mediaMime = row.media_mime ?? row.mediaMime;
    }
    if (row.media_file_name !== undefined || row.mediaFileName !== undefined) {
      seeded.mediaFileName = row.media_file_name ?? row.mediaFileName;
    }
    if (row.media_url !== undefined || row.mediaUrl !== undefined) {
      seeded.mediaUrl = row.media_url ?? row.mediaUrl;
    }
    for (const field of resource.formFields) {
      const serverKey = serverKeyFor(field.key);
      if (row[serverKey] !== undefined) {
        if (field.type === 'json') {
          seeded[field.key] = JSON.stringify(row[serverKey], null, 2);
        } else if (field.type === 'switch') {
          seeded[field.key] = Boolean(row[serverKey]);
        } else if (field.type === 'chatMultiSelect') {
          const raw = row[serverKey];
          let list: unknown[] = [];
          if (Array.isArray(raw)) {
            list = raw;
          } else if (typeof raw === 'string') {
            // JSON-encoded lists (giveaways) parse; bare scalars
            // (@username, numeric id) wrap into a single-entry list.
            try {
              const parsed = JSON.parse(raw) as unknown;
              list = Array.isArray(parsed) ? parsed : [raw];
            } catch {
              list = [raw];
            }
          } else if (raw !== null && raw !== undefined) {
            list = [raw];
          }
          seeded[field.key] = list.map((entry) => String(entry));
        } else {
          seeded[field.key] = row[serverKey];
        }
      }
    }
    setForm(seeded);
  }

  /**
   * Maps a camelCase form key to the snake_case row key.
   * @param {string} key - Form field key.
   * @returns {string} Row property key.
   */
  function serverKeyFor(key: string): string {
    const mapped: Record<string, string> = {
      responseText: 'response_text',
      mediaUrl: 'media_url',
      mediaData: 'media_data',
      mediaMime: 'media_mime',
      mediaFileName: 'media_file_name',
      messageText: 'message_text',
      targetChatId: 'target_chat_id',
      chatId: 'chat_id',
      matchMode: 'match_mode',
      adminOnly: 'admin_only',
      repeatSeconds: 'repeat_seconds',
      deletePreviousResponse: 'delete_previous_response',
      replyToMessage: 'reply_to_message',
      scheduledAt: 'scheduled_at',
      winnersCount: 'winners_count',
      prizeDetails: 'prize_details',
      requiredChannels: 'required_channels_json',
      endsAt: 'ends_at',
      orderIndex: 'order_index',
    };
    return mapped[key] ?? key;
  }

  /**
   * Submits the create/edit dialog.
   * @returns {void}
   */
  function submit(): void {
    if (!form || submitBusy) return;
    const payload: Record<string, unknown> = { ...form };
    for (const field of resource.formFields) {
      if (field.type === 'json' && typeof payload[field.key] === 'string') {
        const text = String(payload[field.key]).trim();
        if (text) {
          try {
            payload[field.key] = JSON.parse(text);
          } catch {
            showError(t('modules.invalidJson', { field: field.label || field.key }));
            return;
          }
        } else {
          payload[field.key] = undefined;
        }
      }
      if (field.type === 'chatSelect' && typeof payload[field.key] === 'string') {
        const text = String(payload[field.key]).trim();
        payload[field.key] = /^-?\d+$/.test(text) ? Number(text) : text || undefined;
      }
      if (field.type === 'switch') {
        payload[field.key] = Boolean(payload[field.key]);
      }
      if (field.type === 'chatMultiSelect') {
        const list = Array.isArray(payload[field.key]) ? payload[field.key] : [];
        payload[field.key] = (list as unknown[])
          .map((entry) => String(entry).trim())
          .filter(Boolean);
      }
    }
    const url = editingId ? `/api${endpoint}/${editingId}` : `/api${endpoint}`;
    const method = editingId ? 'PATCH' : 'POST';
    setSubmitBusy(true);
    apiFetch(url, { method, body: JSON.stringify(payload) })
      .then(() => {
        setForm(null);
        showSuccess(t('common.saved'));
        reload();
      })
      .catch((err: Error) => showError(localizedErrorMessage(err)))
      .finally(() => setSubmitBusy(false));
  }

  /**
   * Confirms deletion of a row.
   * @returns {void}
   */
  function confirmDelete(): void {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    apiFetch(`/api${endpoint}/${deleting.id}`, { method: 'DELETE' })
      .then(() => {
        setDeleting(null);
        showSuccess(t('common.deleted'));
        reload();
      })
      .catch((err: Error) => showError(localizedErrorMessage(err)))
      .finally(() => setDeleteBusy(false));
  }

  /**
   * Persists the module configuration card.
   * @returns {void}
   */
  function saveConfig(): void {
    if (configBusy) return;
    setConfigBusy(true);
    apiFetch(`/api/bots/${botId}/modules/${module.key}`, {
      method: 'PUT',
      body: JSON.stringify({ isEnabled: enabled, config }),
    })
      .then(() => {
        setError(null);
        setConfigDirty(false);
        showSuccess(t('modules.configSaved'));
      })
      .catch((err: Error) => showError(localizedErrorMessage(err)))
      .finally(() => setConfigBusy(false));
  }

  /**
   * Swaps an ordered row with its neighbor by exchanging order values.
   * @param {Record<string, unknown>} row - Row being moved.
   * @param {-1 | 1} direction - Move direction (-1 up, +1 down).
   * @returns {void}
   */
  function moveRow(row: Record<string, unknown>, direction: -1 | 1): void {
    if (!orderField || reorderBusy) return;
    const serverKey = serverKeyFor(orderField.key);
    const index = orderedRows.findIndex((entry) => entry.id === row.id);
    const neighbor = orderedRows[index + direction];
    if (index < 0 || !neighbor) return;
    setReorderBusy(true);
    const rowOrder = Number(row[serverKey] ?? index);
    const neighborOrder = Number(neighbor[serverKey] ?? index + direction);
    void Promise.all([
      apiFetch(`/api${endpoint}/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [orderField.key]: neighborOrder }),
      }),
      apiFetch(`/api${endpoint}/${neighbor.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [orderField.key]: rowOrder }),
      }),
    ])
      .then(() => reload())
      .catch((err: Error) => showError(localizedErrorMessage(err)))
      .finally(() => setReorderBusy(false));
  }

  /** DataTable column set: registry columns plus a trailing actions column. */
  const columns: Column<Record<string, unknown>>[] = useMemo(
    () => [
      ...resource.columns.map<Column<Record<string, unknown>>>((column) => ({
        id: column.key,
        label: column.label,
        align: column.type === 'number' ? 'right' : 'left',
        getValue: (row) => row[column.key],
        render: (row) => <CellValue value={row[column.key]} type={column.type} />,
      })),
      {
        id: 'actions',
        label: t('common.actions'),
        align: 'right',
        sortable: false,
        render: (row) => (
          <Stack
            direction="row"
            spacing={0.25}
            onClick={(event) => event.stopPropagation()}
            sx={{
              justifyContent: 'flex-end',
            }}
          >
            {orderField && (
              <>
                <Tooltip title={t('crud.moveUp')}>
                  <IconButton
                    size="small"
                    disabled={reorderBusy || orderedRows[0]?.id === row.id}
                    onClick={() => moveRow(row, -1)}
                    aria-label={`${t('crud.moveUp')} ${String(row.id ?? '')}`}
                  >
                    <ArrowUpwardIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('crud.moveDown')}>
                  <IconButton
                    size="small"
                    disabled={reorderBusy || orderedRows[orderedRows.length - 1]?.id === row.id}
                    onClick={() => moveRow(row, 1)}
                    aria-label={`${t('crud.moveDown')} ${String(row.id ?? '')}`}
                  >
                    <ArrowDownwardIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            )}
            {canTestInSimulator && (
              <Tooltip title={t('crud.testInSimulator')}>
                <IconButton
                  size="small"
                  onClick={() => {
                    const command = String(row.command ?? '').trim();
                    if (command)
                      openSimulatorWith(command.startsWith('/') ? command : `/${command}`);
                  }}
                  aria-label={`${t('crud.testInSimulator')} ${String(row.id ?? '')}`}
                >
                  <PlayArrowIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={t('actions.edit')}>
              <IconButton
                size="small"
                onClick={() => openEdit(row)}
                aria-label={`${t('actions.edit')} ${String(row.id ?? '')}`}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('actions.delete')}>
              <IconButton
                size="small"
                onClick={() => setDeleting(row)}
                aria-label={`${t('actions.delete')} ${String(row.id ?? '')}`}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resource.columns, orderField, orderedRows, reorderBusy, t],
  );

  return (
    <Box>
      <PageHeader
        title={module.name}
        subtitle={module.description}
        onDocs={() => openDocs(module)}
        actions={
          <Stack direction="row" spacing={1}>
            <Tooltip title={t('actions.refresh')}>
              <IconButton
                size="small"
                onClick={reload}
                aria-label={`${t('actions.refresh')} ${module.name}`}
              >
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
              {t('actions.add')}
            </Button>
          </Stack>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {module.configFields && module.configFields.length > 0 && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Stack
              direction="row"
              sx={{
                justifyContent: 'space-between',
                alignItems: 'center',
                mb: 2,
              }}
            >
              <Typography variant="subtitle2">{t('modules.settings')}</Typography>
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  alignItems: 'center',
                }}
              >
                <Typography
                  variant="caption"
                  id={`${module.key}-switch-label`}
                  sx={{
                    color: 'text.secondary',
                  }}
                >
                  {enabled ? t('status.enabled') : t('status.disabled')}
                </Typography>
                <Switch
                  checked={enabled}
                  onChange={(event) => {
                    setEnabled(event.target.checked);
                    setConfigDirty(true);
                  }}
                  slotProps={{
                    input: { 'aria-label': `${module.name} ${t('status.enabled')}` },
                  }}
                />
                <Button size="small" onClick={saveConfig} disabled={configBusy}>
                  {configBusy ? t('common.saving') : t('actions.save')}
                </Button>
              </Stack>
            </Stack>
            <Stack spacing={2}>
              {module.configFields.map((field) =>
                field.type === 'switch' ? (
                  <TextField
                    key={field.key}
                    label={field.label}
                    size="small"
                    fullWidth
                    select
                    value={
                      config[field.key] === true || config[field.key] === 'true' ? 'true' : 'false'
                    }
                    onChange={(event) => {
                      setConfig((current) => ({
                        ...current,
                        [field.key]: event.target.value === 'true',
                      }));
                      setConfigDirty(true);
                    }}
                    helperText={field.help}
                  >
                    <MenuItem value="true">{t('common.on')}</MenuItem>
                    <MenuItem value="false">{t('common.off')}</MenuItem>
                  </TextField>
                ) : (
                  <TextField
                    key={field.key}
                    label={field.label}
                    size="small"
                    fullWidth
                    select={field.type === 'select'}
                    multiline={field.type === 'textarea'}
                    minRows={field.type === 'textarea' ? 2 : undefined}
                    value={
                      field.type === 'select'
                        ? String(config[field.key] ?? field.options?.[0] ?? '')
                        : String(config[field.key] ?? '')
                    }
                    onChange={(event) => {
                      setConfig((current) => ({ ...current, [field.key]: event.target.value }));
                      setConfigDirty(true);
                    }}
                    helperText={field.help}
                  >
                    {field.type === 'select' &&
                      (field.options ?? []).map((option) => (
                        <MenuItem key={option} value={option}>
                          {option}
                        </MenuItem>
                      ))}
                  </TextField>
                ),
              )}
            </Stack>
          </CardContent>
        </Card>
      )}

      <Card sx={{ p: 1 }}>
        {loading ? (
          <LoadingState label={t('common.loading')} />
        ) : (
          <DataTable
            rows={orderedRows}
            columns={columns}
            keyField="id"
            ariaLabel={`${module.name} records`}
          />
        )}
      </Card>

      <Dialog
        open={Boolean(form)}
        onClose={() => setForm(null)}
        maxWidth="md"
        fullWidth
        fullScreen={compactDialogs}
        aria-labelledby="crud-form-dialog-title"
      >
        <DialogTitle id="crud-form-dialog-title">
          {editingId ? t('actions.edit') : t('actions.create')} - {module.name}
        </DialogTitle>
        <DialogContent>
          <Box
            sx={{
              pt: 1,
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
              gap: 2,
              alignItems: 'start',
            }}
          >
            {resource.formFields.map((field) => (
              <Box
                key={field.key}
                sx={{ gridColumn: WIDE_FORM_FIELD_TYPES.has(field.type) ? '1 / -1' : undefined }}
              >
                {AI_FIELD_KINDS[field.key] && (
                  <Box sx={{ mb: 0.5, display: 'flex', justifyContent: 'flex-end' }}>
                    <AiGenerateButton
                      botId={botId}
                      kind={AI_FIELD_KINDS[field.key]}
                      onResult={(value) =>
                        setForm((current) => ({ ...(current ?? {}), [field.key]: value }))
                      }
                    />
                  </Box>
                )}
                {TEMPLATE_FIELD_KINDS[field.key] && (
                  <Box sx={{ mb: 0.5, display: 'flex', justifyContent: 'flex-end' }}>
                    <TemplatePicker
                      moduleKey={module.key}
                      kind={TEMPLATE_FIELD_KINDS[field.key]}
                      onPick={(payload) =>
                        setForm((current) => ({
                          ...(current ?? {}),
                          [field.key]:
                            typeof payload === 'string'
                              ? payload
                              : JSON.stringify(payload, null, 2),
                        }))
                      }
                    />
                  </Box>
                )}
                <CrudFormField
                  botId={botId}
                  field={field}
                  value={form?.[field.key]}
                  form={form}
                  onFormChange={(updates) =>
                    setForm((current) => ({ ...(current ?? {}), ...updates }))
                  }
                  onChange={(value) =>
                    setForm((current) => ({ ...(current ?? {}), [field.key]: value }))
                  }
                />
              </Box>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForm(null)}>{t('actions.cancel')}</Button>
          <Button variant="contained" onClick={submit} disabled={submitBusy}>
            {submitBusy ? t('common.saving') : t('actions.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={t('actions.delete')}
        message={t('modules.recordRemoved')}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />

      {unsavedGuard}
    </Box>
  );
}

/**
 * Renders a table cell value with light formatting.
 * @param {object} props - Component props.
 * @param {unknown} props.value - Raw cell value.
 * @param {'bool'|'text'|'number'} [props.type] - Rendering hint.
 * @returns {React.ReactElement} The cell content.
 */
function CellValue({
  value,
  type,
}: {
  value: unknown;
  type?: 'bool' | 'text' | 'number' | 'media';
}): React.ReactElement {
  const { t } = useTranslation();
  if (type === 'media') {
    if (!value) {
      return (
        <Typography variant="body2" color="text.secondary">
          —
        </Typography>
      );
    }
    const str = String(value);
    const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(str);
    return (
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        {isVideo ? (
          <Chip size="small" label="Video" variant="outlined" />
        ) : (
          <Box
            component="img"
            src={str}
            alt="media"
            sx={{
              width: 34,
              height: 34,
              objectFit: 'cover',
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
            }}
          />
        )}
      </Box>
    );
  }
  if (type === 'bool') {
    return (
      <Typography variant="body2" color={value ? 'success.main' : 'text.secondary'}>
        {value ? t('status.active') : t('common.off')}
      </Typography>
    );
  }
  const text =
    typeof value === 'string' && value.length > 60
      ? `${value.slice(0, 60)}...`
      : String(value ?? '');
  return <Typography variant="body2">{text}</Typography>;
}

/**
 * Renders a CRUD form field widget.
 * @param {object} props - Component props.
 * @param {CrudField} props.field - Field descriptor.
 * @param {unknown} props.value - Current value.
 * @param {(value: unknown) => void} props.onChange - Change callback.
 * @returns {React.ReactElement} The widget.
 */
function CrudFormField({
  botId,
  field,
  value,
  form,
  onFormChange,
  onChange,
}: {
  botId?: string;
  field: CrudField;
  value: unknown;
  form?: Record<string, unknown> | null;
  onFormChange?: (updates: Record<string, unknown>) => void;
  onChange: (value: unknown) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const common = {
    label: field.label,
    fullWidth: true,
    size: 'small' as const,
    helperText: field.help,
  };
  switch (field.type) {
    case 'switch':
      return (
        <Stack spacing={0.5}>
          <FormControlLabel
            control={
              <Switch
                checked={Boolean(value)}
                onChange={(event) => onChange(event.target.checked)}
              />
            }
            label={field.label}
          />
          {field.help && (
            <Typography variant="caption" color="text.secondary" sx={{ pl: 1 }}>
              {field.help}
            </Typography>
          )}
        </Stack>
      );
    case 'chatSelect':
      return (
        <ConnectionSelect
          label={field.label}
          value={value === undefined || value === null || value === 0 ? '' : String(value)}
          onChange={(next) => onChange(next)}
          types={field.connectionTypes}
          helperText={field.help}
          botId={botId}
        />
      );
    case 'chatMultiSelect':
      return (
        <ConnectionMultiSelect
          label={field.label}
          value={Array.isArray(value) ? (value as string[]).map(String) : []}
          onChange={(next) => onChange(next)}
          types={field.connectionTypes}
          helperText={field.help}
          botId={botId}
        />
      );
    case 'number':
      return (
        <TextField
          {...common}
          type="number"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      );
    case 'textarea':
      return (
        <TextField
          {...common}
          multiline
          minRows={3}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'json':
      if (field.key === 'buttons') {
        return (
          <VisualButtonBuilder
            label={field.label}
            value={String(value ?? '')}
            onChange={(v) => onChange(v)}
            helperText={field.help}
          />
        );
      }
      if (field.key === 'steps') {
        return (
          <VisualDripStepsBuilder
            label={field.label}
            value={String(value ?? '')}
            onChange={(v) => onChange(v)}
            helperText={field.help}
          />
        );
      }
      return (
        <TextField
          {...common}
          multiline
          minRows={3}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'datetime': {
      /**
       * Formats an ISO timestamp (or any Date-parseable value) as the local
       * `YYYY-MM-DDTHH:mm` string a datetime-local input expects.
       * @param {unknown} iso - Stored value.
       * @returns {string} Local input value ('' when absent/invalid).
       */
      const toLocalInput = (iso: unknown): string => {
        if (typeof iso !== 'string' || iso === '') return '';
        const parsed = new Date(iso);
        if (Number.isNaN(parsed.getTime())) return '';
        const pad = (part: number): string => String(part).padStart(2, '0');
        return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
      };
      const setOffset = (minutes: number) => {
        onChange(new Date(Date.now() + minutes * 60000).toISOString());
      };
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      return (
        <Stack spacing={0.5}>
          <TextField
            {...common}
            type="datetime-local"
            value={toLocalInput(value)}
            helperText={t('common.datetimeTzHint', { tz: timezone })}
            onChange={(event) => {
              const input = event.target.value;
              if (!input) {
                onChange('');
                return;
              }
              // datetime-local values are interpreted in the operator's local
              // timezone; persist ISO-8601 UTC like the API expects.
              const parsed = new Date(input);
              onChange(Number.isNaN(parsed.getTime()) ? input : parsed.toISOString());
            }}
          />
          <Stack direction="row" spacing={0.5} sx={{ pt: 0.5 }}>
            <Chip size="small" label={t('common.now')} onClick={() => setOffset(0)} />
            <Chip size="small" label={t('common.plus1h')} onClick={() => setOffset(60)} />
            <Chip size="small" label={t('common.plus24h')} onClick={() => setOffset(1440)} />
            <Chip size="small" label={t('common.plus7d')} onClick={() => setOffset(10080)} />
          </Stack>
        </Stack>
      );
    }
    case 'select':
      return (
        <TextField
          {...common}
          select
          value={String(value ?? field.options?.[0] ?? '')}
          onChange={(event) => onChange(event.target.value)}
        >
          {(field.options ?? []).map((option) => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </TextField>
      );
    case 'mediaUpload':
      return (
        <MediaUploadField
          label={field.label}
          value={value}
          form={form}
          onFormChange={onFormChange}
          onChange={onChange}
          help={field.help}
        />
      );
    default:
      return (
        <TextField
          {...common}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

/**
 * Dedicated media upload / URL field with instant image/video preview,
 * file-picker upload, clear action, and optional URL manual input.
 */
function MediaUploadField({
  label,
  value,
  form,
  onFormChange,
  onChange,
  help,
}: {
  label: string;
  value: unknown;
  form?: Record<string, unknown> | null;
  onFormChange?: (updates: Record<string, unknown>) => void;
  onChange: (value: unknown) => void;
  help?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const currentUrl =
    typeof form?.mediaUrl === 'string'
      ? form.mediaUrl.trim()
      : typeof value === 'string'
        ? value.trim()
        : '';
  const currentData = typeof form?.mediaData === 'string' ? form.mediaData.trim() : '';
  const displaySrc = currentData || currentUrl;
  const [urlMode, setUrlMode] = React.useState(
    Boolean(currentUrl && !currentData && !currentUrl.startsWith('/api/')),
  );

  const fileName =
    (form?.mediaFileName as string) ||
    (currentUrl ? currentUrl.split('/').pop()?.split('?')[0] : '');
  const mime = ((form?.mediaMime as string) || '').toLowerCase();
  const isVideo =
    mime.startsWith('video/') || /\.(mp4|mov|webm)(\?|$)/i.test(fileName || displaySrc);

  const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      onFormChange?.({
        mediaData: result,
        mediaMime: file.type || 'image/jpeg',
        mediaFileName: file.name,
        mediaUrl: '',
      });
      onChange(result);
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const handleClear = () => {
    onFormChange?.({
      mediaData: null,
      mediaMime: null,
      mediaFileName: null,
      mediaUrl: '',
    });
    onChange('');
  };

  return (
    <Box
      sx={{
        p: 1.5,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1.5,
        bgcolor: 'background.default',
      }}
    >
      <Stack spacing={1.5}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {label}
          </Typography>
          {displaySrc && (
            <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={handleClear}>
              {t('actions.delete', 'Kaldır')}
            </Button>
          )}
        </Stack>

        {help && (
          <Typography variant="caption" color="text.secondary">
            {help}
          </Typography>
        )}

        {displaySrc ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Box
              sx={{
                maxHeight: 180,
                borderRadius: 1,
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'action.hover',
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              {isVideo ? (
                <Box
                  component="video"
                  src={displaySrc}
                  controls
                  sx={{ maxHeight: 180, maxWidth: '100%' }}
                />
              ) : (
                <Box
                  component="img"
                  src={displaySrc}
                  alt="Preview"
                  sx={{ maxHeight: 180, maxWidth: '100%', objectFit: 'contain' }}
                />
              )}
            </Box>
            {fileName && (
              <Typography variant="caption" color="text.secondary" noWrap>
                {fileName}
              </Typography>
            )}
          </Box>
        ) : null}

        <input
          type="file"
          ref={fileInputRef}
          accept="image/*,video/mp4,video/webm"
          style={{ display: 'none' }}
          onChange={handleFileSelected}
        />

        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<CloudUploadIcon />}
            onClick={() => fileInputRef.current?.click()}
          >
            {displaySrc
              ? t('actions.edit', 'Görseli Değiştir')
              : t('actions.upload', 'Görsel / Medya Yükle')}
          </Button>

          <Button
            size="small"
            variant="text"
            startIcon={<LinkIcon />}
            onClick={() => setUrlMode(!urlMode)}
          >
            {urlMode
              ? t('actions.close', 'URL Alanını Kapat')
              : t('common.orEnterUrl', 'Veya URL Gir')}
          </Button>
        </Stack>

        {urlMode && (
          <TextField
            label={t('mediaLibrary.url', 'Görsel veya Medya URL')}
            size="small"
            fullWidth
            value={String(form?.mediaUrl ?? '')}
            onChange={(e) => {
              const url = e.target.value;
              onFormChange?.({
                mediaUrl: url,
                mediaData: null,
                mediaMime: null,
                mediaFileName: null,
              });
              onChange(url);
            }}
            placeholder="https://example.com/image.jpg"
          />
        )}
      </Stack>
    </Box>
  );
}
