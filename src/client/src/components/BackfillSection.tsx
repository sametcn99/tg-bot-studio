import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import HistoryIcon from '@mui/icons-material/History';
import StopIcon from '@mui/icons-material/Stop';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../services/api';
import { ConnectionSelect } from './ConnectionSelect';
import { localizedErrorMessage } from '../utils/errors';

/** Scan account row (API-safe). */
interface ScanAccountRow {
  id: string;
  phone: string;
  label: string | null;
  username: string | null;
  firstName: string | null;
  status: string;
}

/** Backfill job snapshot from the API. */
interface BackfillState {
  running: boolean;
  botId: string | null;
  chatId: string | null;
  phase: 'idle' | 'connecting' | 'scanning' | 'done' | 'cancelled' | 'error';
  scanned: number;
  indexed: number;
  errors: number;
  limit: number;
  errorCode: 'not_member' | 'auth' | 'flood' | 'generic' | null;
  errorDetail: string | null;
}

/** Depth options: last N messages or the whole history (0). */
const DEPTHS = [1_000, 5_000, 10_000, 0];

/**
 * Retroactive indexing card for the file-search module: pick one of the
 * bot's connected scan accounts plus a target chat and a depth, then watch
 * the job walk the history into the index.
 *
 * @param {object} props - Component props.
 * @param {string} props.botId - Active bot id.
 * @returns {React.ReactElement} The section.
 */
export default function BackfillSection({ botId }: { botId: string }): React.ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<ScanAccountRow[]>([]);
  const [accountId, setAccountId] = useState('');
  const [chatId, setChatId] = useState('');
  const [depth, setDepth] = useState(5_000);
  const [state, setState] = useState<BackfillState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeAccounts = accounts.filter((account) => account.status === 'active');

  /**
   * Loads accounts and the current job snapshot.
   */
  const refresh = useCallback((): void => {
    apiFetch<ScanAccountRow[]>(`/api/bots/${botId}/scan-accounts`)
      .then((rows) => {
        setAccounts(rows);
        setAccountId((current) => {
          const stillThere = rows.some((row) => row.id === current && row.status === 'active');
          if (stillThere) return current;
          const first = rows.find((row) => row.status === 'active');
          return first ? first.id : '';
        });
      })
      .catch(() => undefined);
    apiFetch<BackfillState>(`/api/bots/${botId}/file-index/backfill/status`)
      .then(setState)
      .catch(() => undefined);
  }, [botId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll the job while it runs; stop cleanly on unmount.
  useEffect(() => {
    if (!state?.running) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = setInterval(() => {
      apiFetch<BackfillState>(`/api/bots/${botId}/file-index/backfill/status`)
        .then(setState)
        .catch(() => undefined);
    }, 1_500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [state?.running, botId]);

  /**
   * Starts the backfill job.
   */
  function start(): void {
    setError(null);
    apiFetch<BackfillState>(`/api/bots/${botId}/file-index/backfill`, {
      method: 'POST',
      body: JSON.stringify({ chatId, accountId, limit: depth }),
    })
      .then(setState)
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }

  /**
   * Requests job cancellation.
   */
  function cancel(): void {
    apiFetch(`/api/bots/${botId}/file-index/backfill/cancel`, { method: 'POST' }).catch(
      (err: Error) => setError(localizedErrorMessage(err)),
    );
  }

  /**
   * Localized failure text for a finished job.
   */
  function failureText(current: BackfillState): string {
    if (current.errorCode === 'not_member') return t('backfill.errNotMember');
    if (current.errorCode === 'auth') return t('backfill.errAuth');
    if (current.errorCode === 'flood') return t('backfill.errFlood');
    return t('backfill.errGeneric');
  }

  const running = state?.running === true;
  const progress =
    running && state && state.limit > 0 ? Math.min(100, (state.scanned / state.limit) * 100) : null;

  return (
    <Card variant="outlined" sx={{ mt: 3 }}>
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
          <HistoryIcon color="action" fontSize="small" />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {t('backfill.title')}
          </Typography>
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {activeAccounts.length === 0 ? (
          <Stack spacing={1.5}>
            <Alert severity="info">{t('backfill.noAccounts')}</Alert>
            <Box>
              <Button
                size="small"
                onClick={() => navigate(`/bots/${botId}/connections?tab=scan-accounts`)}
              >
                {t('backfill.addAccount')}
              </Button>
            </Box>
          </Stack>
        ) : (
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                label={t('backfill.accountLabel')}
                size="small"
                fullWidth
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                disabled={running}
              >
                {activeAccounts.map((account) => (
                  <MenuItem key={account.id} value={account.id}>
                    {account.label || account.firstName || account.username || account.phone}
                    {account.username ? ` (@${account.username})` : ''}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label={t('backfill.depthLabel')}
                size="small"
                fullWidth
                value={depth}
                onChange={(event) => setDepth(Number(event.target.value))}
                disabled={running}
              >
                {DEPTHS.map((value) => (
                  <MenuItem key={value} value={value}>
                    {value === 0 ? t('backfill.depthAll') : t('backfill.depthOption', { n: value })}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            <ConnectionSelect
              label={t('backfill.chatLabel')}
              value={chatId}
              onChange={setChatId}
              types={['group', 'supergroup']}
              botId={botId}
              disabled={running}
            />
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
              {running ? (
                <Button color="error" startIcon={<StopIcon />} onClick={cancel}>
                  {t('backfill.cancel')}
                </Button>
              ) : (
                <Button variant="contained" disabled={!accountId || !chatId.trim()} onClick={start}>
                  {t('backfill.start')}
                </Button>
              )}
            </Stack>
          </Stack>
        )}

        {state && state.phase !== 'idle' && (
          <Stack spacing={1.5} sx={{ mt: 2.5 }}>
            {running && (
              <>
                <LinearProgress
                  variant={progress === null ? 'indeterminate' : 'determinate'}
                  value={progress ?? undefined}
                />
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
                >
                  <Chip
                    size="small"
                    label={
                      state.phase === 'connecting'
                        ? t('backfill.phaseConnecting')
                        : t('backfill.phaseScanning')
                    }
                  />
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t('backfill.scanned', { n: state.scanned })} ·{' '}
                    {t('backfill.indexed', { n: state.indexed })}
                    {state.errors > 0 ? ` · ${t('backfill.errorsCount', { n: state.errors })}` : ''}
                  </Typography>
                </Stack>
              </>
            )}
            {state.phase === 'done' && (
              <Alert severity="success">
                {t('backfill.phaseDone')}: {t('backfill.scanned', { n: state.scanned })} ·{' '}
                {t('backfill.indexed', { n: state.indexed })}
              </Alert>
            )}
            {state.phase === 'cancelled' && (
              <Alert severity="info">
                {t('backfill.phaseCancelled')} — {t('backfill.restartHint')}
              </Alert>
            )}
            {state.phase === 'error' && (
              <Alert severity="error">
                {failureText(state)}
                {state.errorDetail ? ` (${state.errorDetail})` : ''}
              </Alert>
            )}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
