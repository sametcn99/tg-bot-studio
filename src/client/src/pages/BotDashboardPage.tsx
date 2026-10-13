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
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import { useBots } from '../context/BotContext';
import { useSnackbar } from '../context/SnackbarContext';
import StatusDot from '../components/StatusDot';
import PageHeader from '../components/PageHeader';
import BotDiagnosticsDialog from '../components/BotDiagnosticsDialog';
import BotPresetsDialog from '../components/BotPresetsDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import { MODULES } from '../registry/modules';

/**
 * Contextual bot dashboard: key audience and runtime metrics for the active
 * bot plus diagnostics, cloning, import/export, and starter presets.
 */
export default function BotDashboardPage(): React.ReactElement {
  const { t } = useTranslation();
  const { botId } = useParams<{ botId: string }>();
  const navigate = useNavigate();
  const { bots, activeBot, setActiveBotId, refresh } = useBots();
  const { showSuccess, showError } = useSnackbar();

  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Clone dialog state
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneToken, setCloneToken] = useState('');
  const [cloneBusy, setCloneBusy] = useState(false);

  // File import ref
  const importFileRef = useRef<HTMLInputElement | null>(null);

  const [securityPosture, setSecurityPosture] = useState<{
    isDefaultMasterKey: boolean;
    isDefaultJwtSecret: boolean;
  } | null>(null);

  const bot = bots.find((entry) => entry.id === Number(botId)) ?? activeBot;

  useEffect(() => {
    apiFetch<{ isDefaultMasterKey: boolean; isDefaultJwtSecret: boolean }>(
      '/api/auth/security-status',
    )
      .then(setSecurityPosture)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (bot && activeBot?.id !== bot.id) {
      setActiveBotId(bot.id);
    }
  }, [bot, activeBot, setActiveBotId]);

  if (!bot) {
    return (
      <Box>
        <PageHeader title={t('nav.botDashboard')} />
        <Typography color="text.secondary">{t('common.empty')}</Typography>
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
        showSuccess(active ? 'Bot activated.' : 'Bot paused.');
        refresh();
      })
      .catch((err: Error) => showError(err.message));
  }

  function handleDeleteBot(): void {
    apiFetch(`/api/bots/${currentBot.id}`, { method: 'DELETE' })
      .then(() => {
        showSuccess(`Bot "${currentBot.name}" deleted successfully.`);
        setDeleteConfirmOpen(false);
        refresh();
        navigate('/');
      })
      .catch((err: Error) => showError(err.message));
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
        showSuccess(`Bot cloned successfully as "${created.name}"!`);
        setCloneOpen(false);
        refresh();
        if (created.id) navigate(`/bots/${created.id}`);
      })
      .catch((err: Error) => showError(err.message))
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
        showSuccess('Bot configuration exported.');
      })
      .catch((err: Error) => showError(err.message));
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
            showSuccess(
              `Configuration imported successfully (${res.importedModules ?? 0} modules configured).`,
            );
            refresh();
          })
          .catch((err: Error) => showError(err.message));
      } catch {
        showError('Invalid JSON file format.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  return (
    <Box>
      {isInsecureUrl && (
        <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 2 }}>
          Dashboard is accessed via plain HTTP. Telegram Mini Apps and webhook tracking require
          HTTPS in production (e.g. reverse proxy or SSL certificate).
        </Alert>
      )}

      {securityPosture?.isDefaultMasterKey && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Security Warning: Your studio is using the default master key ("admin123"). Please change
          it immediately in Security settings to protect your bots.
        </Alert>
      )}

      {securityPosture?.isDefaultJwtSecret && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Security Notice: Default development JWT secret is active. Set JWT_SECRET in your
          environment before deploying to production.
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
            <Tooltip title="Clone all modules, autoresponders, drip flows and mini apps to a new bot">
              <Button
                variant="outlined"
                size="small"
                startIcon={<ContentCopyIcon />}
                onClick={handleOpenClone}
              >
                Clone Bot
              </Button>
            </Tooltip>
            <Tooltip title="Export configuration bundle as JSON">
              <IconButton
                size="small"
                onClick={handleExportConfig}
                aria-label="Export configuration"
              >
                <FileDownloadIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Import configuration from JSON file">
              <IconButton
                size="small"
                onClick={() => importFileRef.current?.click()}
                aria-label="Import configuration"
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
            <Tooltip title="Delete bot and all scoped tables">
              <IconButton
                size="small"
                color="error"
                onClick={() => setDeleteConfirmOpen(true)}
                aria-label="Delete bot"
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
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

      <Grid container spacing={2} sx={{ mb: 3 }}>
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
              Enable or disable feature modules; changes hot-reload the bot runtime.
            </Typography>
            <Box>
              <Link
                component="button"
                type="button"
                variant="body2"
                fontWeight={600}
                onClick={() => navigate(`/bots/${bot.id}/modules`)}
              >
                Open Feature Modules
              </Link>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {/* Clone Bot Dialog */}
      <Dialog open={cloneOpen} onClose={() => setCloneOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Clone Bot: {currentBot.name}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Creates an identical copy of this bot with all 21 module settings, auto-responders,
              drip flows, and mini app configurations. Enter a new Telegram bot token from
              @BotFather.
            </Typography>
            <TextField
              label="Cloned Bot Name"
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label="New BotFather Token"
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
          <Button onClick={() => setCloneOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!cloneToken.trim() || cloneBusy}
            onClick={handleCloneSubmit}
          >
            {cloneBusy ? 'Cloning...' : 'Clone Bot'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Bot Confirmation Dialog */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        title={`Delete Bot: ${currentBot.name}`}
        message={`Are you sure you want to permanently delete "${currentBot.name}"? This will terminate the bot runtime and permanently erase all associated subscribers, mini apps, orders, messages, and settings across all 18 tables.`}
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
    </Box>
  );
}
