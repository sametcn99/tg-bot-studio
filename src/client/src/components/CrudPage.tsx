import React, { useCallback, useEffect, useState } from 'react';
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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
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
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import PageHeader from './PageHeader';
import ModuleHelpDialog from './ModuleHelpDialog';
import ConfirmDialog from './ConfirmDialog';
import { ConnectionSelect, ConnectionMultiSelect } from './ConnectionSelect';
import VisualButtonBuilder from './VisualButtonBuilder';
import VisualDripStepsBuilder from './VisualDripStepsBuilder';
import { LoadingState } from './Feedback';
import type { CrudField, ModuleEntry } from '../registry/modules';

/**
 * Generic bot-scoped CRUD page driven by a registry resource descriptor:
 * a data table, a create/edit dialog, delete confirmation, an optional
 * module configuration card, and the standard docs dialog.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {ModuleEntry} props.module - Module catalog entry with `crud`.
 * @returns {React.ReactElement} The CRUD page.
 */
export default function CrudPage({
  botId,
  module,
}: {
  botId: number;
  module: ModuleEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  const resource = module.crud!;
  const endpoint = resource.endpoint.replace('{botId}', String(botId));

  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const theme = useTheme();
  const compactDialogs = useMediaQuery(theme.breakpoints.down('sm'));

  const reload = useCallback(() => {
    apiFetch<Record<string, unknown>[]>(`/api${endpoint}`)
      .then(setRows)
      .catch((err: Error) => setError(err.message));
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
    setEditingId(Number(row.id));
    const seeded: Record<string, unknown> = { ...resource.initialForm };
    for (const field of resource.formFields) {
      const serverKey = serverKeyFor(field.key);
      if (row[serverKey] !== undefined) {
        if (field.type === 'json') {
          seeded[field.key] = JSON.stringify(row[serverKey], null, 2);
        } else if (field.type === 'chatMultiSelect') {
          const raw = row[serverKey];
          const list =
            typeof raw === 'string' ? (JSON.parse(raw) as unknown[]) : Array.isArray(raw) ? raw : [];
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
      messageText: 'message_text',
      targetChatId: 'target_chat_id',
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
    if (!form) return;
    const payload: Record<string, unknown> = { ...form };
    for (const field of resource.formFields) {
      if (field.type === 'json' && typeof payload[field.key] === 'string') {
        const text = String(payload[field.key]).trim();
        payload[field.key] = text ? JSON.parse(text) : undefined;
      }
      if (field.type === 'chatSelect' && typeof payload[field.key] === 'string') {
        const text = String(payload[field.key]).trim();
        payload[field.key] = /^-?\d+$/.test(text) ? Number(text) : text || undefined;
      }
    }
    const url = editingId ? `/api${endpoint}/${editingId}` : `/api${endpoint}`;
    const method = editingId ? 'PATCH' : 'POST';
    apiFetch(url, { method, body: JSON.stringify(payload) })
      .then(() => {
        setForm(null);
        reload();
      })
      .catch((err: Error) => setError(err.message));
  }

  /**
   * Confirms deletion of a row.
   * @returns {void}
   */
  function confirmDelete(): void {
    if (!deleting) return;
    apiFetch(`/api${endpoint}/${deleting.id}`, { method: 'DELETE' })
      .then(() => {
        setDeleting(null);
        reload();
      })
      .catch((err: Error) => setError(err.message));
  }

  /**
   * Persists the module configuration card.
   * @returns {void}
   */
  function saveConfig(): void {
    apiFetch(`/api/bots/${botId}/modules/${module.key}`, {
      method: 'PUT',
      body: JSON.stringify({ isEnabled: enabled, config }),
    })
      .then(() => setError(null))
      .catch((err: Error) => setError(err.message));
  }

  return (
    <Box>
      <PageHeader
        title={module.name}
        subtitle={module.description}
        onDocs={() => setDocsOpen(true)}
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

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {module.configFields && module.configFields.length > 0 && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Typography variant="subtitle2">Module settings</Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="caption" color="text.secondary" id={`${module.key}-switch-label`}>
                  {enabled ? t('status.enabled') : t('status.disabled')}
                </Typography>
                <Switch
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                  inputProps={{ 'aria-label': `${module.name} ${t('status.enabled')}` }}
                />
                <Button size="small" onClick={saveConfig}>
                  {t('actions.save')}
                </Button>
              </Stack>
            </Stack>
            <Stack spacing={2}>
              {module.configFields.map((field) => (
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
                  onChange={(event) =>
                    setConfig((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                  helperText={field.help}
                >
                  {field.type === 'select' &&
                    (field.options ?? []).map((option) => (
                      <MenuItem key={option} value={option}>
                        {option}
                      </MenuItem>
                    ))}
                </TextField>
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}

      <Card>
        {loading ? (
          <LoadingState label={t('common.loading')} />
        ) : (
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label={`${module.name} records`}>
              <TableHead>
                <TableRow>
                  {resource.columns.map((column) => (
                    <TableCell key={column.key}>{column.label}</TableCell>
                  ))}
                  <TableCell align="right">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={String(row.id)}>
                    {resource.columns.map((column) => (
                      <TableCell key={column.key}>
                        <CellValue value={row[column.key]} type={column.type} />
                      </TableCell>
                    ))}
                    <TableCell align="right">
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
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={resource.columns.length + 1}>
                      <Typography color="text.secondary" align="center" sx={{ py: 3 }}>
                        {t('common.empty')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      <Dialog
        open={Boolean(form)}
        onClose={() => setForm(null)}
        maxWidth="sm"
        fullWidth
        fullScreen={compactDialogs}
        aria-labelledby="crud-form-dialog-title"
      >
        <DialogTitle id="crud-form-dialog-title">
          {editingId ? t('actions.edit') : t('actions.create')} - {module.name}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {resource.formFields.map((field) => (
              <CrudFormField
                key={field.key}
                field={field}
                value={form?.[field.key]}
                onChange={(value) => setForm((current) => ({ ...(current ?? {}), [field.key]: value }))}
              />
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForm(null)}>{t('actions.cancel')}</Button>
          <Button variant="contained" onClick={submit}>
            {t('actions.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={t('actions.delete')}
        message="This record will be permanently removed."
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
      <ModuleHelpDialog module={docsOpen ? module : null} onClose={() => setDocsOpen(false)} />
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
  type?: 'bool' | 'text' | 'number';
}): React.ReactElement {
  if (type === 'bool') {
    return (
      <Typography variant="body2" color={value ? 'success.main' : 'text.secondary'}>
        {value ? 'Active' : 'Off'}
      </Typography>
    );
  }
  const text =
    typeof value === 'string' && value.length > 60 ? `${value.slice(0, 60)}...` : String(value ?? '');
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
  field,
  value,
  onChange,
}: {
  field: CrudField;
  value: unknown;
  onChange: (value: unknown) => void;
}): React.ReactElement {
  const common = { label: field.label, fullWidth: true, size: 'small' as const, helperText: field.help };
  switch (field.type) {
    case 'chatSelect':
      return (
        <ConnectionSelect
          label={field.label}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(next) => onChange(next)}
          types={field.connectionTypes}
          helperText={field.help}
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
      const setOffset = (minutes: number) => {
        onChange(new Date(Date.now() + minutes * 60000).toISOString());
      };
      return (
        <Stack spacing={0.5}>
          <TextField
            {...common}
            placeholder="2026-01-01T12:00:00.000Z"
            value={String(value ?? '')}
            onChange={(event) => onChange(event.target.value)}
          />
          <Stack direction="row" spacing={0.5} sx={{ pt: 0.5 }}>
            <Chip size="small" label="Now" onClick={() => setOffset(0)} />
            <Chip size="small" label="+1 Hour" onClick={() => setOffset(60)} />
            <Chip size="small" label="+24 Hours" onClick={() => setOffset(1440)} />
            <Chip size="small" label="+7 Days" onClick={() => setOffset(10080)} />
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
