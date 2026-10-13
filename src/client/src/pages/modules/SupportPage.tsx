import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../services/api';
import PageHeader from '../../components/PageHeader';
import ModuleHelpDialog from '../../components/ModuleHelpDialog';
import { useSnackbar } from '../../context/SnackbarContext';
import { formatDateTime } from '../../utils/format';
import ModuleConfigPage from '../ModuleConfigPage';
import { useLiveStream } from '../../hooks/useLiveStream';
import type { ModuleEntry } from '../../registry/modules';
import { localizedErrorMessage } from '../../utils/errors';

/**
 * Support thread summary.
 */
interface SupportThread {
  telegram_id: number;
  sender_name: string | null;
  message_count: number;
  last_activity: string;
  last_message: string | null;
}

/**
 * Open AI→Human escalation row.
 */
interface Escalation {
  telegramId: number;
  escalatedAt: string;
  senderName: string | null;
  lastMessage: string | null;
}

/**
 * Support message row.
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
 * inbox of conversation threads and messages with live web reply capability
 * and AI Copilot draft assistance.
 */
export default function SupportPage({
  botId,
  module,
}: {
  botId: number;
  module: ModuleEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [selectedUser, setSelectedUser] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);

  const loadData = useCallback((): void => {
    apiFetch<SupportThread[]>(`/api/bots/${botId}/support/threads`)
      .then(setThreads)
      .catch(() => undefined);
    apiFetch<Escalation[]>(`/api/bots/${botId}/support/escalations`)
      .then(setEscalations)
      .catch(() => undefined);
    const query = selectedUser ? `?limit=200` : '?limit=100';
    apiFetch<SupportMessage[]>(`/api/bots/${botId}/support/messages${query}`)
      .then(setMessages)
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }, [botId, selectedUser]);

  // SSE pings trigger an instant refetch; the slow interval is a backstop.
  useLiveStream('support', botId, loadData);

  useEffect(() => {
    loadData();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadData();
      }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [loadData]);

  const visible = selectedUser
    ? messages.filter((message) => message.telegram_id === selectedUser)
    : messages;

  const handleSendReply = async (): Promise<void> => {
    if (!selectedUser || !replyText.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await apiFetch(`/api/bots/${botId}/support/reply`, {
        method: 'POST',
        body: JSON.stringify({ telegramId: selectedUser, text: replyText.trim() }),
      });
      setReplyText('');
      loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const handleCopilotDraft = async (): Promise<void> => {
    if (!selectedUser || copilotLoading) return;
    setCopilotLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ draft: string }>(`/api/bots/${botId}/support/copilot/draft`, {
        method: 'POST',
        body: JSON.stringify({ telegramId: selectedUser }),
      });
      if (res?.draft) {
        setReplyText(res.draft);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCopilotLoading(false);
    }
  };

  const handleResolveEscalation = async (telegramId: number): Promise<void> => {
    try {
      await apiFetch(`/api/bots/${botId}/support/escalations/${telegramId}/resolve`, {
        method: 'POST',
      });
      showSuccess(t('support.resolved'));
      loadData();
    } catch (err: unknown) {
      showError(localizedErrorMessage(err));
    }
  };

  return (
    <Box>
      <PageHeader
        title={module.name}
        subtitle={module.description}
        onDocs={() => setDocsOpen(true)}
      />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ mb: 3 }}>
        <ModuleConfigPage botId={botId} module={module} embedded={true} />
      </Box>

      {escalations.length > 0 && (
        <Card sx={{ mb: 3, borderColor: 'warning.main', borderWidth: 1, borderStyle: 'solid' }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={700} component="h3" sx={{ mb: 0.5 }}>
              🚨 {t('support.escalations')} ({escalations.length})
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              {t('support.escalationsHint')}
            </Typography>
            <Stack spacing={1}>
              {escalations.map((escalation) => (
                <Stack
                  key={escalation.telegramId}
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  alignItems={{ sm: 'center' }}
                  justifyContent="space-between"
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {escalation.senderName ??
                        t('support.userFallback', { id: escalation.telegramId })}
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        {t('support.escalatedAt')}: {formatDateTime(escalation.escalatedAt)}
                      </Typography>
                    </Typography>
                    {escalation.lastMessage && (
                      <Typography variant="caption" color="text.secondary" noWrap display="block">
                        {escalation.lastMessage}
                      </Typography>
                    )}
                  </Box>
                  <Stack direction="row" spacing={1} flexShrink={0}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setSelectedUser(escalation.telegramId)}
                    >
                      {t('support.title')}
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      color="success"
                      onClick={() => void handleResolveEscalation(escalation.telegramId)}
                    >
                      {t('support.resolve')}
                    </Button>
                  </Stack>
                </Stack>
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="stretch">
        {/* Threads list */}
        <Card sx={{ width: { xs: '100%', md: 320 }, flexShrink: 0 }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1 }} component="h3">
              {t('support.conversations', { count: threads.length })}
            </Typography>
            <Stack spacing={1} sx={{ maxHeight: 600, overflowY: 'auto', pr: 0.5 }}>
              {threads.map((thread) => (
                <Box
                  key={thread.telegram_id}
                  onClick={() => setSelectedUser(thread.telegram_id)}
                  sx={{
                    p: 1.25,
                    borderRadius: 1.5,
                    cursor: 'pointer',
                    border: '1px solid',
                    borderColor: selectedUser === thread.telegram_id ? 'primary.main' : 'divider',
                    bgcolor:
                      selectedUser === thread.telegram_id ? 'action.selected' : 'background.paper',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Typography variant="body2" fontWeight={600} noWrap>
                    {thread.sender_name ?? t('support.userFallback', { id: thread.telegram_id })}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    sx={{ display: 'block' }}
                  >
                    {thread.last_message ?? t('support.mediaPlaceholder')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('support.msgsCount', { count: thread.message_count })} •{' '}
                    {formatDateTime(thread.last_activity)}
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

        {/* Messages and Web Reply Composer */}
        <Card sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ mb: 2 }}
            >
              <Typography variant="subtitle2" component="h3">
                {selectedUser
                  ? t('support.threadTitle', { id: selectedUser })
                  : t('support.allMessages')}
              </Typography>
              {selectedUser && (
                <Chip
                  size="small"
                  label={t('support.clearFilter')}
                  onClick={() => setSelectedUser(null)}
                />
              )}
            </Stack>

            {/* Message bubble stream */}
            <Stack
              spacing={1}
              sx={{
                flexGrow: 1,
                maxHeight: 450,
                overflowY: 'auto',
                p: 1.5,
                bgcolor: (th) =>
                  th.palette.mode === 'dark' ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.02)',
                borderRadius: 2,
                mb: 2,
              }}
            >
              {visible.slice(0, 150).map((message) => (
                <Box
                  key={message.id}
                  sx={{
                    alignSelf: message.direction === 'out' ? 'flex-end' : 'flex-start',
                    maxWidth: '80%',
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: message.direction === 'out' ? 'primary.main' : 'background.paper',
                    color: message.direction === 'out' ? 'primary.contrastText' : 'text.primary',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                  }}
                >
                  <Typography variant="caption" sx={{ opacity: 0.8, display: 'block' }}>
                    {message.direction === 'out'
                      ? t('support.admin')
                      : (message.sender_name ?? t('support.user'))}{' '}
                    • {formatDateTime(message.created_at)}
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {message.message_text ??
                      t('support.mediaTypePlaceholder', { type: message.media_type })}
                  </Typography>
                </Box>
              ))}
              {visible.length === 0 && (
                <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 4 }}>
                  {selectedUser ? t('support.noMessages') : t('common.empty')}
                </Typography>
              )}
            </Stack>

            {/* Web Reply Box (Enabled when a conversation is selected) */}
            {selectedUser ? (
              <Box sx={{ mt: 'auto', pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                {/* Copilot and Canned Replies bar */}
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ mb: 1.5, flexWrap: 'wrap', gap: 0.5 }}
                  alignItems="center"
                >
                  <Button
                    size="small"
                    variant="outlined"
                    color="secondary"
                    startIcon={
                      copilotLoading ? <CircularProgress size={14} /> : <AutoAwesomeIcon />
                    }
                    onClick={handleCopilotDraft}
                    disabled={copilotLoading}
                    sx={{ textTransform: 'none', fontWeight: 600 }}
                  >
                    {copilotLoading ? t('support.copilotLoading') : t('support.copilot')}
                  </Button>
                  <Chip
                    size="small"
                    label={t('support.quickHello')}
                    onClick={() => setReplyText(t('support.cannedGreeting'))}
                  />
                  <Chip
                    size="small"
                    label={t('support.quickThanks')}
                    onClick={() => setReplyText(t('support.cannedThanks'))}
                  />
                  <Chip
                    size="small"
                    label={t('support.quickEscalate')}
                    onClick={() => setReplyText(t('support.cannedEscalate'))}
                  />
                </Stack>

                {/* Input area */}
                <TextField
                  fullWidth
                  multiline
                  minRows={2}
                  maxRows={5}
                  size="small"
                  placeholder={t('support.replyPlaceholder')}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      void handleSendReply();
                    }
                  }}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          color="primary"
                          onClick={() => void handleSendReply()}
                          disabled={!replyText.trim() || sending}
                          aria-label={t('support.sendReplyAria')}
                        >
                          {sending ? <CircularProgress size={20} /> : <SendIcon />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                  helperText={t('support.replyHelper')}
                />
              </Box>
            ) : (
              <Box
                sx={{ p: 2, textAlign: 'center', bgcolor: 'background.default', borderRadius: 2 }}
              >
                <Typography variant="body2" color="text.secondary">
                  {t('support.selectConversationHint')}
                </Typography>
              </Box>
            )}
          </CardContent>
        </Card>
      </Stack>

      <ModuleHelpDialog module={docsOpen ? module : null} onClose={() => setDocsOpen(false)} />
    </Box>
  );
}
