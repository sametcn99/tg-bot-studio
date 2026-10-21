import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  IconButton,
  ListItem,
  ListItemText,
  ListItemIcon,
  MenuItem,
  ListItemButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/AddCircleOutlineOutlined';
import CheckIcon from '@mui/icons-material/CheckCircle';
import DeleteIcon from '@mui/icons-material/Delete';
import GroupIcon from '@mui/icons-material/Group';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import { useConnections, type ChatConnection } from '../context/ConnectionsContext';
import { useSnackbar } from '../context/SnackbarContext';
import { ConfigFieldInput } from './ConfigFieldInput';
import ConfirmDialog from './ConfirmDialog';
import { localizedErrorMessage } from '../utils/errors';
import type { ModuleEntry } from '../registry/modules';

/** Per-chat configuration entry returned by the module's chat-config list endpoint. */
interface ChatConfigRow {
  chatId: string;
  override: Record<string, unknown>;
}

/** Snapshot returned by the per-chat read endpoint. */
interface ChatSettingsSnapshot {
  moduleKey: string;
  chatId: string;
  override: Record<string, unknown>;
  effective: Record<string, unknown>;
  overridden: boolean;
}

/** Display title for a chat id, falling back to the raw id. */
function chatLabelFor(connections: ChatConnection[], chatId: string): string {
  const conn = connections.find((row) => (row.chat_id ?? row.chatId) === chatId);
  return conn ? conn.title : chatId;
}

/** Structural value equality for dirty-state tracking. */
function sameConfig(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Per-chat configuration editor for one chat-scoped module — the module's
 * ONLY configuration surface, laid out as a master-detail panel: the left
 * column lists configured chats (plus the add-chat picker), the right
 * column edits the selected chat. Switch fields render as a compact
 * settings list, editor widgets below, and a sticky-feeling action bar
 * tracks unsaved changes with explicit save/discard. Adding a chat
 * activates the module there; removing the entry deactivates it. The
 * connection settings page embeds the editor alone in `fixedChatId` mode.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {ModuleEntry} props.module - Localized module catalog entry.
 * @param {string} [props.fixedChatId] - Pins the editor to one chat and
 * hides the master panel (connection settings page).
 * @returns {React.ReactElement} The section.
 */
export function ChatModuleConfigsSection({
  botId,
  module,
  fixedChatId,
}: {
  botId: string;
  module: ModuleEntry;
  fixedChatId?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { connections, loading: connectionsLoading, refresh } = useConnections();
  const [entries, setEntries] = useState<Record<string, Record<string, unknown>>>({});
  const [selectedChatId, setSelectedChatId] = useState<string>(fixedChatId ?? '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingChatId, setRemovingChatId] = useState<string | null>(null);

  useEffect(() => {
    refresh(botId);
  }, [botId, refresh]);

  const reloadEntries = useCallback((): void => {
    const request = fixedChatId
      ? apiFetch<ChatSettingsSnapshot>(
          `/api/bots/${botId}/chat-settings/${fixedChatId}/${module.key}`,
        ).then((snapshot) => ({
          [fixedChatId]: snapshot.override ?? {},
        }))
      : apiFetch<ChatConfigRow[]>(`/api/bots/${botId}/modules/${module.key}/chat-overrides`).then(
          (rows) => {
            const map: Record<string, Record<string, unknown>> = {};
            for (const row of rows) map[row.chatId] = row.override ?? {};
            return map;
          },
        );
    request
      .then((map) => setEntries(map))
      .catch((err: Error) => setError(localizedErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [botId, module.key, fixedChatId]);

  useEffect(() => {
    setLoading(true);
    reloadEntries();
  }, [reloadEntries]);

  // Keep a valid selection when entries change (e.g. after a removal).
  useEffect(() => {
    if (fixedChatId) return;
    const ids = Object.keys(entries);
    if (ids.length === 0) {
      if (selectedChatId !== '') setSelectedChatId('');
    } else if (!ids.includes(selectedChatId)) {
      setSelectedChatId(ids[0] ?? '');
    }
  }, [entries, selectedChatId, fixedChatId]);

  // Only numeric chat ids can receive per-chat configs: Telegram update
  // events address chats by numeric id, never by @username.
  const configurableChats = useMemo(
    () =>
      connections.filter(
        (row) =>
          /^-?\d+$/.test(row.chat_id ?? row.chatId ?? '') &&
          (row.type === 'group' || row.type === 'supergroup' || row.type === 'channel'),
      ),
    [connections],
  );

  const groups = useMemo(
    () => configurableChats.filter((row) => row.type === 'group' || row.type === 'supergroup'),
    [configurableChats],
  );
  const channels = useMemo(
    () => configurableChats.filter((row) => row.type === 'channel'),
    [configurableChats],
  );

  /** Chats without an entry yet — the "add target" pool. */
  const addable = useMemo(
    () => configurableChats.filter((row) => !((row.chat_id ?? row.chatId ?? '') in entries)),
    [configurableChats, entries],
  );

  /**
   * Deletes one chat's entry after confirmation, deactivating the module
   * there, and refreshes the local map.
   */
  function confirmRemove(): void {
    const chatId = removingChatId;
    setRemovingChatId(null);
    if (!chatId) return;
    apiFetch(`/api/bots/${botId}/chat-settings/${chatId}/${module.key}`, {
      method: 'DELETE',
    }).catch(() => undefined);
    setEntries((prev) => {
      const next = { ...prev };
      delete next[chatId];
      return next;
    });
    if (selectedChatId === chatId) setSelectedChatId('');
  }

  /**
   * Merges a saved entry back into the local map; deleting clears it.
   */
  function applyEntry(chatId: string, config: Record<string, unknown> | null): void {
    setEntries((prev) => {
      const next = { ...prev };
      if (!config) {
        delete next[chatId];
      } else {
        next[chatId] = config;
      }
      return next;
    });
  }

  if (loading || connectionsLoading) {
    return (
      <Card variant="outlined" sx={{ mt: 2 }}>
        <CardContent>
          <Typography
            variant="body2"
            sx={{
              color: 'text.secondary',
            }}
          >
            {t('common.loading')}
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const activeChatId = fixedChatId ?? selectedChatId;

  if (fixedChatId) {
    return (
      <Stack spacing={2} sx={{ mt: 2 }}>
        {error && (
          <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'error.lighter' }}>
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          </Paper>
        )}
        <ChatConfigEditor
          botId={botId}
          module={module}
          chatId={fixedChatId}
          chatLabel={chatLabelFor(connections, fixedChatId)}
          existing={entries[fixedChatId]}
          onApply={applyEntry}
          onRemoveRequest={setRemovingChatId}
        />
        <ConfirmDialog
          open={removingChatId === fixedChatId}
          title={t('chatConfigs.removeConfirmTitle')}
          message={t('chatConfigs.removeConfirmMessage')}
          onConfirm={confirmRemove}
          onCancel={() => setRemovingChatId(null)}
        />
      </Stack>
    );
  }

  return (
    <Card variant="outlined" sx={{ mt: 2 }}>
      <CardContent>
        <Stack spacing={2}>
          <Box>
            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 700,
              }}
            >
              {t('chatConfigs.title')}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: 'text.secondary',
              }}
            >
              {t('chatConfigs.hint')}
            </Typography>
          </Box>

          {error && (
            <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'error.lighter' }}>
              <Typography variant="body2" color="error">
                {error}
              </Typography>
            </Paper>
          )}

          <Grid container spacing={2}>
            {/* Master panel: add-chat picker + configured chat list. */}
            <Grid size={{ xs: 12, md: 4, lg: 3 }}>
              <Stack spacing={1.5}>
                <TextField
                  select
                  label={t('chatConfigs.addChat')}
                  size="small"
                  fullWidth
                  value=""
                  onChange={(event) => {
                    const chatId = event.target.value;
                    if (chatId) setSelectedChatId(chatId);
                  }}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <AddIcon sx={{ mr: 0.75, fontSize: 20, color: 'action.active' }} />
                      ),
                    },
                  }}
                  helperText={
                    addable.length === 0 && configurableChats.length > 0
                      ? t('chatConfigs.allAdded')
                      : undefined
                  }
                >
                  <MenuItem disabled value="">
                    {t('chatConfigs.addChat')}
                  </MenuItem>
                  {groups
                    .filter((row) => !((row.chat_id ?? row.chatId ?? '') in entries))
                    .map((row) => {
                      const id = row.chat_id ?? row.chatId ?? '';
                      return (
                        <MenuItem key={id} value={id}>
                          {row.title} · {id}
                        </MenuItem>
                      );
                    })}
                  {channels
                    .filter((row) => !((row.chat_id ?? row.chatId ?? '') in entries))
                    .map((row) => {
                      const id = row.chat_id ?? row.chatId ?? '';
                      return (
                        <MenuItem key={id} value={id}>
                          {row.title} · {id}
                        </MenuItem>
                      );
                    })}
                </TextField>

                <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
                  {Object.keys(entries).length > 0 ? (
                    Object.entries(entries).map(([chatId], index) => (
                      <React.Fragment key={chatId}>
                        {index > 0 && <Divider />}
                        <ListItem
                          disablePadding
                          secondaryAction={
                            <Tooltip title={t('chatConfigs.remove')}>
                              <IconButton
                                size="small"
                                edge="end"
                                aria-label={`${t('chatConfigs.remove')} ${chatLabelFor(connections, chatId)}`}
                                onClick={() => setRemovingChatId(chatId)}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          }
                        >
                          <ListItemButton
                            selected={chatId === selectedChatId}
                            onClick={() => setSelectedChatId(chatId)}
                            sx={{ pr: 6 }}
                          >
                            <ListItemIcon sx={{ minWidth: 34 }}>
                              {chatId === selectedChatId ? (
                                <CheckIcon color="primary" fontSize="small" />
                              ) : (
                                <GroupIcon sx={{ color: 'action.active' }} fontSize="small" />
                              )}
                            </ListItemIcon>
                            <ListItemText
                              primary={chatLabelFor(connections, chatId)}
                              secondary={chatId}
                              slotProps={{
                                primary: { noWrap: true, sx: { fontWeight: 600 } },
                                secondary: { noWrap: true },
                              }}
                            />
                          </ListItemButton>
                        </ListItem>
                      </React.Fragment>
                    ))
                  ) : (
                    <Typography variant="body2" sx={{ color: 'text.secondary', px: 2, py: 1.75 }}>
                      {t('chatConfigs.noneYet')}
                    </Typography>
                  )}
                </Paper>
              </Stack>
            </Grid>

            {/* Detail panel: selected chat's settings. */}
            <Grid size={{ xs: 12, md: 8, lg: 9 }}>
              {activeChatId ? (
                <ChatConfigEditor
                  key={`${module.key}:${activeChatId}`}
                  botId={botId}
                  module={module}
                  chatId={activeChatId}
                  chatLabel={chatLabelFor(connections, activeChatId)}
                  existing={entries[activeChatId]}
                  onApply={applyEntry}
                  onRemoveRequest={setRemovingChatId}
                />
              ) : (
                <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t('chatConfigs.pickToEdit')}
                  </Typography>
                </Paper>
              )}
            </Grid>
          </Grid>
        </Stack>
      </CardContent>

      <ConfirmDialog
        open={Boolean(removingChatId)}
        title={t('chatConfigs.removeConfirmTitle')}
        message={t('chatConfigs.removeConfirmMessage')}
        onConfirm={confirmRemove}
        onCancel={() => setRemovingChatId(null)}
      />
    </Card>
  );
}

/**
 * Field editor for one chat: seeds the form from the chat's saved entry on
 * top of the registry defaults, groups switch fields into a compact
 * settings list, tracks unsaved changes with an explicit save/discard bar,
 * and stores the complete configuration as this chat's entry.
 */
function ChatConfigEditor({
  botId,
  module,
  chatId,
  chatLabel,
  existing,
  onApply,
  onRemoveRequest,
}: {
  botId: string;
  module: ModuleEntry;
  chatId: string;
  chatLabel: string;
  existing: Record<string, unknown> | undefined;
  onApply: (chatId: string, config: Record<string, unknown> | null) => void;
  onRemoveRequest: (chatId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  // An entry with zero stored fields is treated as "not yet configured" so
  // the form seeds from the effective defaults instead of opening empty.
  const isNew = !existing || Object.keys(existing).length === 0;
  const [baseline, setBaseline] = useState<Record<string, unknown>>(isNew ? {} : { ...existing });
  const [draft, setDraft] = useState<Record<string, unknown> | null>(
    isNew ? null : { ...existing },
  );
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isNew) return;
    // New entry: seed the form with the effective defaults for this chat.
    let cancelled = false;
    apiFetch<ChatSettingsSnapshot>(`/api/bots/${botId}/chat-settings/${chatId}/${module.key}`)
      .then((snapshot) => {
        if (!cancelled) {
          setDraft({ ...snapshot.effective });
          setBaseline({});
        }
      })
      .catch(() => {
        if (!cancelled) setDraft({});
      });
    return () => {
      cancelled = true;
    };
  }, [botId, chatId, module.key, isNew]);

  const fields = module.configFields ?? [];
  const switchFields = fields.filter((field) => field.type === 'switch');
  const contentFields = fields.filter((field) => field.type !== 'switch');

  const dirty = draft !== null && !sameConfig(draft, baseline);

  if (draft === null) {
    return (
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {t('common.loading')}
      </Typography>
    );
  }

  /**
   * Stores one value in the draft.
   */
  function setField(key: string, value: unknown): void {
    setDraft((prev) => {
      const next = prev ? { ...prev, [key]: value } : prev;
      return next;
    });
  }

  /**
   * Persists the draft as this chat's complete configuration entry —
   * creating it targets the module at this chat.
   */
  function save(): void {
    setError(null);
    const payload = { ...draft };
    delete payload.targetChats;
    apiFetch(`/api/bots/${botId}/chat-settings/${chatId}/${module.key}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
      .then(() => {
        onApply(chatId, { ...payload });
        setBaseline({ ...payload });
        setSavedFlash(true);
        window.setTimeout(() => setSavedFlash(false), 2_500);
        showSuccess(t('chatConfigs.saved'));
      })
      .catch((err: Error) => {
        const message = localizedErrorMessage(err);
        setError(message);
        showError(message);
      });
  }

  /**
   * Reverts the draft back to the last saved entry.
   */
  function discard(): void {
    setDraft({ ...baseline });
    setError(null);
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 } }}>
      <Stack spacing={2.5}>
        <Stack
          direction="row"
          spacing={1.5}
          sx={{
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 1,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" noWrap sx={{ fontWeight: 700 }}>
              {chatLabel}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
              {chatId}
            </Typography>
          </Box>
          <Chip
            size="small"
            color={savedFlash ? 'success' : dirty ? 'warning' : 'default'}
            variant={savedFlash || dirty ? 'filled' : 'outlined'}
            label={
              savedFlash
                ? t('chatConfigs.saved')
                : dirty
                  ? t('chatConfigs.unsavedChanges')
                  : t('chatConfigs.configured')
            }
          />
        </Stack>

        {error && (
          <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'error.lighter' }}>
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          </Paper>
        )}

        {switchFields.length > 0 && (
          <Paper variant="outlined" sx={{ px: 2, py: 0.5 }}>
            {switchFields.map((field, index) => (
              <React.Fragment key={field.key}>
                {index > 0 && <Divider />}
                <ConfigFieldInput
                  botId={botId}
                  field={field}
                  value={draft[field.key]}
                  onChange={(value) => setField(field.key, value)}
                />
              </React.Fragment>
            ))}
          </Paper>
        )}

        {contentFields.length > 0 && (
          <Stack spacing={2.5}>
            {contentFields.map((field) => (
              <ConfigFieldInput
                key={field.key}
                botId={botId}
                field={field}
                value={draft[field.key]}
                onChange={(value) => setField(field.key, value)}
              />
            ))}
          </Stack>
        )}

        {fields.length === 0 && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('chatConfigs.noFields')}
          </Typography>
        )}

        <Divider />

        <Stack
          direction="row"
          spacing={1}
          sx={{
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1,
          }}
        >
          <Button variant="contained" onClick={save} disabled={savedFlash}>
            {savedFlash ? t('chatConfigs.saved') : t('chatConfigs.save')}
          </Button>
          {dirty && (
            <Button variant="text" onClick={discard}>
              {t('actions.discard')}
            </Button>
          )}
          <Box sx={{ flexGrow: 1 }} />
          <Button
            variant="outlined"
            color="error"
            startIcon={<DeleteIcon />}
            onClick={() => onRemoveRequest(chatId)}
          >
            {t('chatConfigs.remove')}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
