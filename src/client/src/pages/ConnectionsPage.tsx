import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
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
  Chip,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SyncIcon from '@mui/icons-material/Sync';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import PageHeader from '../components/PageHeader';
import ModuleHelpDialog from '../components/ModuleHelpDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import { LoadingState } from '../components/Feedback';
import { useConnections } from '../context/ConnectionsContext';
import type { ChatConnection } from '../context/ConnectionsContext';
import type { ModuleEntry } from '../registry/modules';

/** Blank dialog form for a new connection. */
const BLANK_FORM = { title: '', type: 'channel', chatId: '', username: '' };

/**
 * Maps a connection type onto its chip color.
 * @param {string} type - Connection type.
 * @returns {'primary'|'success'|'secondary'} Chip color.
 */
function chipColor(type: string): 'primary' | 'success' | 'secondary' {
  if (type === 'channel') return 'primary';
  if (type === 'supergroup') return 'secondary';
  return 'success';
}

/**
 * Chat Connections page: the shared group/channel address book. Connections
 * added here power every target-chat dropdown across the studio; the Sync
 * action imports chats the bot runtime already discovered.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {ModuleEntry} props.module - Connections catalog entry.
 * @returns {React.ReactElement} The page.
 */
export default function ConnectionsPage({
  botId,
  module,
}: {
  botId: number;
  module: ModuleEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  const { connections, loading, refresh } = useConnections();
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<ChatConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [autoSync, setAutoSync] = useState(true);
  const [moduleEnabled, setModuleEnabled] = useState(false);
  const [moduleConfig, setModuleConfig] = useState<Record<string, unknown>>({});
  const theme = useTheme();
  const compactDialogs = useMediaQuery(theme.breakpoints.down('sm'));

  useEffect(() => {
    apiFetch<Array<{ key: string; isEnabled: boolean; config: Record<string, unknown> }>>(
      `/api/bots/${botId}/modules`,
    )
      .then((modules) => {
        const found = modules.find((entry) => entry.key === 'connections');
        setModuleEnabled(found?.isEnabled ?? false);
        setModuleConfig(found?.config ?? {});
        if (found && found.config.autoSync !== undefined) {
          setAutoSync(Boolean(found.config.autoSync));
        }
      })
      .catch(() => undefined);
  }, [botId]);

  /**
   * Persists the auto-sync preference in the connections module config.
   * @param {boolean} next - Next auto-sync state.
   * @returns {void}
   */
  function toggleAutoSync(next: boolean): void {
    setAutoSync(next);
    apiFetch(`/api/bots/${botId}/modules/connections`, {
      method: 'PUT',
      body: JSON.stringify({
        isEnabled: moduleEnabled,
        config: { ...moduleConfig, autoSync: next },
      }),
    }).catch((err: Error) => setError(err.message));
  }

  /**
   * Opens the create dialog.
   * @returns {void}
   */
  function openCreate(): void {
    setEditingId(null);
    setForm({ ...BLANK_FORM });
  }

  /**
   * Opens the edit dialog seeded from a row.
   * @param {ChatConnection} row - Row being edited.
   * @returns {void}
   */
  function openEdit(row: ChatConnection): void {
    setEditingId(row.id);
    setForm({
      title: row.title,
      type: row.type,
      chatId: row.chat_id,
      username: row.username ?? '',
    });
  }

  /**
   * Submits the create/edit dialog.
   * @returns {void}
   */
  function submit(): void {
    if (!form) return;
    setError(null);
    const payload = {
      title: form.title,
      type: form.type,
      chatId: form.chatId,
      username: form.username || undefined,
    };
    const url = editingId
      ? `/api/bots/${botId}/connections/${editingId}`
      : `/api/bots/${botId}/connections`;
    apiFetch(url, { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(payload) })
      .then(() => {
        setForm(null);
        refresh();
      })
      .catch((err: Error) => setError(err.message));
  }

  /**
   * Confirms deletion of a connection.
   * @returns {void}
   */
  function confirmDelete(): void {
    if (!deleting) return;
    apiFetch(`/api/bots/${botId}/connections/${deleting.id}`, { method: 'DELETE' })
      .then(() => {
        setDeleting(null);
        refresh();
      })
      .catch((err: Error) => setError(err.message));
  }

  /**
   * Imports chats the bot runtime auto-discovered.
   * @returns {void}
   */
  function sync(): void {
    setError(null);
    setStatus(null);
    apiFetch<{ synced: number }>(`/api/bots/${botId}/connections/sync`, { method: 'POST' })
      .then((result) => {
        setStatus(
          result.synced > 0
            ? `Synced ${result.synced} chat${result.synced === 1 ? '' : 's'} discovered by the bot.`
            : 'The bot has not discovered any chats yet. Add it to a group or channel first.',
        );
        refresh();
      })
      .catch((err: Error) => setError(err.message));
  }

  /**
   * Toggles a connection's active flag in place.
   * @param {ChatConnection} row - Row being toggled.
   * @returns {void}
   */
  function toggleActive(row: ChatConnection): void {
    apiFetch(`/api/bots/${botId}/connections/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !row.is_active }),
    })
      .then(refresh)
      .catch((err: Error) => setError(err.message));
  }

  return (
    <Box>
      <PageHeader
        title={module.name}
        subtitle={module.description}
        onDocs={() => setDocsOpen(true)}
        actions={
          <Stack direction="row" spacing={1} alignItems="center">
            <Tooltip title="Automatically import every group and channel the bot is added to">
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <Typography variant="body2" color="text.secondary">
                  Auto-sync
                </Typography>
                <Switch
                  size="small"
                  checked={autoSync}
                  onChange={(event) => toggleAutoSync(event.target.checked)}
                  inputProps={{ 'aria-label': 'Auto-sync discovered chats' }}
                />
              </Stack>
            </Tooltip>
            <Button startIcon={<SyncIcon />} onClick={sync}>
              {t('connections.sync')}
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
              {t('actions.add')}
            </Button>
          </Stack>
        }
      />

      {status && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setStatus(null)}>
          {status}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card>
        {loading ? (
          <LoadingState label={t('common.loading')} />
        ) : (
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label={`${module.name} records`}>
              <TableHead>
                <TableRow>
                  <TableCell>Title</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Chat id</TableCell>
                  <TableCell>Username</TableCell>
                  <TableCell>{t('status.active')}</TableCell>
                  <TableCell align="right">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {connections.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600} noWrap sx={{ maxWidth: 260 }}>
                        {row.title}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" color={chipColor(row.type)} label={row.type} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontFamily="monospace" noWrap>
                        {row.chat_id}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap>
                        {row.username ? `@${row.username}` : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Switch
                        size="small"
                        checked={Boolean(row.is_active)}
                        onChange={() => toggleActive(row)}
                        inputProps={{ 'aria-label': `${row.title} ${t('status.active')}` }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title={t('actions.edit')}>
                        <IconButton
                          size="small"
                          onClick={() => openEdit(row)}
                          aria-label={`${t('actions.edit')} ${row.title}`}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('actions.delete')}>
                        <IconButton
                          size="small"
                          onClick={() => setDeleting(row)}
                          aria-label={`${t('actions.delete')} ${row.title}`}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {connections.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Stack spacing={1} alignItems="center" sx={{ py: 3 }}>
                        <Typography color="text.secondary" align="center">
                          {t('connections.empty')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" align="center">
                          {t('connections.emptyHint')}
                        </Typography>
                      </Stack>
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
        aria-labelledby="connections-form-dialog-title"
      >
        <DialogTitle id="connections-form-dialog-title">
          {editingId ? t('actions.edit') : t('actions.create')} - {module.name}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Title"
              size="small"
              fullWidth
              value={form?.title ?? ''}
              onChange={(event) =>
                setForm((current) =>
                  current ? { ...current, title: event.target.value } : current,
                )
              }
            />
            <TextField
              select
              label="Type"
              size="small"
              fullWidth
              value={form?.type ?? 'channel'}
              onChange={(event) =>
                setForm((current) => (current ? { ...current, type: event.target.value } : current))
              }
              helperText="Forum-enabled supergroups power the Support Desk"
            >
              <MenuItem value="channel">Channel</MenuItem>
              <MenuItem value="group">Group</MenuItem>
              <MenuItem value="supergroup">Supergroup</MenuItem>
            </TextField>
            <TextField
              label="Chat id"
              size="small"
              fullWidth
              required
              placeholder="-1001234567890 or @username"
              value={form?.chatId ?? ''}
              onChange={(event) =>
                setForm((current) =>
                  current ? { ...current, chatId: event.target.value } : current,
                )
              }
              helperText={t('connections.chatIdHelp')}
            />
            <TextField
              label="Username (optional)"
              size="small"
              fullWidth
              placeholder="mychannel"
              value={form?.username ?? ''}
              onChange={(event) =>
                setForm((current) =>
                  current ? { ...current, username: event.target.value } : current,
                )
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForm(null)}>{t('actions.cancel')}</Button>
          <Button variant="contained" onClick={submit} disabled={!form?.chatId.trim()}>
            {t('actions.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={t('actions.delete')}
        message={t('connections.deleteConfirm', { title: deleting?.title ?? '' })}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
      <ModuleHelpDialog module={docsOpen ? module : null} onClose={() => setDocsOpen(false)} />
    </Box>
  );
}
