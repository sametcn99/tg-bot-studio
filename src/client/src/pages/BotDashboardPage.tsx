import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  Link,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import { useBots } from '../context/BotContext';
import StatusDot from '../components/StatusDot';
import PageHeader from '../components/PageHeader';
import BotDiagnosticsDialog from '../components/BotDiagnosticsDialog';
import BotPresetsDialog from '../components/BotPresetsDialog';

/**
 * Contextual bot dashboard: key audience and runtime metrics for the active
 * bot plus diagnostics and starter presets.
 */
export default function BotDashboardPage(): React.ReactElement {
  const { t } = useTranslation();
  const { botId } = useParams<{ botId: string }>();
  const navigate = useNavigate();
  const { bots, activeBot, setActiveBotId, refresh } = useBots();
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);

  const bot = bots.find((entry) => entry.id === Number(botId)) ?? activeBot;

  // Keep the global bot switcher in sync with deep-linked bot routes.
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
    }).then(refresh);
  }

  return (
    <Box>
      <PageHeader
        title={bot.name}
        subtitle={bot.username ? `@${bot.username}` : `ID ${bot.id}`}
        actions={
          <Stack direction="row" spacing={1.5} alignItems="center">
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
            <Stack direction="row" spacing={1} alignItems="center" sx={{ pl: 1, borderLeft: '1px solid', borderColor: 'divider' }}>
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
                {t('modules.enabled', { count: bot.activeModules, total: 20 })}
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
