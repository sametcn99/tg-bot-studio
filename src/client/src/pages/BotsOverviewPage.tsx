import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import VerifiedIcon from '@mui/icons-material/Verified';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import { useBots } from '../context/BotContext';
import { useSnackbar } from '../context/SnackbarContext';
import StatusDot from '../components/StatusDot';
import PageHeader from '../components/PageHeader';
import OnboardingChecklist from '../components/OnboardingChecklist';
import { EmptyState } from '../components/Feedback';

/**
 * Global studio overview: high-density table and cards of every registered
 * bot with health status, module counts, Mini Apps, subscribers, and daily
 * message volume. Hosts the Add Bot wizard with Telegram getMe validation.
 * @returns {React.ReactElement} The overview page.
 */
export default function BotsOverviewPage(): React.ReactElement {
  const { t } = useTranslation();
  const { bots, refresh } = useBots();
  const navigate = useNavigate();
  const [wizardOpen, setWizardOpen] = useState(false);

  return (
    <Box>
      <PageHeader
        title={t('nav.overview')}
        subtitle={t('bots.overviewSubtitle', { n: bots.length })}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setWizardOpen(true)}>
            {t('bots.addTitle')}
          </Button>
        }
      />

      {bots.length === 0 ? (
        <>
          <OnboardingChecklist />
          <Card>
            <EmptyState
              message={t('bots.empty')}
              action={
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => setWizardOpen(true)}
                >
                  {t('bots.addTitle')}
                </Button>
              }
            />
          </Card>
        </>
      ) : (
        <>
          <Card sx={{ mb: 3, display: { xs: 'none', md: 'block' } }}>
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small" aria-label={t('nav.overview')}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('common.name')}</TableCell>
                    <TableCell>{t('common.status')}</TableCell>
                    <TableCell align="right">{t('bots.activeModules')}</TableCell>
                    <TableCell align="right">{t('bots.miniApps')}</TableCell>
                    <TableCell align="right">{t('bots.subscribers')}</TableCell>
                    <TableCell align="right">{t('bots.volume24h')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {bots.map((bot) => (
                    <TableRow
                      key={bot.id}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/bots/${bot.id}`)}
                    >
                      <TableCell>
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 600,
                          }}
                        >
                          {bot.name}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{
                            color: 'text.secondary',
                          }}
                        >
                          {bot.username ? `@${bot.username}` : `ID ${bot.id}`}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <StatusDot status={bot.status} />
                      </TableCell>
                      <TableCell align="right">{bot.activeModules}</TableCell>
                      <TableCell align="right">{bot.miniApps}</TableCell>
                      <TableCell align="right">{bot.subscribers}</TableCell>
                      <TableCell align="right">{bot.dailyVolume}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>

          <Grid container spacing={2} sx={{ display: { xs: 'flex', md: 'none' } }}>
            {bots.map((bot) => (
              <Grid size={{ xs: 12 }} key={bot.id}>
                <Card
                  onClick={() => navigate(`/bots/${bot.id}`)}
                  sx={{ cursor: 'pointer' }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${bot.name}. ${t('bots.subscribers')}: ${bot.subscribers}`}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      navigate(`/bots/${bot.id}`);
                    }
                  }}
                >
                  <CardContent>
                    <Stack spacing={1}>
                      <Typography variant="subtitle2">{bot.name}</Typography>
                      <StatusDot status={bot.status} />
                      <Typography
                        variant="caption"
                        sx={{
                          color: 'text.secondary',
                        }}
                      >
                        {t('bots.modulesSubscribers', {
                          modules: bot.activeModules,
                          subscribers: bot.subscribers,
                        })}
                      </Typography>
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </>
      )}

      <AddBotWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onCreated={refresh} />
    </Box>
  );
}

/**
 * Add Bot wizard dialog. Validates the BotFather token via Telegram getMe
 * before persisting the bot.
 * @param {object} props - Component props.
 * @param {boolean} props.open - Dialog visibility.
 * @param {() => void} props.onClose - Closes the dialog.
 * @param {() => void} props.onCreated - Refresh callback after creation.
 * @returns {React.ReactElement} The wizard dialog.
 */
function AddBotWizard({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { showError } = useSnackbar();
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [validated, setValidated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  /**
   * Validates the entered token against Telegram without persisting.
   * @returns {Promise<void>} Resolves after the check.
   */
  async function validateToken(): Promise<void> {
    setBusy(true);
    setError(null);
    setValidated(null);
    try {
      const result = await apiFetch<{
        ok: boolean;
        bot?: { username: string };
        description?: string;
      }>('/api/bots/validate', { method: 'POST', body: JSON.stringify({ token }) });
      if (result.ok && result.bot) {
        setValidated(`@${result.bot.username}`);
      } else {
        setError(result.description ?? t('bots.tokenRejected'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('bots.validationFailed'));
    } finally {
      setBusy(false);
    }
  }

  const [selectedPreset, setSelectedPreset] = useState<string>('none');

  /**
   * Persists the bot after a successful validation.
   * @returns {Promise<void>} Resolves after creation.
   */
  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const created = await apiFetch<{ id: number }>('/api/bots', {
        method: 'POST',
        body: JSON.stringify({ token, name }),
      });
      if (selectedPreset !== 'none') {
        // Bot creation succeeds even when the preset fails; surface the
        // preset error instead of silently swallowing it.
        await apiFetch(`/api/bots/${created.id}/presets/${selectedPreset}`, {
          method: 'POST',
        }).catch((err: unknown) => {
          showError(
            `${t('bots.presetFailed')}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }
      onCreated();
      onClose();
      setToken('');
      setName('');
      setValidated(null);
      setSelectedPreset('none');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('bots.creationFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      fullScreen={fullScreen}
      aria-labelledby="add-bot-dialog-title"
    >
      <DialogTitle id="add-bot-dialog-title">{t('bots.addTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label={t('bots.token')}
            value={token}
            onChange={(event) => {
              setToken(event.target.value);
              setValidated(null);
            }}
            fullWidth
            helperText={t('bots.tokenHint')}
          />
          <Button
            variant="outlined"
            onClick={() => void validateToken()}
            disabled={busy || token.length < 10}
          >
            {t('bots.validate')}
          </Button>
          {validated && (
            <Alert severity="success" icon={<VerifiedIcon fontSize="inherit" />}>
              {t('bots.validated')}: {validated}
            </Alert>
          )}
          <TextField
            label={`${t('bots.name')} ${t('common.optional')}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            fullWidth
          />
          {validated && (
            <TextField
              label={t('bots.presetLabel')}
              select
              size="small"
              value={selectedPreset}
              onChange={(event) => setSelectedPreset(event.target.value)}
              fullWidth
              helperText={t('bots.presetHint')}
            >
              <MenuItem value="none">{t('bots.presetNone')}</MenuItem>
              <MenuItem value="ecommerce">{t('bots.presetEcommerce')}</MenuItem>
              <MenuItem value="community">{t('bots.presetCommunity')}</MenuItem>
              <MenuItem value="support">{t('bots.presetSupport')}</MenuItem>
              <MenuItem value="growth">{t('bots.presetGrowth')}</MenuItem>
            </TextField>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.cancel')}</Button>
        <Button variant="contained" disabled={!validated || busy} onClick={() => void create()}>
          {t('actions.create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
