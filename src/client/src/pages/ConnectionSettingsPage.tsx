import React, { useMemo, useState } from 'react';
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
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import PageHeader from '../components/PageHeader';
import { LoadingState } from '../components/Feedback';
import { ChatModuleConfigsSection } from '../components/ChatModuleConfigsSection';
import { useConnections } from '../context/ConnectionsContext';
import { useLocalizedModules } from '../registry/localize';
import { apiFetch } from '../services/api';
import { localizedErrorMessage } from '../utils/errors';

/**
 * Maps a connection type onto its chip color.
 */
function chipColor(type: string): 'primary' | 'success' | 'secondary' {
  if (type === 'channel') return 'primary';
  if (type === 'supergroup') return 'secondary';
  return 'success';
}

/**
 * Localized display label for a connection type.
 */
function typeLabel(type: string, t: TFunction): string {
  if (type === 'channel') return t('connections.typeChannel');
  if (type === 'supergroup') return t('connections.typeSupergroup');
  return t('connections.typeGroup');
}

/**
 * Per-connection (per-group / per-channel) module settings editor: every
 * chat-scoped module renders as a card with the shared per-chat
 * configuration editor pinned to this connection's chat. Each entry is the
 * chat's complete module configuration — adding it activates the module
 * there, removing it deactivates the module for that chat.
 */
export default function ConnectionSettingsPage(): React.ReactElement {
  const { botId, connectionId } = useParams<{ botId: string; connectionId: string }>();
  const activeBotIdStr = botId ?? '';
  const connectionIdStr = connectionId ?? '';
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { connections, loading: connectionsLoading, refresh } = useConnections();
  const modules = useLocalizedModules();

  const [editOpen, setEditDialogOpen] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{
    title: string;
    type: string;
    chatId: string;
    username: string;
    isActive: boolean;
  } | null>(null);

  const connection = useMemo(
    () => connections.find((row) => row.id === connectionIdStr),
    [connections, connectionIdStr],
  );

  /** Modules configured per chat (groups and channels). */
  const chatConfigured = useMemo(() => modules.filter((entry) => entry.chatScoped), [modules]);

  if (connectionsLoading) {
    return <LoadingState label={t('connectionSettings.loading')} />;
  }

  if (!connection) {
    return <Alert severity="error">{t('connectionSettings.connectionNotFound')}</Alert>;
  }

  const activeChatId = connection.chat_id ?? connection.chatId ?? '';

  // Telegram update events address chats by numeric id only; username-based
  // connections cannot carry per-chat settings.
  const numericChatId = /^-?\d+$/.test(activeChatId);

  function openEdit(): void {
    if (!connection) return;
    setForm({
      title: connection.title ?? '',
      type: connection.type ?? 'group',
      chatId: connection.chat_id ?? connection.chatId ?? '',
      username: connection.username ?? '',
      isActive: Boolean(connection.is_active ?? connection.isActive),
    });
    setEditError(null);
    setEditDialogOpen(true);
  }

  async function saveEdit(): Promise<void> {
    if (!connection || !form) return;
    setSaving(true);
    setEditError(null);
    try {
      await apiFetch(`/api/bots/${activeBotIdStr}/connections/${connection.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: form.title,
          type: form.type,
          chatId: form.chatId,
          username: form.username.trim() || null,
          isActive: form.isActive,
        }),
      });
      await refresh(activeBotIdStr);
      setEditDialogOpen(false);
      setStatus(t('common.saved'));
    } catch (err: unknown) {
      setEditError(localizedErrorMessage(err as Error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box>
      <PageHeader
        title={t('connectionSettings.title', { title: connection.title })}
        subtitle={t('connectionSettings.subtitle', { chatId: activeChatId })}
        onBack={() => navigate(`/bots/${activeBotIdStr}/m/connections`)}
        actions={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Tooltip title={t('actions.edit')}>
              <Chip
                size="small"
                color={chipColor(connection.type)}
                label={typeLabel(connection.type, t)}
                onClick={openEdit}
                sx={{ cursor: 'pointer' }}
              />
            </Tooltip>
            <Button variant="outlined" size="small" startIcon={<EditIcon />} onClick={openEdit}>
              {t('actions.edit')}
            </Button>
          </Stack>
        }
      />

      {status && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setStatus(null)}>
          {status}
        </Alert>
      )}

      {!numericChatId && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('connectionSettings.numericOnly')}
        </Alert>
      )}

      {numericChatId && (
        <Stack spacing={2}>
          {chatConfigured.map((entry) => (
            <Card key={entry.key} variant="outlined">
              <CardContent>
                <Typography
                  variant="subtitle1"
                  sx={{
                    fontWeight: 700,
                    mb: 1.5,
                  }}
                >
                  {entry.name}
                </Typography>
                <ChatModuleConfigsSection
                  botId={activeBotIdStr}
                  module={entry}
                  fixedChatId={activeChatId}
                />
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <Dialog
        open={editOpen}
        onClose={() => setEditDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        aria-labelledby="connection-settings-edit-title"
      >
        <DialogTitle id="connection-settings-edit-title">
          {t('actions.edit')} — {connection.title}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {editError && (
              <Alert severity="error" onClose={() => setEditError(null)}>
                {editError}
              </Alert>
            )}
            <TextField
              label={t('common.title')}
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
              label={t('connections.type')}
              size="small"
              fullWidth
              value={form?.type ?? 'group'}
              onChange={(event) =>
                setForm((current) => (current ? { ...current, type: event.target.value } : current))
              }
              helperText={t('connections.typeHelp')}
            >
              <MenuItem value="channel">{t('connections.typeChannel')}</MenuItem>
              <MenuItem value="group">{t('connections.typeGroup')}</MenuItem>
              <MenuItem value="supergroup">{t('connections.typeSupergroup')}</MenuItem>
            </TextField>
            <TextField
              label={t('connections.chatId')}
              size="small"
              fullWidth
              required
              placeholder={t('connections.chatIdPlaceholder')}
              value={form?.chatId ?? ''}
              onChange={(event) =>
                setForm((current) =>
                  current ? { ...current, chatId: event.target.value } : current,
                )
              }
              helperText={t('connections.chatIdHelp')}
            />
            <TextField
              label={t('connections.usernameOptional')}
              size="small"
              fullWidth
              placeholder={t('connections.usernamePlaceholder')}
              value={form?.username ?? ''}
              onChange={(event) =>
                setForm((current) =>
                  current ? { ...current, username: event.target.value } : current,
                )
              }
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form?.isActive ?? false}
                  onChange={(event) =>
                    setForm((current) =>
                      current ? { ...current, isActive: event.target.checked } : current,
                    )
                  }
                />
              }
              label={t('status.active')}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>{t('actions.cancel')}</Button>
          <Button variant="contained" onClick={saveEdit} disabled={saving || !form?.chatId?.trim()}>
            {t('actions.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
