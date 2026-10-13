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
import { apiFetch } from '../../services/api';
import PageHeader from '../../components/PageHeader';
import ModuleHelpDialog from '../../components/ModuleHelpDialog';
import ModuleConfigPage from '../ModuleConfigPage';
import { ConnectionMultiSelect, ConnectionSelect } from '../../components/ConnectionSelect';
import { LoadingState } from '../../components/Feedback';
import type { ModuleEntry } from '../../registry/modules';

/** Leaderboard period options shared by browsing, preview, and schedules. */
const PERIODS = ['daily', 'weekly', 'monthly', 'alltime'] as const;

/** Human labels for the period options. */
const PERIOD_LABELS: Record<(typeof PERIODS)[number], string> = {
  daily: 'Today',
  weekly: 'Last 7 days',
  monthly: 'Last 30 days',
  alltime: 'All time',
};

/** Recurrence options for schedules. */
const FREQUENCIES = ['once', 'hourly', 'daily', 'weekly'] as const;

/** Weekday labels indexed 0 (Sun) to 6 (Sat). */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Placeholders available in the message format editor. */
const SCORE_PLACEHOLDERS: Array<{ tag: string; description: string }> = [
  { tag: '{group_name}', description: 'Title of the target chat' },
  { tag: '{period_label}', description: 'Human label of the leaderboard period' },
  { tag: '{rank}', description: 'Position in the leaderboard (1-based)' },
  { tag: '{medal}', description: 'Medal emoji for the top three ranks' },
  { tag: '{mention}', description: 'Clickable mention link for the member' },
  { tag: '{name}', description: 'Member display name' },
  { tag: '{username}', description: 'Member @username without the @' },
  { tag: '{user_id}', description: 'Member numeric Telegram id' },
  { tag: '{score}', description: 'Weighted activity score' },
  { tag: '{messages}', description: 'Message count in the period' },
  { tag: '{replies}', description: 'Replies to others in the period' },
  { tag: '{media}', description: 'Media messages in the period' },
  { tag: '{bot_name}', description: 'Display name of the bot' },
  { tag: '{date}', description: 'Current date (ISO)' },
  { tag: '{time}', description: 'Current UTC time (HH:mm)' },
];

/** Default composer values shown on first load. */
const DEFAULT_COMPOSER = {
  chatIds: [] as string[],
  period: 'weekly',
  topLimit: 10,
  headerText: '🏆 <b>Most Active Members</b> — {group_name}\n<b>{period_label}</b>',
  rowTemplate: '{medal} {rank}. {mention} — <b>{score}</b> pts ({messages} msgs, {replies} replies)',
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
  id: number;
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
  botId: number;
  module: ModuleEntry;
}): React.ReactElement {
  const { t } = useTranslation();
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
  const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
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
        setStatus(`Leaderboard sent to ${ok}/${results.length} chat(s).`);
        if (failed.length > 0) {
          setError(failed.map((result) => `${result.chatId}: ${result.error}`).join(' · '));
        }
      })
      .catch((err: Error) => setError(err.message));
  }

  /**
   * Opens the schedule dialog for a new posting.
   * @returns {void}
   */
  function openCreateSchedule(): void {
    setEditingScheduleId(null);
    setDraft({ ...BLANK_DRAFT });
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
        setStatus(editingScheduleId ? 'Schedule updated.' : 'Schedule created.');
        loadSchedules();
      })
      .catch((err: Error) => setError(err.message));
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
        setStatus(`Schedule "${row.name}" dispatched.`);
        loadSchedules();
      })
      .catch((err: Error) => setError(err.message));
  }

  /**
   * Deletes a schedule after confirmation from the table icon.
   * @param {ScheduleRow} row - Schedule to delete.
   * @returns {void}
   */
  function deleteSchedule(row: ScheduleRow): void {
    apiFetch(`/api/bots/${botId}/message-score/schedules/${row.id}`, { method: 'DELETE' })
      .then(loadSchedules)
      .catch((err: Error) => setError(err.message));
  }

  const targetsSummary = useMemo(
    () => (chatIds: string[]): string => (chatIds.length <= 2 ? chatIds.join(', ') : `${chatIds.slice(0, 2).join(', ')} +${chatIds.length - 2}`),
    [],
  );

  return (
    <Box>
      <PageHeader
        title={module.name}
        subtitle={module.description}
        onDocs={() => setDocsOpen(true)}
      />

      {status && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setStatus(null)}>{status}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Stack spacing={3}>
        <ModuleConfigPage botId={botId} module={module} />

        <Card>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 2 }} component="h3">
              Live leaderboard
            </Typography>
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid size={{ xs: 12, md: 6 }}>
                <ConnectionSelect
                  label="Chat (empty = all chats)"
                  value={lbChat}
                  onChange={setLbChat}
                  types={['group', 'supergroup']}
                  helperText="Filter the ranking to one connected group"
                />
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <TextField
                  select
                  label="Period"
                  size="small"
                  fullWidth
                  value={lbPeriod}
                  onChange={(event) => setLbPeriod(normalizePeriod(event.target.value))}
                >
                  {PERIODS.map((period) => (
                    <MenuItem key={period} value={period}>
                      {PERIOD_LABELS[period]}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <TextField
                  select
                  label="Rows"
                  size="small"
                  fullWidth
                  value={String(lbLimit)}
                  onChange={(event) => setLbLimit(Number(event.target.value))}
                >
                  {[5, 10, 15, 20, 30].map((limit) => (
                    <MenuItem key={limit} value={String(limit)}>
                      Top {limit}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            </Grid>
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small" aria-label="Activity leaderboard">
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Member</TableCell>
                    <TableCell align="right">Messages</TableCell>
                    <TableCell align="right">Replies</TableCell>
                    <TableCell align="right">Media</TableCell>
                    <TableCell align="right">Score</TableCell>
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
                        <Typography variant="body2" fontWeight={700}>
                          {leader.score}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                  {leaders.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <Typography color="text.secondary" align="center" sx={{ py: 2 }}>
                          No activity recorded yet. Make sure the bot can see group messages
                          (admin rights or privacy mode disabled in BotFather).
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
              Post to groups
            </Typography>
            <Stack spacing={2.5}>
              <ConnectionMultiSelect
                label="Target chats (one or many)"
                value={composer.chatIds}
                onChange={(chatIds) => setComposerField('chatIds', chatIds)}
                types={['group', 'supergroup', 'channel']}
                helperText="Every selected chat receives the leaderboard; manage the list in Chat Connections"
              />
              <Grid container spacing={2}>
                <Grid size={{ xs: 6, md: 3 }}>
                  <TextField
                    select
                    label="Period"
                    size="small"
                    fullWidth
                    value={composer.period}
                    onChange={(event) => setComposerField('period', normalizePeriod(event.target.value))}
                  >
                    {PERIODS.map((period) => (
                      <MenuItem key={period} value={period}>
                        {PERIOD_LABELS[period]}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 6, md: 3 }}>
                  <TextField
                    select
                    label="Leaderboard size"
                    size="small"
                    fullWidth
                    value={String(composer.topLimit)}
                    onChange={(event) => setComposerField('topLimit', Number(event.target.value))}
                  >
                    {[3, 5, 10, 15, 20, 30].map((limit) => (
                      <MenuItem key={limit} value={String(limit)}>
                        Top {limit}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 6, md: 3 }}>
                  <TextField
                    select
                    label="Format"
                    size="small"
                    fullWidth
                    value={composer.parseMode}
                    onChange={(event) => setComposerField('parseMode', event.target.value)}
                    helperText="HTML recommended"
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
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="body2">Medal emojis</Typography>
                      <Switch
                        size="small"
                        checked={composer.medals}
                        onChange={(event) => setComposerField('medals', event.target.checked)}
                        inputProps={{ 'aria-label': 'Medal emojis' }}
                      />
                    </Stack>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="body2">Send silently</Typography>
                      <Switch
                        size="small"
                        checked={composer.disableNotification}
                        onChange={(event) => setComposerField('disableNotification', event.target.checked)}
                        inputProps={{ 'aria-label': 'Send silently' }}
                      />
                    </Stack>
                  </Stack>
                </Grid>
              </Grid>
              <TextField
                label="Header"
                size="small"
                fullWidth
                multiline
                minRows={2}
                value={composer.headerText}
                onChange={(event) => setComposerField('headerText', event.target.value)}
              />
              <TextField
                label="Member row template"
                size="small"
                fullWidth
                multiline
                minRows={2}
                value={composer.rowTemplate}
                onChange={(event) => setComposerField('rowTemplate', event.target.value)}
                helperText="Rendered once per ranked member"
              />
              <TextField
                label="Footer"
                size="small"
                fullWidth
                multiline
                minRows={2}
                value={composer.footerText}
                onChange={(event) => setComposerField('footerText', event.target.value)}
              />
              <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                {SCORE_PLACEHOLDERS.map((placeholder) => (
                  <Tooltip key={placeholder.tag} title={placeholder.description}>
                    <Chip size="small" label={placeholder.tag} variant="outlined" />
                  </Tooltip>
                ))}
              </Stack>
              <Divider />
              {previewError && <Alert severity="warning">{previewError}</Alert>}
              {composer.chatIds.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Select at least one target chat to see the live preview.
                </Typography>
              ) : (
                previews.map((preview) => (
                  <Box key={preview.chatId}>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
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
                  Send now
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<ScheduleIcon />}
                  onClick={openCreateSchedule}
                  disabled={composer.chatIds.length === 0}
                >
                  Save as schedule
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Typography variant="subtitle2" component="h3">
                Schedules
              </Typography>
              <Button size="small" startIcon={<AddIcon />} onClick={openCreateSchedule}>
                New schedule
              </Button>
            </Stack>
            {schedulesLoading ? (
              <LoadingState label={t('common.loading')} />
            ) : (
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small" aria-label="Leaderboard schedules">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Targets</TableCell>
                      <TableCell>Period</TableCell>
                      <TableCell>Recurrence</TableCell>
                      <TableCell>Next run (UTC)</TableCell>
                      <TableCell>Last result</TableCell>
                      <TableCell align="right">{t('common.actions')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {schedules.map((row) => {
                      const chatIds = parseChatIds(row.chat_ids_json);
                      return (
                        <TableRow key={row.id}>
                          <TableCell>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography variant="body2" fontWeight={600}>
                                {row.name}
                              </Typography>
                              <Chip
                                size="small"
                                color={row.status === 'active' ? 'success' : 'default'}
                                label={row.status}
                              />
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" noWrap sx={{ maxWidth: 220 }}>
                              {targetsSummary(chatIds)}
                            </Typography>
                          </TableCell>
                          <TableCell>{PERIOD_LABELS[normalizePeriod(row.period)]}</TableCell>
                          <TableCell>{recurrenceLabel(row)}</TableCell>
                          <TableCell>{row.status === 'active' ? row.run_at.replace('T', ' ').slice(0, 16) : '—'}</TableCell>
                          <TableCell>
                            <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 220, display: 'block' }}>
                              {row.last_result ?? 'Not run yet'}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Tooltip title="Run now">
                              <IconButton
                                size="small"
                                onClick={() => runSchedule(row)}
                                aria-label={`Run ${row.name}`}
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
                                onClick={() => deleteSchedule(row)}
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
                          <Typography color="text.secondary" align="center" sx={{ py: 2 }}>
                            No schedules yet. Compose the message above and press “Save as schedule”.
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
          {editingScheduleId ? 'Edit schedule' : 'New schedule'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Name"
              size="small"
              fullWidth
              value={draft?.name ?? ''}
              onChange={(event) => setDraft((current) => (current ? { ...current, name: event.target.value } : current))}
            />
            <TextField
              select
              label="Repeat"
              size="small"
              fullWidth
              value={draft?.frequency ?? 'daily'}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, frequency: normalizeFrequency(event.target.value) } : current,
                )
              }
            >
              {FREQUENCIES.map((frequency) => (
                <MenuItem key={frequency} value={frequency}>
                  {frequency === 'once'
                    ? 'Once (one-off)'
                    : frequency === 'hourly'
                      ? 'Every hour'
                      : frequency === 'daily'
                        ? 'Every day'
                        : 'Every week'}
                </MenuItem>
              ))}
            </TextField>
            {draft?.frequency === 'once' && (
              <TextField
                label="Dispatch at (local time)"
                size="small"
                fullWidth
                type="datetime-local"
                value={draft.runAt}
                onChange={(event) => setDraft((current) => (current ? { ...current, runAt: event.target.value } : current))}
                helperText="Converted to UTC for the dispatcher"
              />
            )}
            {(draft?.frequency === 'daily' || draft?.frequency === 'weekly') && (
              <TextField
                label="Time of day (UTC)"
                size="small"
                fullWidth
                type="time"
                value={draft?.timeOfDay ?? '18:00'}
                onChange={(event) =>
                  setDraft((current) => (current ? { ...current, timeOfDay: event.target.value } : current))
                }
              />
            )}
            {draft?.frequency === 'weekly' && (
              <TextField
                select
                label="Day of week"
                size="small"
                fullWidth
                value={String(draft.dayOfWeek)}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, dayOfWeek: Number(event.target.value) } : current,
                  )
                }
              >
                {WEEKDAYS.map((day, index) => (
                  <MenuItem key={day} value={String(index)}>
                    {day}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <Typography variant="caption" color="text.secondary">
              Targets and message format come from the composer above ({composer.chatIds.length} chat(s) selected).
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

      <ModuleHelpDialog module={docsOpen ? module : null} onClose={() => setDocsOpen(false)} />
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
 * Humanizes the recurrence of a schedule row.
 * @param {ScheduleRow} row - Schedule row.
 * @returns {string} Label such as `Every day at 18:00`.
 */
function recurrenceLabel(row: ScheduleRow): string {
  const frequency = normalizeFrequency(row.frequency);
  if (frequency === 'once') return `Once at ${row.run_at.replace('T', ' ').slice(0, 16)}`;
  if (frequency === 'hourly') return 'Every hour';
  const time = row.time_of_day ?? '18:00';
  if (frequency === 'daily') return `Every day at ${time}`;
  const day = WEEKDAYS[row.day_of_week ?? 1];
  return `Weekly on ${day} at ${time}`;
}
