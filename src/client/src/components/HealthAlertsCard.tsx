import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import SendIcon from '@mui/icons-material/Send';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import { ConnectionSelect } from './ConnectionSelect';
import { useSnackbar } from '../context/SnackbarContext';
import { localizedErrorMessage } from '../utils/errors';
import { formatDateTime } from '../utils/format';

/** Alert settings payload. */
interface AlertSettings {
  enabled: boolean;
  alertChatId: string;
}

/** Health event row. */
interface HealthEventRow {
  id: string;
  botId: string;
  level: 'failed' | 'recovering' | 'recovered';
  message: string;
  notified: boolean;
  createdAt: string | null;
}

/**
 * Bot health monitor card: alert settings (Telegram chat), test alert, and
 * the recent failure/recovery event feed.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @returns {React.ReactElement} The card.
 */
export default function HealthAlertsCard({ botId }: { botId: string }): React.ReactElement {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [events, setEvents] = useState<HealthEventRow[]>([]);
  const [testing, setTesting] = useState(false);

  const reload = useCallback((): void => {
    apiFetch<AlertSettings>(`/api/bots/${botId}/health/alerts`)
      .then(setSettings)
      .catch(() => undefined);
    apiFetch<HealthEventRow[]>(`/api/bots/${botId}/health/events`)
      .then(setEvents)
      .catch(() => undefined);
  }, [botId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /**
   * Persists alert settings.
   * @returns {void}
   */
  function save(next: AlertSettings): void {
    setSettings(next);
    apiFetch(`/api/bots/${botId}/health/alerts`, {
      method: 'PUT',
      body: JSON.stringify(next),
    })
      .then(() => showSuccess(t('health.saved')))
      .catch((err: Error) => showError(localizedErrorMessage(err)));
  }

  /**
   * Sends a test alert.
   * @returns {void}
   */
  function sendTest(): void {
    setTesting(true);
    apiFetch<{ delivered: boolean; detail: string }>(`/api/bots/${botId}/health/alerts/test`, {
      method: 'POST',
    })
      .then((result) => {
        if (result.delivered) showSuccess(result.detail);
        else showError(result.detail);
      })
      .catch((err: Error) => showError(localizedErrorMessage(err)))
      .finally(() => setTesting(false));
  }

  const levelColor = (level: HealthEventRow['level']): 'error' | 'warning' | 'success' =>
    level === 'failed' ? 'error' : level === 'recovering' ? 'warning' : 'success';

  return (
    <Card>
      <CardContent>
        <Stack
          direction="row"
          sx={{
            justifyContent: 'space-between',
            alignItems: 'center',
            mb: 1.5,
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: 'center',
            }}
          >
            <NotificationsActiveIcon fontSize="small" />
            <Typography variant="subtitle2" component="h3">
              {t('health.title')}
            </Typography>
          </Stack>
          <Tooltip title={t('common.refresh')}>
            <IconButton size="small" onClick={reload}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>

        {settings && (
          <Stack spacing={1.5}>
            <Stack
              direction="row"
              sx={{
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Typography variant="body2">{t('health.enabled')}</Typography>
              <Switch
                checked={settings.enabled}
                onChange={(event) => save({ ...settings, enabled: event.target.checked })}
                slotProps={{
                  input: { 'aria-label': t('health.enabled') },
                }}
              />
            </Stack>
            <Stack
              direction="row"
              spacing={1}
              sx={{
                alignItems: 'flex-start',
              }}
            >
              <ConnectionSelect
                label={t('health.alertChatId')}
                value={settings.alertChatId}
                onChange={(value) =>
                  setSettings((current) => (current ? { ...current, alertChatId: value } : current))
                }
                helperText={t('health.alertChatIdHelp')}
              />
              <Box sx={{ pt: 0.5 }}>
                <Button size="small" variant="contained" onClick={() => save(settings)}>
                  {t('actions.save')}
                </Button>
              </Box>
            </Stack>
            <Box>
              <Button
                size="small"
                startIcon={<SendIcon />}
                onClick={sendTest}
                disabled={testing || !settings.alertChatId}
              >
                {t('health.sendTest')}
              </Button>
            </Box>
          </Stack>
        )}

        <Typography
          variant="caption"
          sx={{
            color: 'text.secondary',
            display: 'block',
            mt: 1.5,
            mb: 0.5,
          }}
        >
          {t('health.recentEvents')}
        </Typography>
        <Stack spacing={0.75}>
          {events.map((event) => (
            <Stack
              key={event.id}
              direction="row"
              spacing={1}
              sx={{
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  alignItems: 'center',
                  minWidth: 0,
                }}
              >
                <Chip size="small" color={levelColor(event.level)} label={event.level} />
                <Typography variant="caption" noWrap title={event.message}>
                  {event.message}
                </Typography>
              </Stack>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                {!event.notified && (
                  <Typography
                    variant="caption"
                    sx={{
                      color: 'text.secondary',
                    }}
                  >
                    {t('health.notNotified')}
                  </Typography>
                )}
                <Typography
                  variant="caption"
                  sx={{
                    color: 'text.secondary',
                  }}
                >
                  {formatDateTime(event.createdAt)}
                </Typography>
              </Box>
            </Stack>
          ))}
          {events.length === 0 && (
            <Typography
              variant="caption"
              sx={{
                color: 'text.secondary',
              }}
            >
              {t('health.noEvents')}
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
