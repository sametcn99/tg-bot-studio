import React, { useEffect, useState } from 'react';
import { useLiveStream } from '../../hooks/useLiveStream';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  LinearProgress,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import ScienceIcon from '@mui/icons-material/Science';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../services/api';
import { useApi } from '../../hooks/useApi';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import PageHeader from '../../components/PageHeader';
import { LoadingState } from '../../components/Feedback';
import { useModuleDocs } from '../../context/ModuleDocsContext';
import { formatDateTime } from '../../utils/format';
import VisualButtonBuilder from '../../components/VisualButtonBuilder';
import AiTranslateDialog from '../../components/AiTranslateDialog';
import MediaPicker from '../../components/MediaPicker';
import type { ModuleEntry } from '../../registry/modules';
import { localizedErrorMessage } from '../../utils/errors';

/**
 * Broadcast history row.
 * @interface BroadcastRow
 */
interface BroadcastRow {
  id: string;
  target_type: string;
  total_recipients: number;
  success_count: number;
  failed_count: number;
  status: string;
  created_at: string;
  experiment_id: string | null;
  variant_label: string | null;
  phase: string | null;
  clicks: number;
}

/** One A/B variant in the composer. */
interface ComposerVariant {
  messageText: string;
  mediaUrl: string;
}

/**
 * Enterprise Broadcast Engine page: composer with audience filters, A/B
 * variant experiments, media library picker, AI translation, and the live
 * history table with click-through counters.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {ModuleEntry} props.module - Broadcast catalog entry.
 * @returns {React.ReactElement} The page.
 */
export default function BroadcastPage({
  botId,
  module,
}: {
  botId: string;
  module: ModuleEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  const { openDocs } = useModuleDocs();
  const [targetType, setTargetType] = useState('all');
  const [language, setLanguage] = useState('en');
  const [recentDays, setRecentDays] = useState(7);
  const [abMode, setAbMode] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [variants, setVariants] = useState<ComposerVariant[]>([
    { messageText: '', mediaUrl: '' },
    { messageText: '', mediaUrl: '' },
  ]);
  const [testSplitPercent, setTestSplitPercent] = useState(20);
  const [buttons, setButtons] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mediaPickerFor, setMediaPickerFor] = useState<'main' | number | null>(null);
  const [translateOpen, setTranslateOpen] = useState(false);

  // Broadcast history: shared fetch handle (SSE + interval + mutations all
  // refetch through `reload`); failures surface instead of rendering empty.
  const {
    data: historyData,
    error: historyError,
    loading: historyLoading,
    reload,
  } = useApi<BroadcastRow[]>(`/api/bots/${botId}/broadcasts`, [botId]);
  const rows = historyData;

  // Unsaved-changes guard for the composer draft (route + tab close).
  const hasDraft =
    buttons.trim() !== '' ||
    (abMode
      ? variants.some((variant) => variant.messageText.trim() || variant.mediaUrl.trim())
      : Boolean(messageText.trim() || mediaUrl.trim()));
  const unsavedGuard = useUnsavedGuard(hasDraft);

  // SSE pings trigger an instant refetch during send-outs; the slow
  // interval is a backstop.
  useLiveStream('broadcasts', botId, reload);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        reload();
      }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [reload]);

  /**
   * Cancels an active or queued broadcast.
   */
  function cancelBroadcast(id: string): void {
    apiFetch(`/api/bots/${botId}/broadcasts/${id}/cancel`, { method: 'POST' })
      .then(reload)
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }

  /**
   * Picks the winner of an A/B experiment (auto-ranked by click-through).
   */
  function chooseWinner(experimentId: string): void {
    apiFetch(`/api/bots/${botId}/broadcasts/experiments/${experimentId}/choose-winner`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
      .then(() => {
        setError(null);
        reload();
      })
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }

  /**
   * Queues a broadcast or an A/B experiment.
   * @returns {void}
   */
  function queue(): void {
    setError(null);
    const payload: Record<string, unknown> = { targetType };
    if (targetType === 'language') payload.language = language;
    if (targetType === 'recent') payload.recentDays = recentDays;

    let parsedButtons: unknown;
    if (buttons.trim()) {
      try {
        parsedButtons = JSON.parse(buttons);
      } catch {
        setError(t('broadcast.invalidButtonsJson'));
        return;
      }
    }

    if (abMode) {
      const filled = variants.map((variant) => variant.messageText.trim()).filter(Boolean).length;
      if (filled < 2) {
        setError(t('broadcast.abNeedTwo'));
        return;
      }
      payload.variants = variants
        .filter((variant) => variant.messageText.trim())
        .map((variant) => ({
          messageText: variant.messageText,
          mediaUrl: variant.mediaUrl || undefined,
          buttons: parsedButtons,
        }));
      payload.testSplitPercent = testSplitPercent;
    } else {
      payload.messageText = messageText;
      payload.mediaUrl = mediaUrl;
      if (parsedButtons) payload.buttons = parsedButtons;
      if (!messageText.trim()) return;
    }

    apiFetch(`/api/bots/${botId}/broadcasts`, { method: 'POST', body: JSON.stringify(payload) })
      .then(() => {
        setMessageText('');
        setMediaUrl('');
        setVariants([
          { messageText: '', mediaUrl: '' },
          { messageText: '', mediaUrl: '' },
        ]);
        setButtons('');
        reload();
      })
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }

  /**
   * Groups history rows into plain broadcasts and A/B experiment groups.
   */
  const plainRows = (rows ?? []).filter((row) => !row.experiment_id);
  const experiments = new Map<string, BroadcastRow[]>();
  for (const row of rows ?? []) {
    if (!row.experiment_id) continue;
    const list = experiments.get(row.experiment_id) ?? [];
    list.push(row);
    experiments.set(row.experiment_id, list);
  }

  /**
   * Renders one history row.
   */
  function renderRow(row: BroadcastRow, label?: string): React.ReactElement {
    const progress =
      row.total_recipients > 0
        ? ((row.success_count + row.failed_count) / row.total_recipients) * 100
        : 0;
    return (
      <Card key={label ?? row.id} variant="outlined">
        <CardContent sx={{ py: 2 }}>
          <Stack spacing={1}>
            <Stack
              direction="row"
              spacing={1}
              sx={{
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 0.5,
                }}
              >
                {label && <Chip size="small" color="info" label={label} />}
                <Chip size="small" label={row.target_type} />
                {row.phase && <Chip size="small" variant="outlined" label={row.phase} />}
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
                <Typography
                  variant="caption"
                  sx={{
                    color: 'text.secondary',
                  }}
                >
                  {formatDateTime(row.created_at)}
                </Typography>
              </Stack>
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  alignItems: 'center',
                }}
              >
                <Typography variant="caption">
                  {t('broadcast.counters', {
                    sent: row.success_count,
                    failed: row.failed_count,
                    total: row.total_recipients,
                  })}
                  {row.clicks > 0 ? ` · ${t('broadcast.clicks', { count: row.clicks })}` : ''}
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
            {row.status === 'running' && <LinearProgress variant="determinate" value={progress} />}
          </Stack>
        </CardContent>
      </Card>
    );
  }

  return (
    <Box>
      <PageHeader
        title={module.name}
        subtitle={module.description}
        onDocs={() => openDocs(module)}
      />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack spacing={2}>
            <Stack
              direction="row"
              sx={{
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 1,
              }}
            >
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
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  alignItems: 'center',
                }}
              >
                <ScienceIcon fontSize="small" color={abMode ? 'primary' : 'disabled'} />
                <Typography variant="body2">{t('broadcast.abMode')}</Typography>
                <Switch
                  checked={abMode}
                  onChange={(event) => setAbMode(event.target.checked)}
                  slotProps={{
                    input: { 'aria-label': t('broadcast.abMode') },
                  }}
                />
              </Stack>
            </Stack>
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

            {abMode ? (
              <>
                <Alert severity="info">
                  {t('broadcast.abExplainer', { split: testSplitPercent })}
                </Alert>
                <TextField
                  select
                  label={t('broadcast.testSplit')}
                  value={String(testSplitPercent)}
                  onChange={(event) => setTestSplitPercent(Number(event.target.value))}
                  size="small"
                  sx={{ maxWidth: 220 }}
                >
                  {[5, 10, 20, 30, 50].map((value) => (
                    <MenuItem key={value} value={String(value)}>
                      {value}%
                    </MenuItem>
                  ))}
                </TextField>
                {variants.map((variant, index) => (
                  <Stack
                    key={index}
                    spacing={1}
                    sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}
                  >
                    <Stack
                      direction="row"
                      sx={{
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Chip size="small" color="info" label={String.fromCharCode(65 + index)} />
                      <Stack direction="row" spacing={0.5}>
                        <Button
                          size="small"
                          startIcon={<ImageOutlinedIcon />}
                          onClick={() => setMediaPickerFor(index)}
                        >
                          {t('mediaLibrary.select')}
                        </Button>
                        {variants.length > 2 && (
                          <Button
                            size="small"
                            color="error"
                            onClick={() =>
                              setVariants((current) => current.filter((_, i) => i !== index))
                            }
                          >
                            {t('actions.delete')}
                          </Button>
                        )}
                      </Stack>
                    </Stack>
                    <TextField
                      label={t('broadcast.messageText')}
                      multiline
                      minRows={3}
                      value={variant.messageText}
                      onChange={(event) =>
                        setVariants((current) =>
                          current.map((item, i) =>
                            i === index ? { ...item, messageText: event.target.value } : item,
                          ),
                        )
                      }
                      helperText={t('broadcast.placeholdersHelp')}
                    />
                    <TextField
                      label={t('broadcast.photoUrl')}
                      value={variant.mediaUrl}
                      onChange={(event) =>
                        setVariants((current) =>
                          current.map((item, i) =>
                            i === index ? { ...item, mediaUrl: event.target.value } : item,
                          ),
                        )
                      }
                      size="small"
                    />
                  </Stack>
                ))}
                {variants.length < 3 && (
                  <Button
                    size="small"
                    onClick={() =>
                      setVariants((current) => [...current, { messageText: '', mediaUrl: '' }])
                    }
                  >
                    + {t('broadcast.addVariant')}
                  </Button>
                )}
              </>
            ) : (
              <>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{
                    alignItems: 'flex-start',
                  }}
                >
                  <TextField
                    label={t('broadcast.messageText')}
                    multiline
                    minRows={4}
                    value={messageText}
                    onChange={(event) => setMessageText(event.target.value)}
                    helperText={t('broadcast.placeholdersHelp')}
                    fullWidth
                  />
                  <Button
                    size="small"
                    sx={{ mt: 1 }}
                    onClick={() => setTranslateOpen(true)}
                    disabled={!messageText.trim()}
                  >
                    {t('translate.openButton')}
                  </Button>
                </Stack>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{
                    alignItems: 'center',
                  }}
                >
                  <TextField
                    label={t('broadcast.photoUrl')}
                    value={mediaUrl}
                    onChange={(event) => setMediaUrl(event.target.value)}
                    size="small"
                    fullWidth
                  />
                  <Button
                    size="small"
                    startIcon={<ImageOutlinedIcon />}
                    onClick={() => setMediaPickerFor('main')}
                    sx={{ mt: 0.5 }}
                  >
                    {t('mediaLibrary.select')}
                  </Button>
                </Stack>
              </>
            )}

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
                disabled={abMode ? false : messageText.trim().length === 0}
              >
                {abMode ? t('broadcast.queueAb') : t('broadcast.queue')}
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
          {historyError && (
            <Alert
              severity="error"
              sx={{ mb: 2 }}
              action={
                <Button color="inherit" size="small" onClick={reload}>
                  {t('actions.refresh')}
                </Button>
              }
            >
              {historyError}
            </Alert>
          )}
          <Stack spacing={2}>
            {historyLoading && rows === null ? (
              <LoadingState label={t('common.loading')} />
            ) : (
              <>
                {plainRows.map((row) => renderRow(row))}
                {[...experiments.entries()].map(([experimentId, experimentRows]) => {
                  const testRows = experimentRows.filter((row) => row.phase === 'test');
                  const allDone = testRows.every(
                    (row) => row.status === 'done' || row.status === 'failed',
                  );
                  return (
                    <Box key={experimentId}>
                      <Stack spacing={1}>
                        {experimentRows.map((row) =>
                          renderRow(row, row.variant_label ?? undefined),
                        )}
                      </Stack>
                      {testRows.length >= 2 && allDone && (
                        <>
                          <Divider sx={{ my: 1 }} />
                          <Button
                            size="small"
                            variant="contained"
                            color="secondary"
                            startIcon={<EmojiEventsIcon />}
                            onClick={() => chooseWinner(experimentId)}
                          >
                            {t('broadcast.chooseWinner')}
                          </Button>
                        </>
                      )}
                    </Box>
                  );
                })}
                {rows !== null && rows.length === 0 && (
                  <Typography
                    sx={{
                      color: 'text.secondary',
                    }}
                  >
                    {t('common.empty')}
                  </Typography>
                )}
              </>
            )}
          </Stack>
        </CardContent>
      </Card>

      {unsavedGuard}

      <MediaPicker
        botId={botId}
        open={mediaPickerFor !== null}
        onClose={() => setMediaPickerFor(null)}
        onSelect={(value) => {
          if (mediaPickerFor === 'main') setMediaUrl(value);
          else if (typeof mediaPickerFor === 'number') {
            setVariants((current) =>
              current.map((item, i) =>
                i === mediaPickerFor ? { ...item, mediaUrl: value } : item,
              ),
            );
          }
        }}
      />
      <AiTranslateDialog
        botId={botId}
        open={translateOpen}
        text={messageText}
        onClose={() => setTranslateOpen(false)}
        onApply={(text) => setMessageText(text)}
      />
    </Box>
  );
}
