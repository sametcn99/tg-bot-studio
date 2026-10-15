import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import PageHeader from '../components/PageHeader';
import { LoadingState } from '../components/Feedback';
import { useConnections } from '../context/ConnectionsContext';
import { useLocalizedModules } from '../registry/localize';
import type { ModuleEntry, ConfigField } from '../registry/modules';

/** Override snapshot for one module on one connection. */
interface ModuleOverride {
  moduleKey: string;
  chatId: string;
  override: Record<string, unknown>;
  overridden: boolean;
}

/**
 * Per-connection (per-group) module settings editor: every chat-overridable
 * module renders as a card with its config fields; overrides merge on top
 * of the bot-level defaults and apply to the live chat within seconds.
 */
export default function ConnectionSettingsPage(): React.ReactElement {
  const { botId, connectionId } = useParams<{ botId: string; connectionId: string }>();
  const numericBotId = Number(botId);
  const numericConnectionId = Number(connectionId);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { connections, loading: connectionsLoading } = useConnections();
  const modules = useLocalizedModules();

  const [overrides, setOverrides] = useState<ModuleOverride[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Record<string, unknown>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const connection = useMemo(
    () => connections.find((row) => row.id === numericConnectionId),
    [connections, numericConnectionId],
  );

  useEffect(() => {
    if (Number.isFinite(numericBotId) && Number.isFinite(numericConnectionId)) {
      setLoading(true);
      apiFetch<ModuleOverride[]>(
        `/api/bots/${numericBotId}/connections/${numericConnectionId}/settings`,
      )
        .then((rows) => {
          setOverrides(rows);
          const initial: Record<string, Record<string, unknown>> = {};
          for (const row of rows) initial[row.moduleKey] = { ...row.override };
          setDrafts(initial);
        })
        .catch((err: Error) => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [numericBotId, numericConnectionId]);

  /** Modules that support per-chat overrides (group surfaces only). */
  const overridable = useMemo(
    () =>
      modules.filter(
        (entry) =>
          entry.configFields !== undefined &&
          [
            'group-moderation',
            'group-tools',
            'locks',
            'antiraid',
            'rules',
            'admin-log',
            'cleaning',
            'topics',
            'federation',
            'language',
            'bot2bot',
            'moderation',
            'welcome',
            'captcha',
          ].includes(entry.key),
      ),
    [modules],
  );

  /**
   * Saves one module's override payload.
   */
  function saveModule(moduleKey: string): void {
    setError(null);
    setSaved(null);
    apiFetch(`/api/bots/${numericBotId}/connections/${numericConnectionId}/settings/${moduleKey}`, {
      method: 'PUT',
      body: JSON.stringify(drafts[moduleKey] ?? {}),
    })
      .then(() => {
        setSaved(moduleKey);
        setTimeout(() => setSaved(null), 2_500);
      })
      .catch((err: Error) => setError(err.message));
  }

  /**
   * Clears one module's override so the chat falls back to bot defaults.
   */
  function resetModule(moduleKey: string): void {
    setError(null);
    apiFetch(`/api/bots/${numericBotId}/connections/${numericConnectionId}/settings/${moduleKey}`, {
      method: 'DELETE',
    })
      .then(() => {
        setOverrides((prev) =>
          prev.map((row) =>
            row.moduleKey === moduleKey ? { ...row, override: {}, overridden: false } : row,
          ),
        );
        setDrafts((prev) => ({ ...prev, [moduleKey]: {} }));
      })
      .catch((err: Error) => setError(err.message));
  }

  /**
   * Updates one field of one module draft.
   */
  function updateField(moduleKey: string, key: string, value: unknown): void {
    setDrafts((prev) => ({
      ...prev,
      [moduleKey]: { ...(prev[moduleKey] ?? {}), [key]: value },
    }));
  }

  if (connectionsLoading || loading) {
    return <LoadingState label={t('connectionSettings.loading')} />;
  }

  if (!connection) {
    return <Alert severity="error">{t('connectionSettings.connectionNotFound')}</Alert>;
  }

  return (
    <Box>
      <PageHeader
        title={t('connectionSettings.title', { title: connection.title })}
        subtitle={t('connectionSettings.subtitle', { chatId: connection.chat_id })}
        onBack={() => navigate(`/bots/${numericBotId}/m/connections`)}
        actions={
          <Chip
            size="small"
            color={connection.is_active ? 'success' : 'default'}
            label={connection.type}
          />
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Stack spacing={2}>
        {overridable.map((entry: ModuleEntry) => {
          const row = overrides.find((item) => item.moduleKey === entry.key);
          const draft = drafts[entry.key] ?? {};
          const hasOverride = row?.overridden ?? false;
          return (
            <Card key={entry.key} variant="outlined">
              <CardContent>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  sx={{ mb: 1.5 }}
                >
                  <Typography variant="subtitle1" fontWeight={700}>
                    {entry.name}
                  </Typography>
                  <Chip
                    size="small"
                    color={hasOverride ? 'primary' : 'default'}
                    variant={hasOverride ? 'filled' : 'outlined'}
                    label={
                      hasOverride
                        ? t('connectionSettings.overridden')
                        : t('connectionSettings.botDefault')
                    }
                  />
                </Stack>
                <Stack spacing={2}>
                  {entry.configFields?.map((field: ConfigField) => (
                    <ConnectionFieldInput
                      key={field.key}
                      label={field.label}
                      type={field.type}
                      options={field.options}
                      help={field.help}
                      value={draft[field.key]}
                      onChange={(value) => updateField(entry.key, field.key, value)}
                    />
                  ))}
                </Stack>
                <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => saveModule(entry.key)}
                    disabled={saved === entry.key}
                  >
                    {saved === entry.key
                      ? t('connectionSettings.saved')
                      : t('connectionSettings.save')}
                  </Button>
                  <Button
                    size="small"
                    startIcon={<RestartAltIcon />}
                    onClick={() => resetModule(entry.key)}
                    disabled={!hasOverride}
                  >
                    {t('connectionSettings.reset')}
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          );
        })}
      </Stack>
    </Box>
  );
}

/**
 * Minimal field widget mirroring ConfigFieldInput for the override cards.
 */
function ConnectionFieldInput({
  label,
  type,
  options,
  help,
  value,
  onChange,
}: {
  label: string;
  type: string;
  options?: string[];
  help?: string;
  value: unknown;
  onChange: (value: unknown) => void;
}): React.ReactElement {
  const { t } = useTranslation();

  if (type === 'switch') {
    return (
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="body2">{label}</Typography>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
      </Stack>
    );
  }

  if (type === 'select') {
    return (
      <label style={{ display: 'block' }}>
        <Typography variant="body2" fontWeight={600}>
          {label}
        </Typography>
        <select
          value={String(value ?? options?.[0] ?? '')}
          onChange={(event) => onChange(event.target.value)}
          style={{ width: '100%', padding: '8px', marginTop: 4, borderRadius: 6 }}
        >
          {(options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {help && (
          <Typography variant="caption" color="text.secondary">
            {help}
          </Typography>
        )}
      </label>
    );
  }

  if (type === 'stringList') {
    const text = Array.isArray(value) ? (value as string[]).join('\n') : '';
    return (
      <label style={{ display: 'block' }}>
        <Typography variant="body2" fontWeight={600}>
          {label}
        </Typography>
        <textarea
          value={text}
          onChange={(event) =>
            onChange(
              event.target.value
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
            )
          }
          rows={4}
          style={{ width: '100%', padding: '8px', marginTop: 4, borderRadius: 6 }}
        />
        {help && (
          <Typography variant="caption" color="text.secondary">
            {help}
          </Typography>
        )}
      </label>
    );
  }

  const numeric = type === 'number';
  return (
    <label style={{ display: 'block' }}>
      <Typography variant="body2" fontWeight={600}>
        {label}
      </Typography>
      <input
        type={numeric ? 'number' : 'text'}
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(event) => onChange(numeric ? Number(event.target.value) : event.target.value)}
        placeholder={type === 'textarea' ? t('connectionSettings.placeholder') : ''}
        style={{ width: '100%', padding: '8px', marginTop: 4, borderRadius: 6 }}
      />
      {help && (
        <Typography variant="caption" color="text.secondary">
          {help}
        </Typography>
      )}
    </label>
  );
}
