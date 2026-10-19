import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import { useConnections, type ChatConnection } from '../context/ConnectionsContext';
import { useSnackbar } from '../context/SnackbarContext';
import { ConfigFieldInput } from './ConfigFieldInput';
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

/**
 * Per-chat configuration editor for one chat-scoped module — the module's
 * ONLY configuration surface. Every group and channel gets its own entry:
 * adding a chat activates the module there, each entry holds the full
 * field set for that chat (one channel can behave differently from
 * another), and removing the entry deactivates the module for that chat.
 * There is no bot-level default layer and no override/inheritance chain.
 * The connection settings page embeds the same section in `fixedChatId`
 * mode (one chat, no picker).
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {ModuleEntry} props.module - Localized module catalog entry.
 * @param {string} [props.fixedChatId] - Pins the editor to one chat and
 * hides the picker and chips row (connection settings page).
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
   * Merges a saved/removed entry back into the local map; deleting the
   * last field of an entry drops the chat from the targeted set.
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

  const body = (
    <Stack spacing={2}>
      {!fixedChatId && (
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
      )}

      {error && <Alert severity="error">{error}</Alert>}

      {!fixedChatId && (
        <>
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

          {Object.keys(entries).length > 0 ? (
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{
                flexWrap: 'wrap',
              }}
            >
              {Object.entries(entries).map(([chatId]) => (
                <Chip
                  key={chatId}
                  size="small"
                  color={chatId === selectedChatId ? 'primary' : 'default'}
                  variant={chatId === selectedChatId ? 'filled' : 'outlined'}
                  label={chatLabelFor(connections, chatId)}
                  onClick={() => setSelectedChatId(chatId)}
                  onDelete={() => {
                    apiFetch(`/api/bots/${botId}/chat-settings/${chatId}/${module.key}`, {
                      method: 'DELETE',
                    }).catch(() => undefined);
                    applyEntry(chatId, null);
                    if (selectedChatId === chatId) setSelectedChatId('');
                  }}
                />
              ))}
            </Stack>
          ) : (
            <Typography
              variant="body2"
              sx={{
                color: 'text.secondary',
              }}
            >
              {t('chatConfigs.noneYet')}
            </Typography>
          )}
        </>
      )}

      {activeChatId && (
        <ChatConfigEditor
          key={`${module.key}:${activeChatId}`}
          botId={botId}
          module={module}
          chatId={activeChatId}
          chatLabel={chatLabelFor(connections, activeChatId)}
          existing={entries[activeChatId]}
          onApply={applyEntry}
        />
      )}
    </Stack>
  );

  if (fixedChatId) {
    return body;
  }

  return (
    <Card variant="outlined" sx={{ mt: 2 }}>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

/**
 * Field editor for one chat: seeds the form from the chat's saved entry on
 * top of the registry defaults (the chat-settings snapshot's effective
 * values) and stores the complete configuration as this chat's entry.
 */
function ChatConfigEditor({
  botId,
  module,
  chatId,
  chatLabel,
  existing,
  onApply,
}: {
  botId: string;
  module: ModuleEntry;
  chatId: string;
  chatLabel: string;
  existing: Record<string, unknown> | undefined;
  onApply: (chatId: string, config: Record<string, unknown> | null) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  // An entry with zero stored fields is treated as "not yet configured" so
  // the form seeds from the effective defaults instead of opening empty.
  const isNew = !existing || Object.keys(existing).length === 0;
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
        if (!cancelled) setDraft({ ...snapshot.effective });
      })
      .catch(() => {
        if (!cancelled) setDraft({});
      });
    return () => {
      cancelled = true;
    };
  }, [botId, chatId, module.key, isNew]);

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
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
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
   * Removes the entry so the module goes idle in this chat.
   */
  function remove(): void {
    setError(null);
    apiFetch(`/api/bots/${botId}/chat-settings/${chatId}/${module.key}`, {
      method: 'DELETE',
    })
      .then(() => {
        setDraft({});
        onApply(chatId, null);
      })
      .catch((err: Error) => {
        const message = localizedErrorMessage(err);
        setError(message);
        showError(message);
      });
  }

  return (
    <Box sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2 }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          mb: 1.5,
        }}
      >
        <Typography
          variant="subtitle2"
          sx={{
            fontWeight: 700,
          }}
        >
          {chatLabel} · {chatId}
        </Typography>
        <Chip size="small" color="primary" variant="outlined" label={t('chatConfigs.configured')} />
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      )}

      <Stack spacing={2}>
        {(module.configFields ?? []).map((field) => (
          <ConfigFieldInput
            key={field.key}
            botId={botId}
            field={field}
            value={draft[field.key]}
            onChange={(value) => setField(field.key, value)}
          />
        ))}
        {(module.configFields ?? []).length === 0 && (
          <Typography
            variant="body2"
            sx={{
              color: 'text.secondary',
            }}
          >
            {t('chatConfigs.noFields')}
          </Typography>
        )}

        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button size="small" variant="contained" onClick={save} disabled={savedFlash}>
            {savedFlash ? t('chatConfigs.saved') : t('chatConfigs.save')}
          </Button>
          <Tooltip title={t('chatConfigs.remove')}>
            <IconButton
              size="small"
              aria-label={`${t('chatConfigs.remove')} ${chatLabel}`}
              onClick={remove}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>
    </Box>
  );
}
