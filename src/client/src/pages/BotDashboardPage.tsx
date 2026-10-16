import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  Link,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import { useApi } from '../hooks/useApi';
import { useBots } from '../context/BotContext';
import { useSnackbar } from '../context/SnackbarContext';
import StatusDot from '../components/StatusDot';
import PageHeader from '../components/PageHeader';
import { LoadingState } from '../components/Feedback';
import BotDiagnosticsDialog from '../components/BotDiagnosticsDialog';
import BotPresetsDialog from '../components/BotPresetsDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import AnalyticsCard from '../components/AnalyticsCard';
import HealthAlertsCard from '../components/HealthAlertsCard';
import TemplateGalleryDialog, { SaveTemplateDialog } from '../components/TemplateGalleryDialog';
import { MODULES } from '../registry/modules';
import { localizedErrorMessage } from '../utils/errors';

/** Curated IANA zones offered for bot-level scheduling. */
const TIMEZONE_OPTIONS = [
  'UTC',
  'Europe/Istanbul',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Tbilisi',
  'Asia/Singapore',
  'Asia/Tokyo',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
];

/**
 * Contextual bot dashboard: key audience and runtime metrics for the active
 * bot plus diagnostics, cloning, import/export, and starter presets.
 */
export default function BotDashboardPage(): React.ReactElement {
  const { t } = useTranslation();
  const { botId } = useParams<{ botId: string }>();
  const navigate = useNavigate();
  const {
    bots,
    activeBot,
    setActiveBotId,
    refresh,
    loading: botsLoading,
    error: botsError,
  } = useBots();
  const { showSuccess, showError } = useSnackbar();

  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);

  // Clone dialog state
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneToken, setCloneToken] = useState('');
  const [cloneBusy, setCloneBusy] = useState(false);

  // Bot operational settings (IANA timezone for scheduled jobs)
  const [timezone, setTimezone] = useState<string>('UTC');

  // File import ref
  const importFileRef = useRef<HTMLInputElement | null>(null);

  const bot = bots.find((entry) => entry.id === Number(botId)) ?? activeBot;

  const {
    data: securityPosture,
    error: securityError,
    reload: reloadSecurity,
  } = useApi<{
    isDefaultMasterKey: boolean;
    isDefaultJwtSecret: boolean;
  }>('/api/auth/security-status', []);

  const botIdNumber = bot?.id;
  const { data: botSettings } = useApi<{ timezone: string }>(
    botIdNumber ? `/api/bots/${botIdNumber}/settings` : null,
    [botIdNumber],
  );

  useEffect(() => {
    if (botSettings) setTimezone(botSettings.timezone || 'UTC');
  }, [botSettings]);

  /**
   * Persists the bot time zone used by scheduled jobs (leaderboards etc.).
   * @param {string} zone - IANA zone name.
   * @returns {void}
   */
  function handleTimezoneChange(zone: string): void {
    setTimezone(zone);
    apiFetch(`/api/bots/${currentBot.id}/settings`, {
      method: 'PATCH',
      body: JSON.stringify({ timezone: zone }),
    })
      .then(() => showSuccess(t('bots.timezoneSaved')))
      .catch((err: Error) => showError(localizedErrorMessage(err)));
  }

  useEffect(() => {
    if (bot && activeBot?.id !== bot.id) {
      setActiveBotId(bot.id);
    }
  }, [bot, activeBot, setActiveBotId]);

  if (!bot) {
    // Deep link before the bot list resolved: show a loading state instead of
    // the ambiguous "empty" state; on failure offer a retry.
    return (
      <Box>
        <PageHeader title={t('nav.botDashboard')} />
        {botsLoading ? (
          <LoadingState label={t('common.loading')} />
        ) : botsError ? (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={refresh}>
                {t('actions.refresh')}
              </Button>
            }
          >
            {botsError}
          </Alert>
        ) : (
          <Typography color="text.secondary">{t('common.empty')}</Typography>
        )}
      </Box>
    );
  }
  const currentBot = bot;

  const isInsecureUrl =
    typeof window !== 'undefined' &&
    window.location.protocol === 'http:' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1';

  const stats = [
    { label: t('bots.subscribers'), value: bot.subscribers },
    { label: t('bots.activeModules'), value: bot.activeModules },
    { label: t('bots.miniApps'), value: bot.miniApps },
    { label: t('bots.volume24h'), value: bot.dailyVolume },
  ];

  function toggleActive(active: boolean): void {
    void apiFetch(`/api/bots/${currentBot.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: active }),
    })
      .then(() => {
        showSuccess(active ? t('bots.activated') : t('bots.paused'));
        refresh();
      })
      .catch((err: Error) => showError(localizedErrorMessage(err)));
  }

  function handleDeleteBot(): void {
    apiFetch(`/api/bots/${currentBot.id}`, { method: 'DELETE' })
      .then(() => {
        showSuccess(t('bots.deleted', { name: currentBot.name }));
        setDeleteConfirmOpen(false);
        refresh();
        navigate('/');
      })
      .catch((err: Error) => showError(localizedErrorMessage(err)));
  }

  function handleOpenClone(): void {
    setCloneName(`${currentBot.name} (Clone)`);
    setCloneToken('');
    setCloneOpen(true);
  }

  function handleCloneSubmit(): void {
    if (!cloneToken.trim()) return;
    setCloneBusy(true);
    apiFetch(`/api/bots/${currentBot.id}/clone`, {
      method: 'POST',
      body: JSON.stringify({ name: cloneName, token: cloneToken.trim() }),
    })
      .then((created: any) => {
        showSuccess(t('bots.cloned', { name: created.name }));
        setCloneOpen(false);
        refresh();
        if (created.id) navigate(`/bots/${created.id}`);
      })
      .catch((err: Error) => showError(localizedErrorMessage(err)))
      .finally(() => setCloneBusy(false));
  }

  function handleExportConfig(): void {
    apiFetch(`/api/bots/${currentBot.id}/export`)
      .then((data: any) => {
        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bot_${currentBot.id}_config.json`;
        a.click();
        URL.revokeObjectURL(url);
        showSuccess(t('bots.exported'));
      })
      .catch((err: Error) => showError(localizedErrorMessage(err)));
  }

  function handleImportFile(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const bundle = JSON.parse(String(e.target?.result));
        apiFetch(`/api/bots/${currentBot.id}/import`, {
          method: 'POST',
          body: JSON.stringify(bundle),
        })
          .then((res: any) => {
            showSuccess(t('bots.imported', { count: res.importedModules ?? 0 }));
            refresh();
          })
          .catch((err: Error) => showError(localizedErrorMessage(err)));
      } catch {
        showError(t('bots.invalidImportFile'));
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  return (
    <Box>
      {isInsecureUrl && (
        <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 2 }}>
          {t('bots.insecureHttp')}
        </Alert>
      )}

      {securityError && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={reloadSecurity}>
              {t('actions.refresh')}
            </Button>
          }
        >
          {securityError}
        </Alert>
      )}

      {securityPosture?.isDefaultMasterKey && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t('bots.defaultKeyWarning')}
        </Alert>
      )}

      {securityPosture?.isDefaultJwtSecret && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('bots.defaultJwtWarning')}
        </Alert>
      )}

      <PageHeader
        title={bot.name}
        subtitle={bot.username ? `@${bot.username}` : `ID ${bot.id}`}
        actions={
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<HealthAndSafetyIcon />}
              onClick={() => setDiagnosticsOpen(true)}
            >
              {t('nav.diagnostics')}
            </Button>
            <Button
              variant="contained"
              size="small"
              color="secondary"
              startIcon={<AutoFixHighIcon />}
              onClick={() => setPresetsOpen(true)}
            >
              {t('actions.applyPreset')}
            </Button>
            <Tooltip title={t('templates.galleryTooltip')}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<DashboardCustomizeIcon />}
                onClick={() => setGalleryOpen(true)}
              >
                {t('templates.gallery')}
              </Button>
            </Tooltip>
            <Tooltip title={t('bots.cloneTooltip')}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<ContentCopyIcon />}
                onClick={handleOpenClone}
              >
                {t('bots.clone')}
              </Button>
            </Tooltip>
            <Tooltip title={t('bots.exportTooltip')}>
              <IconButton
                size="small"
                onClick={handleExportConfig}
                aria-label={t('bots.exportAria')}
              >
                <FileDownloadIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('templates.saveTooltip')}>
              <IconButton
                size="small"
                onClick={() => setSaveTemplateOpen(true)}
                aria-label={t('templates.save')}
              >
                <BookmarkAddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('bots.importTooltip')}>
              <IconButton
                size="small"
                onClick={() => importFileRef.current?.click()}
                aria-label={t('bots.importAria')}
              >
                <FileUploadIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <input
              type="file"
              ref={importFileRef}
              onChange={handleImportFile}
              accept=".json"
              style={{ display: 'none' }}
            />
            <Tooltip title={t('bots.deleteTooltip')}>
              <IconButton
                size="small"
                color="error"
                onClick={() => setDeleteConfirmOpen(true)}
                aria-label={t('bots.deleteAria')}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('bots.timezoneLabel')}>
              <TextField
                select
                size="small"
                value={timezone}
                onChange={(event) => handleTimezoneChange(event.target.value)}
                label={t('bots.timezoneLabel')}
                sx={{ minWidth: 170, maxWidth: 220 }}
              >
                {TIMEZONE_OPTIONS.map((zone) => (
                  <MenuItem key={zone} value={zone}>
                    {zone}
                  </MenuItem>
                ))}
              </TextField>
            </Tooltip>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ pl: 1, borderLeft: '1px solid', borderColor: 'divider' }}
            >
              <StatusDot status={bot.status} />
              <Switch
                checked={bot.is_active === 1}
                onChange={(event) => toggleActive(event.target.checked)}
                inputProps={{ 'aria-label': `${t('status.active')} ${bot.name}` }}
              />
            </Stack>
          </Stack>
        }
      />

      <AnalyticsCard botId={currentBot.id} />

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Grid container spacing={2}>
              {stats.map((stat) => (
                <Grid size={{ xs: 6, md: 3 }} key={stat.label}>
                  <Card>
                    <CardContent>
                      <Typography variant="caption" color="text.secondary">
                        {stat.label}
                      </Typography>
                      <Typography variant="h5" fontWeight={700}>
                        {stat.value}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>

            <Card>
              <CardContent>
                <Stack spacing={2}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="subtitle2">{t('nav.modules')}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('modules.enabled', { count: bot.activeModules, total: MODULES.length })}
                    </Typography>
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {t('bots.modulesHint')}
                  </Typography>
                  <Box>
                    <Link
                      component="button"
                      type="button"
                      variant="body2"
                      fontWeight={600}
                      onClick={() => navigate(`/bots/${bot.id}/modules`)}
                    >
                      {t('bots.openModules')}
                    </Link>
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          </Box>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <HealthAlertsCard botId={currentBot.id} />
        </Grid>
      </Grid>

      {/* Clone Bot Dialog */}
      <Dialog open={cloneOpen} onClose={() => setCloneOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('bots.cloneTitle', { name: currentBot.name })}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {t('bots.cloneDesc')}
            </Typography>
            <TextField
              label={t('bots.cloneName')}
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label={t('bots.cloneToken')}
              value={cloneToken}
              onChange={(e) => setCloneToken(e.target.value)}
              placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
              fullWidth
              size="small"
              required
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCloneOpen(false)}>{t('actions.cancel')}</Button>
          <Button
            variant="contained"
            disabled={!cloneToken.trim() || cloneBusy}
            onClick={handleCloneSubmit}
          >
            {cloneBusy ? t('bots.cloning') : t('bots.clone')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Bot Confirmation Dialog */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        title={t('bots.deleteTitle', { name: currentBot.name })}
        message={t('bots.deleteMessage', { name: currentBot.name })}
        onConfirm={handleDeleteBot}
        onCancel={() => setDeleteConfirmOpen(false)}
      />

      <BotDiagnosticsDialog
        botId={bot.id}
        open={diagnosticsOpen}
        onClose={() => setDiagnosticsOpen(false)}
      />

      <BotPresetsDialog
        botId={bot.id}
        open={presetsOpen}
        onClose={() => setPresetsOpen(false)}
        onSuccess={refresh}
      />

      <TemplateGalleryDialog
        botId={bot.id}
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        onApplied={refresh}
      />

      <SaveTemplateDialog
        botId={bot.id}
        botName={bot.name}
        open={saveTemplateOpen}
        onClose={() => setSaveTemplateOpen(false)}
      />
    </Box>
  );
}
