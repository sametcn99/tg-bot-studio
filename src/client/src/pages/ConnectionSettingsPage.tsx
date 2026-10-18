import React, { useMemo } from 'react';
import { Alert, Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHeader from '../components/PageHeader';
import { LoadingState } from '../components/Feedback';
import { ChatModuleConfigsSection } from '../components/ChatModuleConfigsSection';
import { useConnections } from '../context/ConnectionsContext';
import { useLocalizedModules } from '../registry/localize';

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
  const { connections, loading: connectionsLoading } = useConnections();
  const modules = useLocalizedModules();

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
  const isActive = Boolean(connection.is_active ?? connection.isActive);

  // Telegram update events address chats by numeric id only; username-based
  // connections cannot carry per-chat settings.
  const numericChatId = /^-?\d+$/.test(activeChatId);

  return (
    <Box>
      <PageHeader
        title={t('connectionSettings.title', { title: connection.title })}
        subtitle={t('connectionSettings.subtitle', { chatId: activeChatId })}
        onBack={() => navigate(`/bots/${activeBotIdStr}/m/connections`)}
        actions={
          <Chip size="small" color={isActive ? 'success' : 'default'} label={connection.type} />
        }
      />

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
    </Box>
  );
}
