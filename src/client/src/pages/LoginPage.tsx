import React, { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import HubIcon from '@mui/icons-material/Hub';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Master key sign-in page for the studio dashboard.
 * @returns {React.ReactElement} The login form.
 */
export default function LoginPage(): React.ReactElement {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [masterKey, setMasterKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Submits the master key and redirects on success.
   * @param {React.FormEvent} event - Form submit event.
   * @returns {Promise<void>} Resolves after the attempt.
   */
  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(masterKey);
      navigate('/', { replace: true });
    } catch {
      setError(t('login.invalid'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Card sx={{ width: '100%', maxWidth: 400 }}>
        <CardContent sx={{ p: 4 }}>
          <Stack
            spacing={1}
            sx={{
              alignItems: 'center',
              mb: 3,
            }}
          >
            <HubIcon color="primary" sx={{ fontSize: 40 }} aria-hidden="true" />
            <Typography
              variant="h6"
              component="h1"
              sx={{
                fontWeight: 700,
              }}
            >
              {t('login.title')}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: 'text.secondary',
                textAlign: 'center',
              }}
            >
              {t('login.hint')}
            </Typography>
          </Stack>
          <form onSubmit={(event) => void submit(event)}>
            <Stack spacing={2}>
              <TextField
                label={t('login.masterKey')}
                type="password"
                value={masterKey}
                onChange={(event) => setMasterKey(event.target.value)}
                autoComplete="current-password"
                autoFocus
                fullWidth
                required
              />
              {error && <Alert severity="error">{error}</Alert>}
              <Button type="submit" variant="contained" disabled={busy} fullWidth>
                {busy ? '...' : t('login.submit')}
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}
