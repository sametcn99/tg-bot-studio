import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import PageHeader from '../components/PageHeader';
import { LoadingState } from '../components/Feedback';
import { ChatOverrideSection } from '../components/ChatOverrideSection';
import { useConnections } from '../context/ConnectionsContext';
import { useLocalizedModules } from '../registry/localize';

/**
 * Per-connection (per-group / per-channel) module settings editor: every
 * chat-scoped module renders as a card with the shared per-chat override
 * editor pinned to this connection's chat; overrides merge on top of the
 * bot-level defaults and apply to the live chat within seconds.
 */
export default function ConnectionSettingsPage(): React.ReactElement {
  const { botId, connectionId } = useParams<{ botId: string; connectionId: string }>();
  const numericBotId = Number(botId);
  const numericConnectionId = Number(connectionId);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { connections, loading: connectionsLoading } = useConnections();
  const modules = useLocalizedModules();

  const [botConfigs, setBotConfigs] = useState<Record<string, Record<string, unknown>> | null>(
    null,
  );
  const [configError, setConfigError] = useState<string | null>(null);

  const connection = useMemo(
    () => connections.find((row) => row.id === numericConnectionId),
    [connections, numericConnectionId],
  );

  useEffect(() => {
    if (Number.isFinite(numericBotId)) {
      apiFetch<Array<{ key: string; config: Record<string, unknown> }>>(
        `/api/bots/${numericBotId}/modules`,
      )
        .then((rows) => {
          const map: Record<string, Record<string, unknown>> = {};
          for (const row of rows) map[row.key] = row.config ?? {};
          setBotConfigs(map);
        })
        .catch((err: Error) => setConfigError(err.message));
    }
  }, [numericBotId]);

  /** Modules that support per-chat overrides (groups and channels). */
  const overridable = useMemo(() => modules.filter((entry) => entry.chatScoped), [modules]);

  if (connectionsLoading || !botConfigs) {
    return <LoadingState label={t('connectionSettings.loading')} />;
  }

  if (!connection) {
    return <Alert severity="error">{t('connectionSettings.connectionNotFound')}</Alert>;
  }

  // Telegram update events address chats by numeric id only; username-based
  // connections cannot carry per-chat settings.
  const numericChatId = /^-?\d+$/.test(connection.chat_id);

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

      {configError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {configError}
        </Alert>
      )}
      {!numericChatId && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('connectionSettings.numericOnly')}
        </Alert>
      )}

      {numericChatId && (
        <Stack spacing={2}>
          {overridable.map((entry) => (
            <Card key={entry.key} variant="outlined">
              <CardContent>
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
                  {entry.name}
                </Typography>
                <ChatOverrideSection
                  botId={numericBotId}
                  module={entry}
                  botConfig={botConfigs[entry.key] ?? {}}
                  fixedChatId={connection.chat_id}
                />
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}
    </Box>
  );
}
