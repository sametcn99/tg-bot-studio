import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { apiFetch } from '../services/api';
import { localizedErrorMessage } from '../utils/errors';

/** Scan account row as returned by the API (no session field ever). */
interface ScanAccountRow {
  id: string;
  phone: string;
  label: string | null;
  username: string | null;
  firstName: string | null;
  status: string;
}

/** Wizard phases in order; `keys` is injected when credentials are missing. */
type Phase = 'keys' | 'phone' | 'code' | 'password' | 'done';

/**
 * Maps known server error strings onto localized wizard messages.
 * @param {string} message - Server error message.
 * @param {(key: string, opts?: object) => string} t - Translator.
 * @returns {string | null} Localized message when recognized.
 */
function knownError(message: string, t: TFunction): string | null {
  if (message.includes('MTPROTO_NOT_CONFIGURED')) return t('scanAccounts.wizard.errKeys');
  const flood = message.match(/FLOOD_WAIT:(\d+)/);
  if (flood) return t('scanAccounts.wizard.errFlood', { seconds: flood[1] });
  if (message.includes('phone must be') || message.includes('Invalid phone')) {
    return t('scanAccounts.wizard.errPhone');
  }
  if (message.includes('code is invalid') || message.includes('code rejected')) {
    return t('scanAccounts.wizard.errCode');
  }
  if (message.includes('Password rejected') || message.includes('password is incorrect')) {
    return t('scanAccounts.wizard.errPassword');
  }
  if (message.includes('api_id/api_hash')) return t('scanAccounts.wizard.errKeys');
  return null;
}

/**
 * Scan account connect wizard: (app keys when missing) → phone → login code
 * → 2FA password when required → done with an optional label. The session
 * stays server-side; only this dialog's submit payloads travel.
 *
 * @param {object} props - Component props.
 * @param {boolean} props.open - Dialog visibility.
 * @param {string} props.botId - Active bot id.
 * @param {() => void} props.onClose - Close handler.
 * @param {() => void} props.onConnected - Called after a successful connect.
 * @returns {React.ReactElement} The wizard dialog.
 */
export default function ScanAccountWizardDialog({
  open,
  botId,
  onClose,
  onConnected,
}: {
  open: boolean;
  botId: string;
  onClose: () => void;
  onConnected: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const theme = useTheme();
  const compactDialogs = useMediaQuery(theme.breakpoints.down('sm'));
  const [phase, setPhase] = useState<Phase>('phone');
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [label, setLabel] = useState('');
  const [ticket, setTicket] = useState('');
  const [account, setAccount] = useState<ScanAccountRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPhase('phone');
    setApiId('');
    setApiHash('');
    setPhone('');
    setCode('');
    setPassword('');
    setLabel('');
    setTicket('');
    setAccount(null);
    setError(null);
    apiFetch<{ configured: boolean }>(`/api/bots/${botId}/scan-accounts/mtproto-status`)
      .then((status) => {
        if (!status.configured) setPhase('keys');
      })
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }, [open, botId]);

  /**
   * Runs an async step, surfacing errors inline.
   * @param {() => Promise<void>} action - Step action.
   * @returns {void}
   */
  function run(action: () => Promise<void>): void {
    setSubmitting(true);
    setError(null);
    action()
      .catch((err: Error) => {
        const raw = err.message ?? String(err);
        setError(knownError(raw, t) ?? raw);
      })
      .finally(() => setSubmitting(false));
  }

  /** Submits the app keys step. */
  function submitKeys(): void {
    run(async () => {
      await apiFetch(`/api/bots/${botId}/scan-accounts/mtproto-status`, {
        method: 'PUT',
        body: JSON.stringify({ apiId: Number(apiId), apiHash: apiHash.trim() }),
      });
      setPhase('phone');
    });
  }

  /** Requests the login code for the phone number. */
  function submitPhone(): void {
    run(async () => {
      const result = await apiFetch<{ status: string; ticket: string }>(
        `/api/bots/${botId}/scan-accounts/login/start`,
        { method: 'POST', body: JSON.stringify({ phone: phone.trim() }) },
      );
      setTicket(result.ticket);
      setPhase('code');
    });
  }

  /** Submits the login code. */
  function submitCode(): void {
    run(async () => {
      const result = await apiFetch<{ status: string; account?: ScanAccountRow }>(
        `/api/bots/${botId}/scan-accounts/login/code`,
        { method: 'POST', body: JSON.stringify({ ticket, code: code.trim() }) },
      );
      if (result.status === 'needsPassword') {
        setPhase('password');
        return;
      }
      setAccount(result.account ?? null);
      setPhase('done');
    });
  }

  /** Submits the 2FA password. */
  function submitPassword(): void {
    run(async () => {
      const result = await apiFetch<{ status: string; account?: ScanAccountRow }>(
        `/api/bots/${botId}/scan-accounts/login/password`,
        { method: 'POST', body: JSON.stringify({ ticket, password }) },
      );
      setAccount(result.account ?? null);
      setPhase('done');
    });
  }

  /** Saves the optional label and closes. */
  function finish(): void {
    if (account && label.trim()) {
      apiFetch(`/api/bots/${botId}/scan-accounts/${account.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ label: label.trim() }),
      })
        .catch(() => undefined)
        .finally(() => onConnected());
      return;
    }
    onConnected();
  }

  /** Cancels an in-flight login server-side, then closes. */
  function cancelLogin(): void {
    if (ticket) {
      apiFetch(`/api/bots/${botId}/scan-accounts/login/cancel`, {
        method: 'POST',
        body: JSON.stringify({ ticket }),
      }).catch(() => undefined);
    }
    onClose();
  }

  const steps = [
    t('scanAccounts.wizard.stepPhone'),
    t('scanAccounts.wizard.stepCode'),
    t('scanAccounts.wizard.stepPassword'),
    t('scanAccounts.wizard.stepDone'),
  ];
  const activeIndex =
    phase === 'keys'
      ? -1
      : phase === 'phone'
        ? 0
        : phase === 'code'
          ? 1
          : phase === 'password'
            ? 2
            : 3;

  return (
    <Dialog
      open={open}
      onClose={cancelLogin}
      maxWidth="sm"
      fullWidth
      fullScreen={compactDialogs}
      aria-labelledby="scan-account-wizard-title"
    >
      <DialogTitle id="scan-account-wizard-title">{t('scanAccounts.wizard.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {activeIndex >= 0 && (
            <Stepper activeStep={activeIndex} alternativeLabel>
              {steps.map((labelText) => (
                <Step key={labelText}>
                  <StepLabel>{labelText}</StepLabel>
                </Step>
              ))}
            </Stepper>
          )}

          {phase === 'keys' && (
            <>
              <Alert severity="info">{t('scanAccounts.wizard.apiHelp')}</Alert>
              <TextField
                label={t('scanAccounts.wizard.apiId')}
                size="small"
                fullWidth
                inputMode="numeric"
                value={apiId}
                onChange={(event) => setApiId(event.target.value.replace(/\D/g, ''))}
              />
              <TextField
                label={t('scanAccounts.wizard.apiHash')}
                size="small"
                fullWidth
                value={apiHash}
                onChange={(event) => setApiHash(event.target.value.trim())}
              />
            </>
          )}

          {phase === 'phone' && (
            <TextField
              label={t('scanAccounts.wizard.phone')}
              size="small"
              fullWidth
              placeholder="+90 5xx xxx xx xx"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              helperText={t('scanAccounts.wizard.phoneHelp')}
            />
          )}

          {phase === 'code' && (
            <>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('scanAccounts.wizard.codeSent', { phone: phone.trim() })}
              </Typography>
              <TextField
                label={t('scanAccounts.wizard.code')}
                size="small"
                fullWidth
                inputMode="numeric"
                placeholder="•••••"
                value={code}
                onChange={(event) => {
                  const next = event.target.value.replace(/\D/g, '').slice(0, 6);
                  setCode(next);
                }}
                helperText={t('scanAccounts.wizard.codeHelp')}
                autoFocus
              />
            </>
          )}

          {phase === 'password' && (
            <TextField
              label={t('scanAccounts.wizard.password')}
              size="small"
              type="password"
              fullWidth
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              helperText={t('scanAccounts.wizard.passwordHelp')}
              autoFocus
            />
          )}

          {phase === 'done' && (
            <>
              <Alert severity="success">
                {t('scanAccounts.wizard.success', {
                  name: account?.firstName || account?.username || account?.phone || '',
                })}
              </Alert>
              <TextField
                label={t('scanAccounts.wizard.label')}
                size="small"
                fullWidth
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                helperText={t('scanAccounts.wizard.labelHelp')}
              />
            </>
          )}

          {error && <Alert severity="error">{error}</Alert>}

          <Box>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {t('scanAccounts.securityNote')}
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={cancelLogin}>{t('actions.cancel')}</Button>
        {phase === 'keys' && (
          <Button
            variant="contained"
            disabled={submitting || !apiId || !apiHash.trim()}
            onClick={submitKeys}
          >
            {t('actions.next')}
          </Button>
        )}
        {phase === 'phone' && (
          <Button
            variant="contained"
            disabled={submitting || !/^\+?\d[\d\s()-]{6,}$/.test(phone.trim())}
            onClick={submitPhone}
          >
            {t('scanAccounts.wizard.sendCode')}
          </Button>
        )}
        {phase === 'code' && (
          <Button variant="contained" disabled={submitting || code.length < 4} onClick={submitCode}>
            {t('actions.next')}
          </Button>
        )}
        {phase === 'password' && (
          <Button variant="contained" disabled={submitting || !password} onClick={submitPassword}>
            {t('actions.next')}
          </Button>
        )}
        {phase === 'done' && (
          <Button variant="contained" onClick={finish}>
            {t('actions.done')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
