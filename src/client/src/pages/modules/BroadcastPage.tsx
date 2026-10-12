import React, { useEffect, useState } from 'react';
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
import ModuleHelpDialog from '../../components/ModuleHelpDialog';
import type { ModuleEntry } from '../../registry/modules';

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

  useEffect(() => {
    reload();
    const timer = window.setInterval(reload, 5000);
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
        setError('Buttons must be a valid JSON array.');
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
      .catch((err: Error) => setError(err.message));
  }

  return (
    <Box>
      <PageHeader
        title={module.name}
        subtitle={module.description}
        onDocs={() => setDocsOpen(true)}
      />
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack spacing={2}>
            <TextField
              select
              label="Target audience"
              value={targetType}
              onChange={(event) => setTargetType(event.target.value)}
              size="small"
              sx={{ maxWidth: 300 }}
            >
              <MenuItem value="all">All subscribers</MenuItem>
              <MenuItem value="language">By language</MenuItem>
              <MenuItem value="recent">Recently active</MenuItem>
            </TextField>
            {targetType === 'language' && (
              <TextField
                label="Language code"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                size="small"
                sx={{ maxWidth: 200 }}
              />
            )}
            {targetType === 'recent' && (
              <TextField
                label="Active within days"
                type="number"
                value={recentDays}
                onChange={(event) => setRecentDays(Number(event.target.value))}
                size="small"
                sx={{ maxWidth: 200 }}
              />
            )}
            <TextField
              label="Message text"
              multiline
              minRows={4}
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
              helperText="Placeholders: {first_name}, {username}, {user_id}, {mention}"
            />
            <TextField
              label="Photo URL (optional)"
              value={mediaUrl}
              onChange={(event) => setMediaUrl(event.target.value)}
              size="small"
            />
            <TextField
              label="Inline buttons (JSON, optional)"
              multiline
              minRows={2}
              value={buttons}
              onChange={(event) => setButtons(event.target.value)}
              size="small"
              helperText='[{"text":"Open","url":"https://example.com"}]'
            />
            <Box>
              <Button
                variant="contained"
                startIcon={<SendIcon />}
                onClick={queue}
                disabled={messageText.trim().length === 0}
              >
                Queue broadcast
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1 }} component="h3">
            History
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
                      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Chip size="small" label={row.target_type} />
                          <Chip
                            size="small"
                            color={row.status === 'done' ? 'success' : row.status === 'failed' ? 'error' : 'primary'}
                            label={row.status}
                          />
                          <Typography variant="caption" color="text.secondary">
                            {row.created_at?.slice(0, 19).replace('T', ' ')}
                          </Typography>
                        </Stack>
                        <Typography variant="caption">
                          {row.success_count} sent / {row.failed_count} failed / {row.total_recipients} total
                        </Typography>
                      </Stack>
                      {row.status === 'running' && <LinearProgress variant="determinate" value={progress} />}
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
