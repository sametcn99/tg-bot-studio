import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  LinearProgress,
  Link,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import PeopleAltOutlinedIcon from '@mui/icons-material/PeopleAltOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import WidgetsOutlinedIcon from '@mui/icons-material/WidgetsOutlined';
import RocketLaunchOutlinedIcon from '@mui/icons-material/RocketLaunchOutlined';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import CampaignIcon from '@mui/icons-material/Campaign';
import GroupsIcon from '@mui/icons-material/Groups';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import TuneIcon from '@mui/icons-material/Tune';
import SecurityIcon from '@mui/icons-material/Security';
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
import { useLocalizedModules } from '../registry/localize';
import { moduleIcon } from '../components/ModuleIcons';
import { openSimulatorWith } from '../utils/simulatorBus';
import { localizedErrorMessage } from '../utils/errors';
import { formatNumber } from '../utils/format';

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
  const theme = useTheme();
  const { botId } = useParams<{ botId: string }>();
  const navigate = useNavigate();
  const localizedModules = useLocalizedModules();
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
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);

  // Clone dialog state
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneToken, setCloneToken] = useState('');
  const [cloneBusy, setCloneBusy] = useState(false);

  // Bot operational settings (IANA timezone for scheduled jobs)
  const [timezone, setTimezone] = useState<string>('UTC');

  // File import ref
  const importFileRef = useRef<HTMLInputElement | null>(null);

  const bot = bots.find((entry) => entry.id === botId) ?? activeBot;

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

  const { data: moduleStates } = useApi<Array<{ key: string; name: string; isEnabled: boolean }>>(
    botIdNumber ? `/api/bots/${botIdNumber}/modules` : null,
    [botIdNumber],
  );

  const enabledModules = useMemo(
    () => (moduleStates ?? []).filter((m) => m.isEnabled),
    [moduleStates],
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
    if (!currentBot) return;
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
          <Typography sx={{ color: 'text.secondary' }}>{t('common.empty')}</Typography>
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

  const securityAlerts = [
    isInsecureUrl
      ? { id: 'insecure', severity: 'warning' as const, message: t('bots.insecureHttp') }
      : null,
    securityPosture?.isDefaultMasterKey
      ? { id: 'key', severity: 'error' as const, message: t('bots.defaultKeyWarning') }
      : null,
    securityPosture?.isDefaultJwtSecret
      ? { id: 'jwt', severity: 'warning' as const, message: t('bots.defaultJwtWarning') }
      : null,
    securityError
      ? { id: 'err', severity: 'warning' as const, message: securityError, onRetry: reloadSecurity }
      : null,
  ].filter(Boolean) as Array<{
    id: string;
    severity: 'warning' | 'error';
    message: string;
    onRetry?: () => void;
  }>;

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

  const kpiStats = [
    {
      label: t('bots.subscribers'),
      value: formatNumber(bot.subscribers),
      icon: PeopleAltOutlinedIcon,
      color: '#2563eb',
      link: `/bots/${currentBot.id}/m/crm`,
    },
    {
      label: t('bots.volume24h'),
      value: formatNumber(bot.dailyVolume),
      icon: ForumOutlinedIcon,
      color: '#16a34a',
    },
    {
      label: t('bots.activeModules'),
      value: `${bot.activeModules} / ${MODULES.length}`,
      icon: WidgetsOutlinedIcon,
      color: '#8b5cf6',
      progress: (bot.activeModules / MODULES.length) * 100,
      link: `/bots/${currentBot.id}/modules`,
    },
    {
      label: t('bots.miniApps'),
      value: bot.miniApps,
      icon: RocketLaunchOutlinedIcon,
      color: '#d97706',
      link: `/bots/${currentBot.id}/mini-apps`,
    },
  ];

  const quickShortcuts = [
    {
      key: 'flows',
      title: localizedModules.find((m) => m.key === 'flows')?.name ?? 'Flow Builder',
      description:
        localizedModules.find((m) => m.key === 'flows')?.description ??
        'Interactive conversations & journey automations',
      icon: AccountTreeIcon,
      path: `/bots/${currentBot.id}/m/flows`,
      color: '#3b82f6',
    },
    {
      key: 'broadcast',
      title: localizedModules.find((m) => m.key === 'broadcast')?.name ?? 'Broadcast',
      description:
        localizedModules.find((m) => m.key === 'broadcast')?.description ??
        'Targeted audience announcements and campaigns',
      icon: CampaignIcon,
      path: `/bots/${currentBot.id}/m/broadcast`,
      color: '#10b981',
    },
    {
      key: 'crm',
      title: localizedModules.find((m) => m.key === 'crm')?.name ?? 'Users & CRM',
      description:
        localizedModules.find((m) => m.key === 'crm')?.description ??
        'Subscriber directory, tags, activity & notes',
      icon: GroupsIcon,
      path: `/bots/${currentBot.id}/m/crm`,
      color: '#8b5cf6',
    },
    {
      key: 'mini-apps',
      title: t('nav.miniApps'),
      description:
        localizedModules.find((m) => m.key === 'mini-apps')?.description ??
        'Telegram Web Apps, catalog storefront & Telegram Stars',
      icon: RocketLaunchOutlinedIcon,
      path: `/bots/${currentBot.id}/mini-apps`,
      color: '#f59e0b',
    },
    {
      key: 'support',
      title: localizedModules.find((m) => m.key === 'support')?.name ?? 'Support Desk',
      description:
        localizedModules.find((m) => m.key === 'support')?.description ??
        'Customer helpdesk, agent tickets and live inbox',
      icon: SupportAgentIcon,
      path: `/bots/${currentBot.id}/m/support`,
      color: '#ec4899',
    },
    {
      key: 'modules',
      title: t('nav.modules'),
      description: t('bots.modulesHint'),
      icon: TuneIcon,
      path: `/bots/${currentBot.id}/modules`,
      color: '#6366f1',
    },
  ];

  return (
    <Box sx={{ pb: 6 }}>
      {/* Breadcrumb Navigation */}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
        <Link
          component="button"
          type="button"
          variant="body2"
          onClick={() => navigate('/')}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            color: 'text.secondary',
            textDecoration: 'none',
            fontWeight: 500,
            '&:hover': { color: 'text.primary' },
          }}
        >
          <ArrowBackIcon sx={{ fontSize: 16 }} />
          {t('nav.overview')}
        </Link>
        <Typography variant="body2" sx={{ color: 'text.disabled' }}>
          /
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.primary', fontWeight: 600 }}>
          {bot.name}
        </Typography>
      </Stack>

      {/* Unified Security Alerts */}
      {securityAlerts.length > 0 && (
        <Stack spacing={1} sx={{ mb: 3 }}>
          {securityAlerts.map((alert) => (
            <Alert
              key={alert.id}
              severity={alert.severity}
              icon={alert.severity === 'error' ? undefined : <SecurityIcon fontSize="inherit" />}
              sx={{ borderRadius: 2 }}
              action={
                alert.onRetry ? (
                  <Button color="inherit" size="small" onClick={alert.onRetry}>
                    {t('actions.refresh')}
                  </Button>
                ) : (
                  <Button color="inherit" size="small" onClick={() => navigate('/security')}>
                    {t('nav.security')}
                  </Button>
                )
              }
            >
              {alert.message}
            </Alert>
          ))}
        </Stack>
      )}

      {/* Bot Identity Hero Card */}
      <Card
        sx={{
          p: { xs: 2.5, md: 3 },
          mb: 3,
          borderRadius: 3,
          background:
            theme.palette.mode === 'dark'
              ? 'linear-gradient(135deg, rgba(37, 99, 235, 0.08) 0%, rgba(17, 23, 38, 0.98) 100%)'
              : 'linear-gradient(135deg, rgba(37, 99, 235, 0.04) 0%, #ffffff 100%)',
          border: `1px solid ${theme.palette.divider}`,
          boxShadow:
            theme.palette.mode === 'dark'
              ? '0 4px 20px -2px rgba(0, 0, 0, 0.5)'
              : '0 4px 20px -2px rgba(15, 23, 42, 0.06)',
        }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={3}
          sx={{
            justifyContent: 'space-between',
            alignItems: { xs: 'stretch', md: 'center' },
          }}
        >
          {/* Bot Profile */}
          <Stack direction="row" spacing={2.5} sx={{ alignItems: 'center', minWidth: 0 }}>
            <Box sx={{ position: 'relative', flexShrink: 0 }}>
              <Avatar
                sx={{
                  width: { xs: 56, sm: 64 },
                  height: { xs: 56, sm: 64 },
                  borderRadius: 2.5,
                  background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                  boxShadow: '0 8px 16px -4px rgba(37, 99, 235, 0.35)',
                }}
              >
                <SmartToyIcon sx={{ fontSize: { xs: 32, sm: 38 }, color: '#fff' }} />
              </Avatar>
              <Box
                sx={{
                  position: 'absolute',
                  bottom: -2,
                  right: -2,
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  bgcolor: bot.is_active === 1 ? '#16a34a' : '#94a3b8',
                  border: '2.5px solid',
                  borderColor: 'background.paper',
                }}
              />
            </Box>

            <Box sx={{ minWidth: 0 }}>
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
              >
                <Typography
                  variant="h5"
                  component="h1"
                  sx={{
                    fontWeight: 800,
                    letterSpacing: '-0.02em',
                    lineHeight: 1.2,
                  }}
                >
                  {bot.name}
                </Typography>

                <Chip
                  size="small"
                  icon={
                    <Box
                      sx={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        bgcolor: bot.is_active === 1 ? '#16a34a' : '#94a3b8',
                      }}
                    />
                  }
                  label={bot.is_active === 1 ? t('status.active') : t('status.paused')}
                  sx={{
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    bgcolor: bot.is_active === 1 ? alpha('#16a34a', 0.12) : 'action.hover',
                    color: bot.is_active === 1 ? '#16a34a' : 'text.secondary',
                    border: `1px solid ${
                      bot.is_active === 1 ? alpha('#16a34a', 0.25) : 'transparent'
                    }`,
                  }}
                />

                <Tooltip title={bot.is_active === 1 ? t('bots.paused') : t('bots.activated')}>
                  <Switch
                    size="small"
                    checked={bot.is_active === 1}
                    onChange={(e) => toggleActive(e.target.checked)}
                    slotProps={{
                      input: { 'aria-label': `${t('status.active')} ${bot.name}` },
                    }}
                  />
                </Tooltip>
              </Stack>

              <Stack
                direction="row"
                spacing={1.5}
                sx={{
                  alignItems: 'center',
                  mt: 1,
                  flexWrap: 'wrap',
                  gap: 1,
                }}
              >
                {bot.username ? (
                  <Link
                    href={`https://t.me/${bot.username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.5,
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      color: 'primary.main',
                      textDecoration: 'none',
                      '&:hover': { textDecoration: 'underline' },
                    }}
                  >
                    @{bot.username}
                    <OpenInNewIcon sx={{ fontSize: 13 }} />
                  </Link>
                ) : (
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                    ID: #{bot.id}
                  </Typography>
                )}

                <Chip
                  size="small"
                  variant="outlined"
                  label={`ID #${bot.id}`}
                  sx={{ height: 22, fontSize: '0.7rem', fontWeight: 500 }}
                />

                <Chip
                  size="small"
                  variant="outlined"
                  icon={<AccessTimeIcon sx={{ fontSize: '13px !important' }} />}
                  label={timezone}
                  sx={{ height: 22, fontSize: '0.7rem', fontWeight: 500 }}
                />
              </Stack>
            </Box>
          </Stack>

          {/* Action Toolbar */}
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 1,
              justifyContent: { xs: 'flex-start', sm: 'flex-end' },
              pt: { xs: 1, md: 0 },
            }}
          >
            <Button
              variant="outlined"
              size="medium"
              startIcon={<HealthAndSafetyIcon />}
              onClick={() => setDiagnosticsOpen(true)}
              sx={{ borderRadius: 2 }}
            >
              {t('nav.diagnostics')}
            </Button>

            <Button
              variant="contained"
              size="medium"
              startIcon={<AutoFixHighIcon />}
              onClick={() => setPresetsOpen(true)}
              sx={{
                borderRadius: 2,
                boxShadow: 'none',
                '&:hover': { boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)' },
              }}
            >
              {t('actions.applyPreset')}
            </Button>

            <Tooltip title={t('simulator.title')}>
              <Button
                variant="outlined"
                size="medium"
                startIcon={<SmartToyIcon />}
                onClick={() => openSimulatorWith('/start')}
                sx={{ borderRadius: 2 }}
              >
                {t('simulator.title')}
              </Button>
            </Tooltip>

            <IconButton
              aria-label={t('bots.moreActions')}
              aria-controls="bot-actions-menu"
              aria-haspopup="true"
              onClick={(e) => setMenuAnchorEl(e.currentTarget)}
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                p: 1,
              }}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>

            {/* Overflow Dropdown Menu */}
            <Menu
              id="bot-actions-menu"
              anchorEl={menuAnchorEl}
              open={Boolean(menuAnchorEl)}
              onClose={() => setMenuAnchorEl(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              slotProps={{
                paper: {
                  sx: {
                    borderRadius: 2.5,
                    minWidth: 230,
                    boxShadow: (th) =>
                      th.palette.mode === 'dark'
                        ? '0 12px 28px rgba(0,0,0,0.6)'
                        : '0 12px 28px rgba(15,23,42,0.12)',
                  },
                },
              }}
            >
              <MenuItem
                onClick={() => {
                  setMenuAnchorEl(null);
                  setGalleryOpen(true);
                }}
              >
                <ListItemIcon>
                  <DashboardCustomizeIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('templates.gallery')}</ListItemText>
              </MenuItem>

              <MenuItem
                onClick={() => {
                  setMenuAnchorEl(null);
                  setSaveTemplateOpen(true);
                }}
              >
                <ListItemIcon>
                  <BookmarkAddIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('templates.save')}</ListItemText>
              </MenuItem>

              <MenuItem
                onClick={() => {
                  setMenuAnchorEl(null);
                  handleOpenClone();
                }}
              >
                <ListItemIcon>
                  <ContentCopyIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('bots.clone')}</ListItemText>
              </MenuItem>

              <MenuItem
                onClick={() => {
                  setMenuAnchorEl(null);
                  handleExportConfig();
                }}
              >
                <ListItemIcon>
                  <FileDownloadIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('actions.export')} (JSON)</ListItemText>
              </MenuItem>

              <MenuItem
                onClick={() => {
                  setMenuAnchorEl(null);
                  importFileRef.current?.click();
                }}
              >
                <ListItemIcon>
                  <FileUploadIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('actions.create', 'İçe Aktar')} (JSON)</ListItemText>
              </MenuItem>

              <Divider />

              <MenuItem
                onClick={() => {
                  setMenuAnchorEl(null);
                  setDeleteConfirmOpen(true);
                }}
                sx={{ color: 'error.main' }}
              >
                <ListItemIcon sx={{ color: 'error.main' }}>
                  <DeleteOutlineIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('actions.delete')}</ListItemText>
              </MenuItem>
            </Menu>

            <input
              type="file"
              ref={importFileRef}
              onChange={handleImportFile}
              accept=".json"
              style={{ display: 'none' }}
            />
          </Stack>
        </Stack>
      </Card>

      {/* Top-Level KPI Metric Cards */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        {kpiStats.map((stat) => {
          const Icon = stat.icon;
          const isClickable = Boolean(stat.link);
          return (
            <Grid size={{ xs: 12, sm: 6, lg: 3 }} key={stat.label}>
              <Card
                sx={{
                  borderRadius: 3,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  transition: 'all 0.2s ease',
                  '&:hover': isClickable
                    ? {
                        transform: 'translateY(-2px)',
                        boxShadow: (th) =>
                          th.palette.mode === 'dark'
                            ? '0 10px 20px -5px rgba(0,0,0,0.5)'
                            : '0 10px 20px -5px rgba(15,23,42,0.08)',
                        borderColor: stat.color,
                        cursor: 'pointer',
                      }
                    : undefined,
                }}
                onClick={stat.link ? () => navigate(stat.link!) : undefined}
              >
                <CardContent sx={{ p: 2.5, pb: '20px !important' }}>
                  <Stack
                    direction="row"
                    sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}
                  >
                    <Box>
                      <Typography
                        variant="caption"
                        sx={{
                          color: 'text.secondary',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          display: 'block',
                        }}
                      >
                        {stat.label}
                      </Typography>
                      <Typography
                        variant="h4"
                        sx={{
                          fontWeight: 800,
                          letterSpacing: '-0.02em',
                          mt: 0.5,
                        }}
                      >
                        {stat.value}
                      </Typography>
                    </Box>

                    <Box
                      sx={{
                        p: 1.25,
                        borderRadius: 2.5,
                        bgcolor: alpha(stat.color, 0.1),
                        color: stat.color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Icon fontSize="medium" />
                    </Box>
                  </Stack>

                  {stat.progress !== undefined ? (
                    <Box sx={{ mt: 1 }}>
                      <LinearProgress
                        variant="determinate"
                        value={stat.progress}
                        sx={{
                          height: 6,
                          borderRadius: 3,
                          bgcolor: alpha(stat.color, 0.15),
                          '& .MuiLinearProgress-bar': {
                            bgcolor: stat.color,
                            borderRadius: 3,
                          },
                        }}
                      />
                    </Box>
                  ) : null}
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {/* Main Workspace (Left 8 cols, Right 4 cols) */}
      <Grid container spacing={3}>
        {/* Left Column: Analytics & Quick Feature Hub */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Analytics Card */}
            <AnalyticsCard botId={currentBot.id} />

            {/* Quick Access & Feature Hub */}
            <Card sx={{ p: 3, borderRadius: 3 }}>
              <Stack spacing={3}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  sx={{
                    justifyContent: 'space-between',
                    alignItems: { xs: 'flex-start', sm: 'center' },
                  }}
                >
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '-0.01em' }}>
                      {t('bots.quickAccess')}
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
                      {t('bots.modulesHint')}
                    </Typography>
                  </Box>

                  <Button
                    size="small"
                    endIcon={<ArrowForwardIcon />}
                    onClick={() => navigate(`/bots/${bot.id}/modules`)}
                    sx={{ fontWeight: 600, flexShrink: 0 }}
                  >
                    {t('bots.viewAllModules')} ({MODULES.length})
                  </Button>
                </Stack>

                {/* Quick Shortcuts Grid */}
                <Grid container spacing={2}>
                  {quickShortcuts.map((shortcut) => {
                    const IconComponent = shortcut.icon;
                    return (
                      <Grid size={{ xs: 12, sm: 6 }} key={shortcut.key}>
                        <Card
                          variant="outlined"
                          sx={{
                            borderRadius: 2.5,
                            transition: 'all 0.2s ease',
                            '&:hover': {
                              borderColor: shortcut.color,
                              bgcolor: (th) =>
                                alpha(shortcut.color, th.palette.mode === 'dark' ? 0.06 : 0.03),
                              transform: 'translateY(-2px)',
                            },
                          }}
                        >
                          <CardActionArea onClick={() => navigate(shortcut.path)} sx={{ p: 2 }}>
                            <Stack direction="row" spacing={1.75} sx={{ alignItems: 'flex-start' }}>
                              <Box
                                sx={{
                                  p: 1.25,
                                  borderRadius: 2,
                                  bgcolor: alpha(shortcut.color, 0.12),
                                  color: shortcut.color,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0,
                                }}
                              >
                                <IconComponent fontSize="small" />
                              </Box>
                              <Box sx={{ minWidth: 0 }}>
                                <Typography
                                  variant="subtitle2"
                                  sx={{ fontWeight: 700, lineHeight: 1.3 }}
                                >
                                  {shortcut.title}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  sx={{
                                    color: 'text.secondary',
                                    mt: 0.5,
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                    lineHeight: 1.35,
                                  }}
                                >
                                  {shortcut.description}
                                </Typography>
                              </Box>
                            </Stack>
                          </CardActionArea>
                        </Card>
                      </Grid>
                    );
                  })}
                </Grid>

                <Divider />

                {/* Active Modules Ribbon */}
                <Box>
                  <Stack
                    direction="row"
                    sx={{
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      mb: 1.5,
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {t('bots.enabledModulesTitle')} ({enabledModules.length})
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {t('modules.enabled', {
                        count: bot.activeModules,
                        total: MODULES.length,
                      })}
                    </Typography>
                  </Stack>

                  {enabledModules.length === 0 ? (
                    <Alert severity="info" variant="outlined" sx={{ borderRadius: 2 }}>
                      {t('bots.noActiveModules')}
                    </Alert>
                  ) : (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {enabledModules.map((m) => {
                        const Icon = moduleIcon(m.key);
                        const localized = localizedModules.find((lm) => lm.key === m.key);
                        const displayName = localized?.name ?? m.name ?? m.key;
                        return (
                          <Chip
                            key={m.key}
                            icon={<Icon sx={{ fontSize: '15px !important' }} />}
                            label={displayName}
                            onClick={() => navigate(`/bots/${bot.id}/m/${m.key}`)}
                            clickable
                            variant="outlined"
                            size="small"
                            sx={{
                              borderRadius: 2,
                              py: 1.75,
                              fontSize: '0.8rem',
                              fontWeight: 500,
                              bgcolor: (th) =>
                                th.palette.mode === 'dark'
                                  ? 'rgba(255,255,255,0.02)'
                                  : 'rgba(15,23,42,0.02)',
                              '&:hover': {
                                borderColor: 'primary.main',
                                bgcolor: (th) => alpha(th.palette.primary.main, 0.08),
                              },
                            }}
                          />
                        );
                      })}
                    </Box>
                  )}
                </Box>
              </Stack>
            </Card>
          </Box>
        </Grid>

        {/* Right Column: Health Alerts & Settings */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Health & Alerts Card */}
            <HealthAlertsCard botId={currentBot.id} />

            {/* Operational Settings Card */}
            <Card sx={{ p: 2.5, borderRadius: 3 }}>
              <Stack spacing={2.5}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                  <Box
                    sx={{
                      p: 0.75,
                      borderRadius: 1.5,
                      bgcolor: (th) => alpha(th.palette.primary.main, 0.1),
                      color: 'primary.main',
                      display: 'flex',
                    }}
                  >
                    <AccessTimeIcon fontSize="small" />
                  </Box>
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                      {t('bots.timezoneLabel')}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {timezone}
                    </Typography>
                  </Box>
                </Box>

                <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.4 }}>
                  {t('bots.timezoneDesc')}
                </Typography>

                <TextField
                  select
                  size="small"
                  fullWidth
                  value={timezone}
                  onChange={(event) => handleTimezoneChange(event.target.value)}
                  label={t('bots.timezoneLabel')}
                  slotProps={{
                    input: { sx: { borderRadius: 2 } },
                  }}
                >
                  {TIMEZONE_OPTIONS.map((zone) => (
                    <MenuItem key={zone} value={zone}>
                      {zone}
                    </MenuItem>
                  ))}
                </TextField>

                <Divider />

                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  {t('bots.runtimeInfo')}
                </Typography>

                <Stack spacing={1.25}>
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      Bot ID
                    </Typography>
                    <Typography variant="caption" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
                      #{bot.id}
                    </Typography>
                  </Box>

                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      Telegram
                    </Typography>
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                      {bot.username ? `@${bot.username}` : '-'}
                    </Typography>
                  </Box>

                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {t('common.status')}
                    </Typography>
                    <StatusDot status={bot.status} />
                  </Box>

                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {t('status.active')}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        fontWeight: 700,
                        color: bot.is_active === 1 ? 'success.main' : 'text.disabled',
                      }}
                    >
                      {bot.is_active === 1 ? t('status.active') : t('status.inactive')}
                    </Typography>
                  </Box>
                </Stack>

                {bot.username && (
                  <Button
                    variant="outlined"
                    size="small"
                    fullWidth
                    startIcon={<OpenInNewIcon />}
                    href={`https://t.me/${bot.username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{ borderRadius: 2 }}
                  >
                    {t('bots.openTelegram')}
                  </Button>
                )}
              </Stack>
            </Card>

            {/* Sandbox Simulator Card */}
            <Card
              sx={{
                p: 2.5,
                borderRadius: 3,
                background:
                  theme.palette.mode === 'dark'
                    ? 'linear-gradient(135deg, rgba(37, 99, 235, 0.1) 0%, rgba(17, 23, 38, 0.9) 100%)'
                    : 'linear-gradient(135deg, rgba(37, 99, 235, 0.05) 0%, #ffffff 100%)',
                border: `1px solid ${theme.palette.divider}`,
              }}
            >
              <Stack spacing={2}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <Box
                    sx={{
                      p: 1,
                      borderRadius: 2,
                      bgcolor: 'primary.main',
                      color: '#fff',
                      display: 'flex',
                    }}
                  >
                    <SmartToyIcon fontSize="small" />
                  </Box>
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                      {t('bots.launchSimulator')}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {t('simulator.title')}
                    </Typography>
                  </Box>
                </Stack>

                <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>
                  {t('bots.launchSimulatorDesc')}
                </Typography>

                <Button
                  variant="contained"
                  size="small"
                  fullWidth
                  startIcon={<SmartToyIcon />}
                  onClick={() => openSimulatorWith('/start')}
                  sx={{ borderRadius: 2 }}
                >
                  {t('simulator.title')}
                </Button>
              </Stack>
            </Card>
          </Box>
        </Grid>
      </Grid>

      {/* Clone Bot Dialog */}
      <Dialog open={cloneOpen} onClose={() => setCloneOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('bots.cloneTitle', { name: currentBot.name })}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
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
