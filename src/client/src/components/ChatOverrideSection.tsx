import React, { useEffect, useMemo, useState } from 'react';
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
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import UndoIcon from '@mui/icons-material/Undo';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import { useConnections, type ChatConnection } from '../context/ConnectionsContext';
import { useSnackbar } from '../context/SnackbarContext';
import { ConfigFieldInput } from './ConfigFieldInput';
import { localizedErrorMessage } from '../utils/errors';
import type { ModuleEntry } from '../registry/modules';

/** Override row returned by the chat-overrides list endpoint. */
interface ChatOverrideRow {
  chatId: string;
  override: Record<string, unknown>;
}

/** Override snapshot returned by the per-chat read endpoint. */
interface ChatSettingsSnapshot {
  moduleKey: string;
  chatId: string;
  override: Record<string, unknown>;
  effective: Record<string, unknown>;
  overridden: boolean;
}

/** Display title for a chat id, falling back to the raw id. */
function chatLabelFor(connections: ChatConnection[], chatId: string): string {
  const conn = connections.find((row) => row.chat_id === chatId);
  return conn ? `${conn.title}` : chatId;
}

/**
 * Per-group and per-channel override editor for one chat-scoped module.
 * Renders below the bot-level config card on the module page: pick any
 * connected group or channel and define its own values. Only fields the
 * user touches are stored as the override; everything else keeps
 * inheriting the bot-level defaults, and the whole override can be reset
 * with one click. The connection settings page embeds the same section in
 * `fixedChatId` mode (one chat, no picker).
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {ModuleEntry} props.module - Localized module catalog entry.
 * @param {Record<string, unknown>} props.botConfig - Effective bot-level
 * config (registry defaults merged under the saved bot config).
 * @param {string} [props.fixedChatId] - Pins the editor to one chat and
 * hides the picker and chips row (connection settings page).
 * @returns {React.ReactElement | null} The section, or null while loading.
 */
export function ChatOverrideSection({
  botId,
  module,
  botConfig,
  fixedChatId,
}: {
  botId: number;
  module: ModuleEntry;
  botConfig: Record<string, unknown>;
  fixedChatId?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { connections, loading: connectionsLoading } = useConnections();
  const [overrides, setOverrides] = useState<Record<string, Record<string, unknown>>>({});
  const [selectedChatId, setSelectedChatId] = useState<string>(fixedChatId ?? '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const request = fixedChatId
      ? apiFetch<ChatSettingsSnapshot>(
          `/api/bots/${botId}/chat-settings/${fixedChatId}/${module.key}`,
        ).then((snapshot) => ({ [fixedChatId]: snapshot.override ?? {} }))
      : apiFetch<ChatOverrideRow[]>(`/api/bots/${botId}/modules/${module.key}/chat-overrides`).then(
          (rows) => {
            const map: Record<string, Record<string, unknown>> = {};
            for (const row of rows) map[row.chatId] = row.override ?? {};
            return map;
          },
        );
    request
      .then((map) => setOverrides(map))
      .catch((err: Error) => setError(localizedErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [botId, module.key, fixedChatId]);

  // Only numeric chat ids can receive per-chat settings: Telegram update
  // events address chats by numeric id, never by @username.
  const groups = useMemo(
    () =>
      connections.filter(
        (row) => /^-?\d+$/.test(row.chat_id) && (row.type === 'group' || row.type === 'supergroup'),
      ),
    [connections],
  );
  const channels = useMemo(
    () => connections.filter((row) => /^-?\d+$/.test(row.chat_id) && row.type === 'channel'),
    [connections],
  );

  /**
   * Merges a saved/cleared override back into the local map; chats whose
   * override becomes empty drop out of the chip row entirely.
   */
  function applyOverride(chatId: string, override: Record<string, unknown>): void {
    setOverrides((prev) => {
      const next = { ...prev };
      if (Object.keys(override).length === 0) {
        delete next[chatId];
      } else {
        next[chatId] = override;
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
            {t('chatOverrides.title')}
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: 'text.secondary',
            }}
          >
            {t('chatOverrides.hint')}
          </Typography>
        </Box>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      {!fixedChatId && (
        <>
          <TextField
            select
            label={t('chatOverrides.selectChat')}
            size="small"
            fullWidth
            value={selectedChatId}
            onChange={(event) => setSelectedChatId(event.target.value)}
          >
            <MenuItem disabled value="">
              {t('chatOverrides.selectChat')}
            </MenuItem>
            {groups.length > 0 && (
              <MenuItem disabled dense>
                {t('chatOverrides.groups')}
              </MenuItem>
            )}
            {groups.map((row) => (
              <MenuItem key={row.chat_id} value={row.chat_id}>
                {row.title} · {row.chat_id}
              </MenuItem>
            ))}
            {channels.length > 0 && (
              <MenuItem disabled dense>
                {t('chatOverrides.channels')}
              </MenuItem>
            )}
            {channels.map((row) => (
              <MenuItem key={row.chat_id} value={row.chat_id}>
                {row.title} · {row.chat_id}
              </MenuItem>
            ))}
          </TextField>

          {Object.keys(overrides).length > 0 ? (
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{
                flexWrap: 'wrap',
              }}
            >
              {Object.entries(overrides).map(([chatId, override]) => (
                <Chip
                  key={chatId}
                  size="small"
                  color={chatId === selectedChatId ? 'primary' : 'default'}
                  variant={chatId === selectedChatId ? 'filled' : 'outlined'}
                  label={`${chatLabelFor(connections, chatId)} · ${Object.keys(override).length}`}
                  onClick={() => setSelectedChatId(chatId)}
                  onDelete={() => {
                    apiFetch(`/api/bots/${botId}/chat-settings/${chatId}/${module.key}`, {
                      method: 'DELETE',
                    }).catch(() => undefined);
                    applyOverride(chatId, {});
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
              {t('chatOverrides.noneYet')}
            </Typography>
          )}
        </>
      )}

      {activeChatId && (
        <ChatOverrideEditor
          key={`${module.key}:${activeChatId}`}
          botId={botId}
          module={module}
          chatId={activeChatId}
          chatLabel={chatLabelFor(connections, activeChatId)}
          botConfig={botConfig}
          override={overrides[activeChatId] ?? {}}
          onApply={applyOverride}
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
 * Field editor for one selected chat: seeds a draft from the saved override,
 * shows the inherited bot-level value for untouched fields, and stores only
 * the fields the user actually changed.
 */
function ChatOverrideEditor({
  botId,
  module,
  chatId,
  chatLabel,
  botConfig,
  override,
  onApply,
}: {
  botId: number;
  module: ModuleEntry;
  chatId: string;
  chatLabel: string;
  botConfig: Record<string, unknown>;
  override: Record<string, unknown>;
  onApply: (chatId: string, override: Record<string, unknown>) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [draft, setDraft] = useState<Record<string, unknown>>({ ...override });
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirtyFields = Object.keys(draft).length;

  /**
   * Stores one overridden value in the draft.
   */
  function setField(key: string, value: unknown): void {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  /**
   * Drops one field from the draft so it inherits the bot default again.
   */
  function inheritField(key: string): void {
    setDraft((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  /**
   * Persists the draft as this chat's override.
   */
  function save(): void {
    setError(null);
    apiFetch(`/api/bots/${botId}/chat-settings/${chatId}/${module.key}`, {
      method: 'PUT',
      body: JSON.stringify(draft),
    })
      .then(() => {
        onApply(chatId, { ...draft });
        setSavedFlash(true);
        window.setTimeout(() => setSavedFlash(false), 2_500);
        showSuccess(t('chatOverrides.saved'));
      })
      .catch((err: Error) => {
        const message = localizedErrorMessage(err);
        setError(message);
        showError(message);
      });
  }

  /**
   * Clears the whole override so the chat inherits every bot default.
   */
  function reset(): void {
    setError(null);
    apiFetch(`/api/bots/${botId}/chat-settings/${chatId}/${module.key}`, {
      method: 'DELETE',
    })
      .then(() => {
        setDraft({});
        onApply(chatId, {});
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
        <Chip
          size="small"
          color={dirtyFields > 0 ? 'primary' : 'default'}
          variant={dirtyFields > 0 ? 'filled' : 'outlined'}
          label={
            dirtyFields > 0
              ? t('chatOverrides.overriddenFields', { count: dirtyFields })
              : t('chatOverrides.botDefault')
          }
        />
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
            value={draft[field.key] !== undefined ? draft[field.key] : botConfig[field.key]}
            onChange={(value) => setField(field.key, value)}
            action={
              draft[field.key] !== undefined ? (
                <Tooltip title={t('chatOverrides.inherit')}>
                  <IconButton
                    size="small"
                    aria-label={t('chatOverrides.inherit')}
                    onClick={() => inheritField(field.key)}
                  >
                    <UndoIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : undefined
            }
          />
        ))}
        {(module.configFields ?? []).length === 0 && (
          <Typography
            variant="body2"
            sx={{
              color: 'text.secondary',
            }}
          >
            {t('chatOverrides.noFields')}
          </Typography>
        )}

        <Stack direction="row" spacing={1}>
          <Button size="small" variant="contained" onClick={save} disabled={savedFlash}>
            {savedFlash ? t('chatOverrides.saved') : t('chatOverrides.save')}
          </Button>
          <Button
            size="small"
            startIcon={<RestartAltIcon />}
            onClick={reset}
            disabled={dirtyFields === 0}
          >
            {t('chatOverrides.reset')}
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
