import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';

/** Federation summary row from GET /bots/:id/federation. */
interface FedSummary {
  id: string;
  name: string;
  ownerTelegramId: string;
  createdAt: string | null;
  chatCount: number;
  totalChatCount: number;
  banCount: number;
  adminCount: number;
}

/** Ban row from GET /bots/:id/federation/:fedId/bans. */
interface FedBanRow {
  telegramId: string;
  reason: string;
  bannedBy: string;
  createdAt: string | null;
}

/**
 * Embedded federation manager rendered under the federation module config:
 * lists federations with counts, adds dashboard fbans, and imports
 * CSV/NDJSON ban lists (reference-compatible formats).
 */
export default function FederationManager({ botId }: { botId: number }): React.ReactElement {
  const { t } = useTranslation();
  const [feds, setFeds] = useState<FedSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [banDialogFed, setBanDialogFed] = useState<FedSummary | null>(null);
  const [bansFor, setBansFor] = useState<FedSummary | null>(null);
  const [bans, setBans] = useState<FedBanRow[]>([]);
  const [banForm, setBanForm] = useState({ telegramId: '', reason: '' });

  /**
   * Reloads the federation summaries.
   */
  const refresh = React.useCallback((): void => {
    apiFetch<FedSummary[]>(`/api/bots/${botId}/federation`)
      .then(setFeds)
      .catch((err: Error) => setError(err.message));
  }, [botId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * Opens the ban list of a federation.
   */
  function openBans(fed: FedSummary): void {
    setBansFor(fed);
    apiFetch<FedBanRow[]>(`/api/bots/${botId}/federation/${fed.id}/bans`)
      .then(setBans)
      .catch((err: Error) => setError(err.message));
  }

  /**
   * Submits the dashboard fban dialog.
   */
  function submitBan(): void {
    if (!banDialogFed || !banForm.telegramId.trim()) return;
    apiFetch(`/api/bots/${botId}/federation/${banDialogFed.id}/bans`, {
      method: 'POST',
      body: JSON.stringify({
        telegramId: Number(banForm.telegramId.trim()),
        reason: banForm.reason.trim() || 'Banned from dashboard',
      }),
    })
      .then(() => {
        setBanDialogFed(null);
        setBanForm({ telegramId: '', reason: '' });
        refresh();
      })
      .catch((err: Error) => setError(err.message));
  }

  /**
   * Imports a ban list file (CSV or NDJSON) into a federation.
   */
  function importList(fed: FedSummary, file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      apiFetch<{ imported: number }>(`/api/bots/${botId}/federation/${fed.id}/import`, {
        method: 'POST',
        body: JSON.stringify({ content: String(reader.result ?? '') }),
      })
        .then((result) => {
          setError(null);
          refresh();
          void result.imported;
        })
        .catch((err: Error) => setError(err.message));
    };
    reader.readAsText(file);
  }

  return (
    <Card variant="outlined" sx={{ mt: 3 }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="subtitle1" fontWeight={700}>
            {t('federation.managerTitle')}
          </Typography>
          <Chip size="small" label={`${feds.length}`} />
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {feds.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('federation.managerEmpty')}
          </Typography>
        )}

        <Stack spacing={2}>
          {feds.map((fed) => (
            <Box key={fed.id}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', sm: 'center' }}
                spacing={1}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle2" fontWeight={700} noWrap>
                    {fed.name}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ fontFamily: 'monospace' }}
                    noWrap
                  >
                    {fed.id}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Chip size="small" label={t('federation.chipChats', { count: fed.chatCount })} />
                  <Chip size="small" label={t('federation.chipBans', { count: fed.banCount })} />
                  <Button size="small" startIcon={<AddIcon />} onClick={() => setBanDialogFed(fed)}>
                    {t('federation.addBan')}
                  </Button>
                  <Button size="small" onClick={() => openBans(fed)}>
                    {t('federation.viewBans')}
                  </Button>
                  <Button size="small" component="label" startIcon={<UploadFileIcon />}>
                    {t('federation.import')}
                    <input
                      type="file"
                      accept=".csv,.json,.txt"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) importList(fed, file);
                        event.target.value = '';
                      }}
                    />
                  </Button>
                </Stack>
              </Stack>
            </Box>
          ))}
        </Stack>
      </CardContent>

      {/* Dashboard fban dialog */}
      <Dialog
        open={Boolean(banDialogFed)}
        onClose={() => setBanDialogFed(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {t('federation.addBan')} — {banDialogFed?.name}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label={t('federation.telegramId')}
              value={banForm.telegramId}
              onChange={(event) =>
                setBanForm((prev) => ({ ...prev, telegramId: event.target.value }))
              }
              fullWidth
            />
            <TextField
              label={t('federation.reason')}
              value={banForm.reason}
              onChange={(event) => setBanForm((prev) => ({ ...prev, reason: event.target.value }))}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBanDialogFed(null)}>{t('actions.cancel')}</Button>
          <Button variant="contained" onClick={submitBan}>
            {t('actions.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Ban list dialog */}
      <Dialog open={Boolean(bansFor)} onClose={() => setBansFor(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {t('federation.viewBans')} — {bansFor?.name}
        </DialogTitle>
        <DialogContent>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('federation.telegramId')}</TableCell>
                  <TableCell>{t('federation.reason')}</TableCell>
                  <TableCell>{t('federation.bannedBy')}</TableCell>
                  <TableCell>{t('federation.date')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {bans.map((ban) => (
                  <TableRow key={ban.telegramId}>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{ban.telegramId}</TableCell>
                    <TableCell>{ban.reason}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{ban.bannedBy}</TableCell>
                    <TableCell>{ban.createdAt ?? '—'}</TableCell>
                  </TableRow>
                ))}
                {bans.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Typography variant="body2" color="text.secondary" align="center">
                        {t('federation.noBans')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBansFor(null)}>{t('actions.close')}</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
