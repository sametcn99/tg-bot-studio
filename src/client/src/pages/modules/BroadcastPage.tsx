import React, { useEffect, useState } from 'react';
import { useLiveStream } from '../../hooks/useLiveStream';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../services/api';
import PageHeader from '../../components/PageHeader';
import { formatDateTime } from '../../utils/format';
import ModuleHelpDialog from '../../components/ModuleHelpDialog';
import VisualButtonBuilder from '../../components/VisualButtonBuilder';
import type { ModuleEntry } from '../../registry/modules';
import { localizedErrorMessage } from '../../utils/errors';

/**
 * Broadcast history row.
 * @interface BroadcastRow
 * @property {number} id - Broadcast id.
 * @property {string} target_type - Audience filter used.
 * @property {number} total_recipients - Resolved audience size.
 * @property {number} success_count - Delivered count.
 * @property {number} failed_count - Failed count.
 * @property {string} status - Queue status.
 * @property {string} created_at - Creation timestamp.
 */
interface BroadcastRow {
  id: number;
  target_type: string;
  total_recipients: number;
  success_count: number;
  failed_count: number;
  status: string;
  created_at: string;
}

/**
 * Enterprise Broadcast Engine page: composer with audience filters and the
 * live history table with progress counters.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {ModuleEntry} props.module - Broadcast catalog entry.
 * @returns {React.ReactElement} The page.
 */
export default function BroadcastPage({
  botId,
  module,
}: {
  botId: number;
  module: ModuleEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  const [rows, setRows] = useState<BroadcastRow[] | null>(null);
  const [targetType, setTargetType] = useState('all');
  const [language, setLanguage] = useState('en');
  const [recentDays, setRecentDays] = useState(7);
  const [messageText, setMessageText] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [buttons, setButtons] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);

  // SSE pings trigger an instant refetch during send-outs; the slow
  // interval is a backstop.
  useLiveStream('broadcasts', botId, reload);

  useEffect(() => {
    reload();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        reload();
      }
    }, 15000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId]);

  /**
   * Reloads broadcast history.
   * @returns {void}
   */
  function reload(): void {
    apiFetch<BroadcastRow[]>(`/api/bots/${botId}/broadcasts`)
      .then(setRows)
      .catch(() => undefined);
  }

  /**
   * Cancels an active or queued broadcast.
   */
  function cancelBroadcast(id: number): void {
    apiFetch(`/api/bots/${botId}/broadcasts/${id}/cancel`, { method: 'POST' })
      .then(reload)
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }

  /**
   * Queues a broadcast.
   * @returns {void}
   */
  function queue(): void {
    setError(null);
    const payload: Record<string, unknown> = { targetType, messageText, mediaUrl };
    if (targetType === 'language') payload.language = language;
    if (targetType === 'recent') payload.recentDays = recentDays;
    if (buttons.trim()) {
      try {
        payload.buttons = JSON.parse(buttons);
      } catch {
        setError(t('broadcast.invalidButtonsJson'));
        return;
      }
    }
    apiFetch(`/api/bots/${botId}/broadcasts`, { method: 'POST', body: JSON.stringify(payload) })
      .then(() => {
        setMessageText('');
        setMediaUrl('');
        setButtons('');
        reload();
      })
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }

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

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack spacing={2}>
            <TextField
              select
              label={t('broadcast.targetAudience')}
              value={targetType}
              onChange={(event) => setTargetType(event.target.value)}
              size="small"
              sx={{ maxWidth: 300 }}
            >
              <MenuItem value="all">{t('broadcast.audienceAll')}</MenuItem>
              <MenuItem value="language">{t('broadcast.audienceLanguage')}</MenuItem>
              <MenuItem value="recent">{t('broadcast.audienceRecent')}</MenuItem>
            </TextField>
            {targetType === 'language' && (
              <TextField
                label={t('broadcast.languageCode')}
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                size="small"
                sx={{ maxWidth: 200 }}
              />
            )}
            {targetType === 'recent' && (
              <TextField
                label={t('broadcast.activeWithinDays')}
                type="number"
                value={recentDays}
                onChange={(event) => setRecentDays(Number(event.target.value))}
                size="small"
                sx={{ maxWidth: 200 }}
              />
            )}
            <TextField
              label={t('broadcast.messageText')}
              multiline
              minRows={4}
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
              helperText={t('broadcast.placeholdersHelp')}
            />
            <TextField
              label={t('broadcast.photoUrl')}
              value={mediaUrl}
              onChange={(event) => setMediaUrl(event.target.value)}
              size="small"
            />
            <VisualButtonBuilder
              value={buttons}
              onChange={setButtons}
              label={t('broadcast.inlineButtons')}
              helperText={t('broadcast.buttonsExample')}
            />
            <Box>
              <Button
                variant="contained"
                startIcon={<SendIcon />}
                onClick={queue}
                disabled={messageText.trim().length === 0}
              >
                {t('broadcast.queue')}
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1 }} component="h3">
            {t('broadcast.history')}
          </Typography>
          <Stack spacing={2}>
            {(rows ?? []).map((row) => {
              const progress =
                row.total_recipients > 0
                  ? ((row.success_count + row.failed_count) / row.total_recipients) * 100
                  : 0;
              return (
                <Card key={row.id} variant="outlined">
                  <CardContent sx={{ py: 2 }}>
                    <Stack spacing={1}>
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        justifyContent="space-between"
                      >
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Chip size="small" label={row.target_type} />
                          <Chip
                            size="small"
                            color={
                              row.status === 'done'
                                ? 'success'
                                : row.status === 'failed' || row.status === 'cancelled'
                                  ? 'error'
                                  : row.status === 'interrupted'
                                    ? 'warning'
                                    : 'primary'
                            }
                            label={row.status}
                          />
                          <Typography variant="caption" color="text.secondary">
                            {formatDateTime(row.created_at)}
                          </Typography>
                        </Stack>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="caption">
                            {t('broadcast.counters', {
                              sent: row.success_count,
                              failed: row.failed_count,
                              total: row.total_recipients,
                            })}
                          </Typography>
                          {(row.status === 'running' || row.status === 'queued') && (
                            <Button
                              size="small"
                              color="error"
                              variant="outlined"
                              onClick={() => cancelBroadcast(row.id)}
                              sx={{ py: 0, px: 1, minHeight: 24, fontSize: '0.75rem' }}
                            >
                              {t('actions.cancel')}
                            </Button>
                          )}
                        </Stack>
                      </Stack>
                      {row.status === 'running' && (
                        <LinearProgress variant="determinate" value={progress} />
                      )}
                    </Stack>
                  </CardContent>
                </Card>
              );
            })}
            {rows !== null && rows.length === 0 && (
              <Typography color="text.secondary">{t('common.empty')}</Typography>
            )}
          </Stack>
        </CardContent>
      </Card>

      <ModuleHelpDialog module={docsOpen ? module : null} onClose={() => setDocsOpen(false)} />
    </Box>
  );
}
