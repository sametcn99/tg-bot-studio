import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useApi } from '../hooks/useApi';
import { LoadingState } from './Feedback';
import { formatNumber } from '../utils/format';

/** One day of aggregated activity from the analytics endpoint. */
interface ActivityDay {
  day: string;
  messages: number;
  replies: number;
  media: number;
}

/** Analytics overview payload. */
interface BotAnalytics {
  totalUsers: number;
  activeLast7d: number;
  daily: ActivityDay[];
}

/**
 * Lightweight SVG bar chart of daily bot activity (no chart dependency) plus
 * audience totals. Window is switchable between 7 and 30 days.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @returns {React.ReactElement} The analytics card.
 */
export default function AnalyticsCard({ botId }: { botId: string }): React.ReactElement {
  const { t } = useTranslation();
  const [days, setDays] = useState<7 | 30>(7);
  const { data, error, loading, reload } = useApi<BotAnalytics>(
    `/api/bots/${botId}/analytics?days=${days}`,
    [botId, days],
  );

  const chart = useMemo(() => {
    if (!data) return null;
    const width = 640;
    const height = 140;
    const max = Math.max(1, ...data.daily.map((entry) => entry.messages));
    const slot = width / Math.max(1, data.daily.length);
    return data.daily.map((entry, index) => {
      const barHeight = Math.round((entry.messages / max) * (height - 24));
      return {
        key: entry.day,
        x: index * slot + slot * 0.15,
        y: height - barHeight,
        w: slot * 0.7,
        h: barHeight,
        label: entry.day.slice(5),
        value: entry.messages,
      };
    });
  }, [data]);

  return (
    <Card sx={{ mb: 3, borderRadius: 3 }}>
      <CardContent>
        <Stack
          direction="row"
          sx={{
            justifyContent: 'space-between',
            alignItems: 'center',
            mb: 1.5,
            flexWrap: 'wrap',
            gap: 1,
          }}
        >
          <Typography variant="subtitle2" component="h3">
            {t('analytics.title')}
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: 'center',
            }}
          >
            <Chip
              size="small"
              label={t('analytics.totalUsers', { count: data?.totalUsers ?? 0 })}
            />
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              label={t('analytics.activeUsers', { count: data?.activeLast7d ?? 0 })}
            />
            <ToggleButtonGroup
              size="small"
              exclusive
              value={days}
              onChange={(_event, next: 7 | 30 | null) => next && setDays(next)}
              aria-label={t('analytics.window')}
            >
              <ToggleButton value={7} aria-label="7d">
                7d
              </ToggleButton>
              <ToggleButton value={30} aria-label="30d">
                30d
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        </Stack>
        {error ? (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={reload}>
                {t('actions.refresh')}
              </Button>
            }
          >
            {error}
          </Alert>
        ) : loading && !data ? (
          <LoadingState label={t('common.loading')} />
        ) : !chart ? (
          <Typography
            variant="body2"
            sx={{
              color: 'text.secondary',
            }}
          >
            {t('common.empty')}
          </Typography>
        ) : (
          <Box sx={{ overflowX: 'auto' }} role="img" aria-label={t('analytics.title')}>
            <svg
              viewBox="0 0 640 140"
              width="100%"
              height={140}
              preserveAspectRatio="none"
              role="presentation"
            >
              {chart.map((bar) => (
                <g key={bar.key}>
                  <rect
                    x={bar.x}
                    y={bar.y}
                    width={bar.w}
                    height={bar.h}
                    rx={3}
                    fill="var(--mui-palette-primary-main, #2563eb)"
                    opacity={bar.value > 0 ? 0.85 : 0.15}
                  />
                  {bar.value > 0 && bar.h > 16 ? (
                    <text
                      x={bar.x + bar.w / 2}
                      y={bar.y - 4}
                      textAnchor="middle"
                      fontSize="9"
                      fill="var(--mui-palette-text-secondary, #64748b)"
                    >
                      {formatNumber(bar.value)}
                    </text>
                  ) : null}
                </g>
              ))}
              {chart.map((bar, index) =>
                index % Math.ceil(chart.length / 10) === 0 ? (
                  <text
                    key={`label-${bar.key}`}
                    x={bar.x + bar.w / 2}
                    y={136}
                    textAnchor="middle"
                    fontSize="9"
                    fill="var(--mui-palette-text-secondary, #64748b)"
                  >
                    {bar.label}
                  </text>
                ) : null,
              )}
            </svg>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
