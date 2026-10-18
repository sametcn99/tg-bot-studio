import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SendIcon from '@mui/icons-material/Send';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { apiFetch } from '../../services/api';
import PageHeader from '../../components/PageHeader';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useSnackbar } from '../../context/SnackbarContext';
import { useModuleDocs } from '../../context/ModuleDocsContext';
import ModuleConfigPage from '../ModuleConfigPage';
import { ConnectionMultiSelect, ConnectionSelect } from '../../components/ConnectionSelect';
import { LoadingState } from '../../components/Feedback';
import type { ModuleEntry } from '../../registry/modules';
import { formatDateTime } from '../../utils/format';
import { localizedErrorMessage } from '../../utils/errors';

/** Leaderboard period options shared by browsing, preview, and schedules. */
const PERIODS = ['daily', 'weekly', 'monthly', 'alltime'] as const;

/** Period label i18n keys keyed by period value. */
const PERIOD_LABEL_KEYS: Record<(typeof PERIODS)[number], string> = {
  daily: 'periodDaily',
  weekly: 'periodWeekly',
  monthly: 'periodMonthly',
  alltime: 'periodAlltime',
};

/** Recurrence options for schedules. */
const FREQUENCIES = ['once', 'hourly', 'daily', 'weekly'] as const;

/** Weekday label i18n keys indexed 0 (Sun) to 6 (Sat). */
const WEEKDAY_KEYS = [
  'daySunday',
  'dayMonday',
  'dayTuesday',
  'dayWednesday',
  'dayThursday',
  'dayFriday',
  'daySaturday',
] as const;

/** Placeholders available in the message format editor. */
const SCORE_PLACEHOLDERS: Array<{ tag: string; phKey: string }> = [
  { tag: '{group_name}', phKey: 'phGroupName' },
  { tag: '{period_label}', phKey: 'phPeriodLabel' },
  { tag: '{rank}', phKey: 'phRank' },
  { tag: '{medal}', phKey: 'phMedal' },
  { tag: '{mention}', phKey: 'phMention' },
  { tag: '{name}', phKey: 'phName' },
  { tag: '{username}', phKey: 'phUsername' },
  { tag: '{user_id}', phKey: 'phUserId' },
  { tag: '{score}', phKey: 'phScore' },
  { tag: '{messages}', phKey: 'phMessages' },
  { tag: '{replies}', phKey: 'phReplies' },
  { tag: '{media}', phKey: 'phMedia' },
  { tag: '{bot_name}', phKey: 'phBotName' },
  { tag: '{date}', phKey: 'phDate' },
  { tag: '{time}', phKey: 'phTime' },
];

/** Default composer values shown on first load. */
const DEFAULT_COMPOSER = {
  chatIds: [] as string[],
  period: 'weekly',
  topLimit: 10,
  headerText: '🏆 <b>Most Active Members</b> — {group_name}\n<b>{period_label}</b>',
  rowTemplate:
    '{medal} {rank}. {mention} — <b>{score}</b> pts ({messages} msgs, {replies} replies)',
  footerText: '💡 Keep chatting to climb the ranks!',
  parseMode: 'HTML',
  medals: true,
  disableNotification: false,
};

type ComposerState = typeof DEFAULT_COMPOSER;

/**
 * Leaderboard row from `GET /api/bots/:id/message-score/leaderboard`.
 * @interface LeaderRow
 */
interface LeaderRow {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  messages: number;
  replies: number;
  media: number;
  score: number;
}

/**
 * Schedule row from the schedules CRUD endpoints.
 * @interface ScheduleRow
 */
interface ScheduleRow {
  id: string;
  name: string;
  chat_ids_json: string;
  period: string;
  frequency: string;
  time_of_day: string | null;
  day_of_week: number | null;
  run_at: string;
  top_limit: number;
  header_text: string | null;
  row_template: string | null;
  footer_text: string | null;
  parse_mode: string | null;
  medals: number;
  disable_notification: number;
  status: string;
  last_run_at: string | null;
  last_result: string | null;
}

/**
 * Server-rendered preview for one target chat.
 * @interface PreviewRow
 */
interface PreviewRow {
  chatId: string;
  title: string;
  text: string;
}

/**
 * Recurrence fields collected by the schedule dialog.
 * @interface ScheduleDraft
 */
interface ScheduleDraft {
  name: string;
  frequency: (typeof FREQUENCIES)[number];
  timeOfDay: string;
  dayOfWeek: number;
  runAt: string;
}

/** Blank recurrence draft. */
const BLANK_DRAFT: ScheduleDraft = {
  name: 'Activity leaderboard',
  frequency: 'daily',
  timeOfDay: '18:00',
  dayOfWeek: 1,
  runAt: '',
};

/**
 * Message Score & Activity Leaderboard page: live leaderboard, rich message
 * composer with live preview, one-off sends, and recurring schedules.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {ModuleEntry} props.module - Message score catalog entry.
 * @returns {React.ReactElement} The page.
 */
export default function MessageScorePage({
  botId,
  module,
}: {
  botId: string;
  module: ModuleEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);
  const [lbChat, setLbChat] = useState('');
  const [lbPeriod, setLbPeriod] = useState<(typeof PERIODS)[number]>('weekly');
  const [lbLimit, setLbLimit] = useState(10);
  const [composer, setComposer] = useState<ComposerState>(DEFAULT_COMPOSER);
  const [previews, setPreviews] = useState<PreviewRow[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(true);
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [scheduleToDelete, setScheduleToDelete] = useState<ScheduleRow | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { openDocs } = useModuleDocs();
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Loads the schedules table.
   * @returns {void}
   */
  const loadSchedules = useCallback((): void => {
    apiFetch<ScheduleRow[]>(`/api/bots/${botId}/message-score/schedules`)
      .then((rows) => {
        setSchedules(rows);
        setSchedulesLoading(false);
      })
      .catch(() => setSchedulesLoading(false));
  }, [botId]);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  useEffect(() => {
    const params = new URLSearchParams({
      period: lbPeriod,
      limit: String(lbLimit),
    });
    if (lbChat) params.set('chatId', lbChat);
    apiFetch<LeaderRow[]>(`/api/bots/${botId}/message-score/leaderboard?${params.toString()}`)
      .then(setLeaders)
      .catch(() => setLeaders([]));
  }, [botId, lbChat, lbPeriod, lbLimit]);

  /**
   * Requests a fresh server-rendered preview for the current composer.
   * @returns {void}
   */
  const refreshPreview = useCallback((): void => {
    if (composer.chatIds.length === 0) {
      setPreviews([]);
      setPreviewError(null);
      return;
    }
    apiFetch<PreviewRow[]>(`/api/bots/${botId}/message-score/preview`, {
      method: 'POST',
      body: JSON.stringify(composer),
    })
      .then((rows) => {
        setPreviews(rows);
        setPreviewError(null);
      })
      .catch((err: Error) => {
        setPreviews([]);
        setPreviewError(err.message);
      });
  }, [botId, composer]);

  // Debounced live preview while the format editor changes.
  useEffect(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(refreshPreview, 600);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [refreshPreview]);

  /**
   * Updates one composer field.
   * @param {keyof ComposerState} key - Composer key.
   * @param {unknown} value - New value.
   * @returns {void}
   */
  function setComposerField(key: keyof ComposerState, value: unknown): void {
    setComposer((current) => ({ ...current, [key]: value }));
  }

  /**
   * Sends the composed leaderboard to all selected chats immediately.
   * @returns {void}
   */
  function sendNow(): void {
    setError(null);
    setStatus(null);
    apiFetch<Array<{ chatId: string; ok: boolean; error?: string }>>(
      `/api/bots/${botId}/message-score/send`,
      { method: 'POST', body: JSON.stringify(composer) },
    )
      .then((results) => {
        const ok = results.filter((result) => result.ok).length;
        const failed = results.filter((result) => !result.ok);
        setStatus(t('messageScore.sent', { sent: ok, total: results.length }));
        if (failed.length > 0) {
          setError(failed.map((result) => `${result.chatId}: ${result.error}`).join(' · '));
        }
      })
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }

  /**
   * Opens the schedule dialog for a new posting.
   * @returns {void}
   */
  function openCreateSchedule(): void {
    setEditingScheduleId(null);
    setDraft({ ...BLANK_DRAFT, name: t('messageScore.defaultScheduleName') });
  }

  /**
   * Opens the schedule dialog seeded from an existing row; the composer
   * carries targets and formatting so edits apply to both.
   * @param {ScheduleRow} row - Schedule being edited.
   * @returns {void}
   */
  function openEditSchedule(row: ScheduleRow): void {
    setEditingScheduleId(row.id);
    setComposer({
      chatIds: parseChatIds(row.chat_ids_json),
      period: normalizePeriod(row.period),
      topLimit: row.top_limit,
      headerText: row.header_text ?? DEFAULT_COMPOSER.headerText,
      rowTemplate: row.row_template ?? DEFAULT_COMPOSER.rowTemplate,
      footerText: row.footer_text ?? DEFAULT_COMPOSER.footerText,
      parseMode: row.parse_mode ?? 'HTML',
      medals: Boolean(row.medals),
      disableNotification: Boolean(row.disable_notification),
    });
    setDraft({
      name: row.name,
      frequency: normalizeFrequency(row.frequency),
      timeOfDay: row.time_of_day ?? '18:00',
      dayOfWeek: row.day_of_week ?? 1,
      runAt: row.frequency === 'once' ? toLocalInput(row.run_at) : '',
    });
  }

  /**
   * Creates or updates the schedule from the composer plus dialog fields.
   * @returns {void}
   */
  function saveSchedule(): void {
    if (!draft) return;
    setError(null);
    setStatus(null);
    const payload = { ...composer, ...draft };
    const url = editingScheduleId
      ? `/api/bots/${botId}/message-score/schedules/${editingScheduleId}`
      : `/api/bots/${botId}/message-score/schedules`;
    apiFetch(url, { method: editingScheduleId ? 'PATCH' : 'POST', body: JSON.stringify(payload) })
      .then(() => {
        setDraft(null);
        setEditingScheduleId(null);
        const msg = editingScheduleId
          ? t('messageScore.scheduleUpdated')
          : t('messageScore.scheduleCreated');
        setStatus(msg);
        showSuccess(msg);
        loadSchedules();
      })
      .catch((err: Error) => {
        setError(localizedErrorMessage(err));
        showError(localizedErrorMessage(err));
      });
  }

  /**
   * Dispatches a schedule immediately.
   * @param {ScheduleRow} row - Schedule to run.
   * @returns {void}
   */
  function runSchedule(row: ScheduleRow): void {
    setError(null);
    setStatus(null);
    apiFetch(`/api/bots/${botId}/message-score/schedules/${row.id}/run`, { method: 'POST' })
      .then(() => {
        const msg = t('messageScore.scheduleDispatched', { name: row.name });
        setStatus(msg);
        showSuccess(msg);
        loadSchedules();
      })
      .catch((err: Error) => {
        setError(localizedErrorMessage(err));
        showError(localizedErrorMessage(err));
      });
  }

  /**
   * Confirms and deletes a schedule.
   * @returns {void}
   */
  function handleDeleteSchedule(): void {
    if (!scheduleToDelete) return;
    const target = scheduleToDelete;
    apiFetch(`/api/bots/${botId}/message-score/schedules/${target.id}`, { method: 'DELETE' })
      .then(() => {
        showSuccess(t('messageScore.scheduleDeleted', { name: target.name }));
        setScheduleToDelete(null);
        loadSchedules();
      })
      .catch((err: Error) => {
        setError(localizedErrorMessage(err));
        showError(localizedErrorMessage(err));
      });
  }

  const targetsSummary = useMemo(
    () =>
      (chatIds: string[]): string =>
        chatIds.length <= 2
          ? chatIds.join(', ')
          : `${chatIds.slice(0, 2).join(', ')} +${chatIds.length - 2}`,
    [],
  );

  return (
    <Box>
      <PageHeader
        title={module.name}
        subtitle={module.description}
        onDocs={() => openDocs(module)}
      />

      {status && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setStatus(null)}>
          {status}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack spacing={3}>
        <ModuleConfigPage botId={botId} module={module} embedded={true} />

        <Card>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 2 }} component="h3">
              {t('messageScore.liveLeaderboard')}
            </Typography>
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid size={{ xs: 12, md: 6 }}>
                <ConnectionSelect
                  label={t('messageScore.chatFilterLabel')}
                  value={lbChat}
                  onChange={setLbChat}
                  types={['group', 'supergroup']}
                  helperText={t('messageScore.chatFilterHelp')}
                />
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <TextField
                  select
                  label={t('messageScore.period')}
                  size="small"
                  fullWidth
                  value={lbPeriod}
                  onChange={(event) => setLbPeriod(normalizePeriod(event.target.value))}
                >
                  {PERIODS.map((period) => (
                    <MenuItem key={period} value={period}>
                      {periodLabel(period, t)}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <TextField
                  select
                  label={t('messageScore.rows')}
                  size="small"
                  fullWidth
                  value={String(lbLimit)}
                  onChange={(event) => setLbLimit(Number(event.target.value))}
                >
                  {[5, 10, 15, 20, 30].map((limit) => (
                    <MenuItem key={limit} value={String(limit)}>
                      {t('messageScore.topN', { count: limit })}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            </Grid>
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small" aria-label={t('messageScore.leaderboardAria')}>
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>{t('messageScore.member')}</TableCell>
                    <TableCell align="right">{t('messageScore.messages')}</TableCell>
                    <TableCell align="right">{t('messageScore.replies')}</TableCell>
                    <TableCell align="right">{t('messageScore.media')}</TableCell>
                    <TableCell align="right">{t('messageScore.score')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {leaders.map((leader, index) => (
                    <TableRow key={leader.telegram_id}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell>
                        {leader.username
                          ? `@${leader.username}`
                          : (leader.first_name ?? String(leader.telegram_id))}
                      </TableCell>
                      <TableCell align="right">{leader.messages}</TableCell>
                      <TableCell align="right">{leader.replies}</TableCell>
                      <TableCell align="right">{leader.media}</TableCell>
                      <TableCell align="right">
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 700,
                          }}
                        >
                          {leader.score}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                  {leaders.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <Typography
                          align="center"
                          sx={{
                            color: 'text.secondary',
                            py: 2,
                          }}
                        >
                          {t('messageScore.noActivity')}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 2 }} component="h3">
              {t('messageScore.postToGroups')}
            </Typography>
            <Stack spacing={2.5}>
              <ConnectionMultiSelect
                label={t('messageScore.targetChats')}
                value={composer.chatIds}
                onChange={(chatIds) => setComposerField('chatIds', chatIds)}
                types={['group', 'supergroup', 'channel']}
                helperText={t('messageScore.targetChatsHelp')}
              />
              <Grid container spacing={2}>
                <Grid size={{ xs: 6, md: 3 }}>
                  <TextField
                    select
                    label={t('messageScore.period')}
                    size="small"
                    fullWidth
                    value={composer.period}
                    onChange={(event) =>
                      setComposerField('period', normalizePeriod(event.target.value))
                    }
                  >
                    {PERIODS.map((period) => (
                      <MenuItem key={period} value={period}>
                        {periodLabel(period, t)}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 6, md: 3 }}>
                  <TextField
                    select
                    label={t('messageScore.leaderboardSize')}
                    size="small"
                    fullWidth
                    value={String(composer.topLimit)}
                    onChange={(event) => setComposerField('topLimit', Number(event.target.value))}
                  >
                    {[3, 5, 10, 15, 20, 30].map((limit) => (
                      <MenuItem key={limit} value={String(limit)}>
                        {t('messageScore.topN', { count: limit })}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 6, md: 3 }}>
                  <TextField
                    select
                    label={t('messageScore.format')}
                    size="small"
                    fullWidth
                    value={composer.parseMode}
                    onChange={(event) => setComposerField('parseMode', event.target.value)}
                    helperText={t('messageScore.formatHelp')}
                  >
                    {['HTML', 'Markdown', 'None'].map((mode) => (
                      <MenuItem key={mode} value={mode}>
                        {mode}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 6, md: 3 }}>
                  <Stack spacing={0.5}>
                    <Stack
                      direction="row"
                      sx={{
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Typography variant="body2">{t('messageScore.medalEmojis')}</Typography>
                      <Switch
                        size="small"
                        checked={composer.medals}
                        onChange={(event) => setComposerField('medals', event.target.checked)}
                        slotProps={{
                          input: { 'aria-label': t('messageScore.medalEmojis') },
                        }}
                      />
                    </Stack>
                    <Stack
                      direction="row"
                      sx={{
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Typography variant="body2">{t('messageScore.sendSilently')}</Typography>
                      <Switch
                        size="small"
                        checked={composer.disableNotification}
                        onChange={(event) =>
                          setComposerField('disableNotification', event.target.checked)
                        }
                        slotProps={{
                          input: { 'aria-label': t('messageScore.sendSilently') },
                        }}
                      />
                    </Stack>
                  </Stack>
                </Grid>
              </Grid>
              <TextField
                label={t('messageScore.header')}
                size="small"
                fullWidth
                multiline
                minRows={2}
                value={composer.headerText}
                onChange={(event) => setComposerField('headerText', event.target.value)}
              />
              <TextField
                label={t('messageScore.rowTemplate')}
                size="small"
                fullWidth
                multiline
                minRows={2}
                value={composer.rowTemplate}
                onChange={(event) => setComposerField('rowTemplate', event.target.value)}
                helperText={t('messageScore.rowTemplateHelp')}
              />
              <TextField
                label={t('messageScore.footer')}
                size="small"
                fullWidth
                multiline
                minRows={2}
                value={composer.footerText}
                onChange={(event) => setComposerField('footerText', event.target.value)}
              />
              <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                {SCORE_PLACEHOLDERS.map((placeholder) => (
                  <Tooltip key={placeholder.tag} title={t(`messageScore.${placeholder.phKey}`)}>
                    <Chip size="small" label={placeholder.tag} variant="outlined" />
                  </Tooltip>
                ))}
              </Stack>
              <Divider />
              {previewError && <Alert severity="warning">{previewError}</Alert>}
              {composer.chatIds.length === 0 ? (
                <Typography
                  variant="body2"
                  sx={{
                    color: 'text.secondary',
                  }}
                >
                  {t('messageScore.previewHint')}
                </Typography>
              ) : (
                previews.map((preview) => (
                  <Box key={preview.chatId}>
                    <Typography
                      variant="caption"
                      sx={{
                        color: 'text.secondary',
                        mb: 0.5,
                        display: 'block',
                      }}
                    >
                      {preview.title} · {preview.chatId}
                    </Typography>
                    <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'action.hover' }}>
                      <Typography
                        component="pre"
                        sx={{
                          m: 0,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          fontFamily: 'monospace',
                          fontSize: 13,
                        }}
                      >
                        {preview.text}
                      </Typography>
                    </Paper>
                  </Box>
                ))
              )}
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  startIcon={<SendIcon />}
                  onClick={sendNow}
                  disabled={composer.chatIds.length === 0}
                >
                  {t('messageScore.sendNow')}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<ScheduleIcon />}
                  onClick={openCreateSchedule}
                  disabled={composer.chatIds.length === 0}
                >
                  {t('messageScore.saveAsSchedule')}
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Stack
              direction="row"
              sx={{
                justifyContent: 'space-between',
                alignItems: 'center',
                mb: 2,
              }}
            >
              <Typography variant="subtitle2" component="h3">
                {t('messageScore.schedules')}
              </Typography>
              <Button size="small" startIcon={<AddIcon />} onClick={openCreateSchedule}>
                {t('messageScore.newSchedule')}
              </Button>
            </Stack>
            {schedulesLoading ? (
              <LoadingState label={t('common.loading')} />
            ) : (
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small" aria-label={t('messageScore.schedulesAria')}>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('common.name')}</TableCell>
                      <TableCell>{t('messageScore.targets')}</TableCell>
                      <TableCell>{t('messageScore.period')}</TableCell>
                      <TableCell>{t('messageScore.recurrence')}</TableCell>
                      <TableCell>{t('messageScore.nextRun')}</TableCell>
                      <TableCell>{t('messageScore.lastResult')}</TableCell>
                      <TableCell align="right">{t('common.actions')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {schedules.map((row) => {
                      const chatIds = parseChatIds(row.chat_ids_json);
                      return (
                        <TableRow key={row.id}>
                          <TableCell>
                            <Stack
                              direction="row"
                              spacing={1}
                              sx={{
                                alignItems: 'center',
                              }}
                            >
                              <Typography
                                variant="body2"
                                sx={{
                                  fontWeight: 600,
                                }}
                              >
                                {row.name}
                              </Typography>
                              <Chip
                                size="small"
                                color={row.status === 'active' ? 'success' : 'default'}
                                label={
                                  row.status === 'active'
                                    ? t('status.active')
                                    : row.status === 'done'
                                      ? t('status.done')
                                      : row.status
                                }
                              />
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" noWrap sx={{ maxWidth: 220 }}>
                              {targetsSummary(chatIds)}
                            </Typography>
                          </TableCell>
                          <TableCell>{periodLabel(normalizePeriod(row.period), t)}</TableCell>
                          <TableCell>{recurrenceLabel(row, t)}</TableCell>
                          <TableCell>
                            {row.status === 'active' ? formatDateTime(row.run_at) : '—'}
                          </TableCell>
                          <TableCell>
                            <Typography
                              variant="caption"
                              noWrap
                              sx={{
                                color: 'text.secondary',
                                maxWidth: 220,
                                display: 'block',
                              }}
                            >
                              {row.last_result ?? t('messageScore.notRunYet')}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Tooltip title={t('messageScore.runNow')}>
                              <IconButton
                                size="small"
                                onClick={() => runSchedule(row)}
                                aria-label={t('messageScore.runScheduleAria', { name: row.name })}
                              >
                                <PlayArrowIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title={t('actions.edit')}>
                              <IconButton
                                size="small"
                                onClick={() => openEditSchedule(row)}
                                aria-label={`${t('actions.edit')} ${row.name}`}
                              >
                                <EditIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title={t('actions.delete')}>
                              <IconButton
                                size="small"
                                onClick={() => setScheduleToDelete(row)}
                                aria-label={`${t('actions.delete')} ${row.name}`}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {schedules.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <Typography
                            align="center"
                            sx={{
                              color: 'text.secondary',
                              py: 2,
                            }}
                          >
                            {t('messageScore.noSchedules')}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>
      </Stack>

      <Dialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        maxWidth="sm"
        fullWidth
        aria-labelledby="score-schedule-dialog-title"
      >
        <DialogTitle id="score-schedule-dialog-title">
          {editingScheduleId ? t('messageScore.editSchedule') : t('messageScore.newSchedule')}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label={t('common.name')}
              size="small"
              fullWidth
              value={draft?.name ?? ''}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, name: event.target.value } : current,
                )
              }
            />
            <TextField
              select
              label={t('messageScore.repeat')}
              size="small"
              fullWidth
              value={draft?.frequency ?? 'daily'}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? { ...current, frequency: normalizeFrequency(event.target.value) }
                    : current,
                )
              }
            >
              {FREQUENCIES.map((frequency) => (
                <MenuItem key={frequency} value={frequency}>
                  {frequency === 'once'
                    ? t('messageScore.freqOnce')
                    : frequency === 'hourly'
                      ? t('messageScore.freqHourly')
                      : frequency === 'daily'
                        ? t('messageScore.freqDaily')
                        : t('messageScore.freqWeekly')}
                </MenuItem>
              ))}
            </TextField>
            {draft?.frequency === 'once' && (
              <TextField
                label={t('messageScore.dispatchAt')}
                size="small"
                fullWidth
                type="datetime-local"
                value={draft.runAt}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, runAt: event.target.value } : current,
                  )
                }
                helperText={t('messageScore.dispatchAtHelp')}
              />
            )}
            {(draft?.frequency === 'daily' || draft?.frequency === 'weekly') && (
              <TextField
                label={t('messageScore.timeOfDay')}
                size="small"
                fullWidth
                type="time"
                value={draft?.timeOfDay ?? '18:00'}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, timeOfDay: event.target.value } : current,
                  )
                }
              />
            )}
            {draft?.frequency === 'weekly' && (
              <TextField
                select
                label={t('messageScore.dayOfWeek')}
                size="small"
                fullWidth
                value={String(draft.dayOfWeek)}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, dayOfWeek: Number(event.target.value) } : current,
                  )
                }
              >
                {WEEKDAY_KEYS.map((day, index) => (
                  <MenuItem key={day} value={String(index)}>
                    {weekdayLabel(index, t)}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <Typography
              variant="caption"
              sx={{
                color: 'text.secondary',
              }}
            >
              {t('messageScore.targetsFromComposer', { count: composer.chatIds.length })}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{t('actions.cancel')}</Button>
          <Button variant="contained" onClick={saveSchedule} disabled={!draft?.name.trim()}>
            {t('actions.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(scheduleToDelete)}
        title={t('actions.delete')}
        message={t('messageScore.deleteScheduleConfirm', { name: scheduleToDelete?.name ?? '' })}
        onConfirm={handleDeleteSchedule}
        onCancel={() => setScheduleToDelete(null)}
      />
    </Box>
  );
}

/**
 * Parses the stored chat id JSON of a schedule row.
 * @param {string} json - Stored JSON array.
 * @returns {string[]} Chat ids.
 */
function parseChatIds(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
  } catch {
    return [];
  }
}

/**
 * Normalizes a raw period value.
 * @param {string} value - Raw period.
 * @returns {(typeof PERIODS)[number]} Valid period.
 */
function normalizePeriod(value: string): (typeof PERIODS)[number] {
  return (PERIODS as readonly string[]).includes(value)
    ? (value as (typeof PERIODS)[number])
    : 'weekly';
}

/**
 * Normalizes a raw frequency value.
 * @param {string} value - Raw frequency.
 * @returns {(typeof FREQUENCIES)[number]} Valid frequency.
 */
function normalizeFrequency(value: string): (typeof FREQUENCIES)[number] {
  return (FREQUENCIES as readonly string[]).includes(value)
    ? (value as (typeof FREQUENCIES)[number])
    : 'weekly';
}

/**
 * Converts an ISO timestamp into the local datetime-local input format.
 * @param {string} iso - ISO timestamp.
 * @returns {string} Local input value (YYYY-MM-DDTHH:mm).
 */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * Localized human label for a leaderboard period.
 * @param {string} period - Raw period value.
 * @param {TFunction} t - i18next translator.
 * @returns {string} Label such as `Last 7 days`.
 */
function periodLabel(period: string, t: TFunction): string {
  const key = PERIOD_LABEL_KEYS[period as (typeof PERIODS)[number]] ?? PERIOD_LABEL_KEYS.weekly;
  return t(`messageScore.${key}`);
}

/**
 * Localized weekday label.
 * @param {number} index - Weekday index, 0 (Sun) to 6 (Sat).
 * @param {TFunction} t - i18next translator.
 * @returns {string} Weekday name.
 */
function weekdayLabel(index: number, t: TFunction): string {
  return t(`messageScore.${WEEKDAY_KEYS[index] ?? WEEKDAY_KEYS[1]}`);
}

/**
 * Humanizes the recurrence of a schedule row.
 * @param {ScheduleRow} row - Schedule row.
 * @param {TFunction} t - i18next translator.
 * @returns {string} Label such as `Every day at 18:00`.
 */
function recurrenceLabel(row: ScheduleRow, t: TFunction): string {
  const frequency = normalizeFrequency(row.frequency);
  if (frequency === 'once') return t('messageScore.onceAt', { time: formatDateTime(row.run_at) });
  if (frequency === 'hourly') return t('messageScore.freqHourly');
  const time = row.time_of_day ?? '18:00';
  if (frequency === 'daily') return t('messageScore.dailyAt', { time });
  const day = weekdayLabel(row.day_of_week ?? 1, t);
  return t('messageScore.weeklyOn', { day, time });
}
