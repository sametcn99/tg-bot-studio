import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../services/api';
import PageHeader from '../../components/PageHeader';
import ModuleHelpDialog from '../../components/ModuleHelpDialog';
import ModuleConfigPage from '../ModuleConfigPage';
import type { ModuleEntry } from '../../registry/modules';

/**
 * Support thread summary.
 * @interface SupportThread
 * @property {number} telegram_id - User Telegram id.
 * @property {string} [sender_name] - Last sender name.
 * @property {number} message_count - Total messages.
 * @property {string} last_activity - ISO timestamp.
 * @property {string} [last_message] - Preview of the latest message.
 */
interface SupportThread {
  telegram_id: number;
  sender_name: string | null;
  message_count: number;
  last_activity: string;
  last_message: string | null;
}

/**
 * Support message row.
 * @interface SupportMessage
 * @property {number} id - Message id.
 * @property {number} telegram_id - User Telegram id.
 * @property {string} direction - `in` (user) or `out` (admin).
 * @property {string} [sender_name] - Sender display name.
 * @property {string} [message_text] - Message body.
 * @property {string} media_type - Media classification.
 * @property {string} created_at - Timestamp.
 */
interface SupportMessage {
  id: number;
  telegram_id: number;
  direction: string;
  sender_name: string | null;
  message_text: string | null;
  media_type: string;
  created_at: string;
}

/**
 * Forum Topics Support Desk page: configuration card plus an auto-refreshing
 * inbox of conversation threads and messages.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {ModuleEntry} props.module - Support catalog entry.
 * @returns {React.ReactElement} The page.
 */
export default function SupportPage({
  botId,
  module,
}: {
  botId: number;
  module: ModuleEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [selectedUser, setSelectedUser] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);

  useEffect(() => {
    const load = (): void => {
      apiFetch<SupportThread[]>(`/api/bots/${botId}/support/threads`)
        .then(setThreads)
        .catch(() => undefined);
      const query = selectedUser ? `?limit=200` : '?limit=100';
      apiFetch<SupportMessage[]>(`/api/bots/${botId}/support/messages${query}`)
        .then(setMessages)
        .catch((err: Error) => setError(err.message));
    };
    load();
    const timer = window.setInterval(load, 4000);
    return () => window.clearInterval(timer);
  }, [botId, selectedUser]);

  const visible = selectedUser ? messages.filter((message) => message.telegram_id === selectedUser) : messages;

  return (
    <Box>
      <PageHeader
        title={module.name}
        subtitle={module.description}
        onDocs={() => setDocsOpen(true)}
      />
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ mb: 3 }}>
        <ModuleConfigPage botId={botId} module={module} />
      </Box>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="stretch">
        <Card sx={{ width: { xs: '100%', md: 300 }, flexShrink: 0 }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1 }} component="h3">
              Conversations
            </Typography>
            <Stack spacing={1}>
              {threads.map((thread) => (
                <Box
                  key={thread.telegram_id}
                  onClick={() => setSelectedUser(thread.telegram_id)}
                  sx={{
                    p: 1,
                    borderRadius: 1,
                    cursor: 'pointer',
                    border: '1px solid',
                    borderColor: selectedUser === thread.telegram_id ? 'primary.main' : 'divider',
                  }}
                >
                  <Typography variant="body2" fontWeight={600} noWrap>
                    {thread.sender_name ?? String(thread.telegram_id)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {thread.last_message ?? '[media]'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {thread.message_count} messages / {thread.last_activity?.slice(0, 16).replace('T', ' ')}
                  </Typography>
                </Box>
              ))}
              {threads.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  {t('common.empty')}
                </Typography>
              )}
            </Stack>
          </CardContent>
        </Card>

        <Card sx={{ flexGrow: 1, minWidth: 0 }}>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 2 }}>
              <Typography variant="subtitle2" component="h3">
                {selectedUser ? `Thread ${selectedUser}` : 'All messages'}
              </Typography>
              {selectedUser && (
                <Chip
                  size="small"
                  label="Clear filter"
                  onClick={() => setSelectedUser(null)}
                />
              )}
            </Stack>
            <Stack spacing={1}>
              {visible.slice(0, 100).map((message) => (
                <Box
                  key={message.id}
                  sx={{
                    alignSelf: message.direction === 'out' ? 'flex-end' : 'flex-start',
                    maxWidth: '80%',
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: message.direction === 'out' ? 'primary.main' : 'background.default',
                    color: message.direction === 'out' ? 'primary.contrastText' : 'text.primary',
                  }}
                >
                  <Typography variant="caption" sx={{ opacity: 0.8 }}>
                    {message.direction === 'out' ? 'Admin' : (message.sender_name ?? 'User')} /{' '}
                    {message.created_at?.slice(11, 16)}
                  </Typography>
                  <Typography variant="body2">
                    {message.message_text ?? `[${message.media_type}]`}
                  </Typography>
                </Box>
              ))}
              {visible.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  {t('common.empty')}
                </Typography>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Stack>

      <ModuleHelpDialog module={docsOpen ? module : null} onClose={() => setDocsOpen(false)} />
    </Box>
  );
}
