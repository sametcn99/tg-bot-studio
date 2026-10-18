import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
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
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PersonOffIcon from '@mui/icons-material/PersonOff';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';

/** Blocked user row from GET /bots/:id/moderation/blocked. */
interface BlockedUserRow {
  telegramId: number | string;
  username: string | null;
  firstName: string | null;
  reason: string | null;
  blockedAt: string | null;
}

/**
 * Embedded manager for the moderation module's studio-wide ban list: lists
 * blocked users, adds manual bans (id or @username), and lifts bans. This
 * backs the `/bots/:botId/moderation/blocked` CRUD endpoints.
 */
export default function BlockedUsersManager({ botId }: { botId: string }): React.ReactElement {
  const { t } = useTranslation();
  const theme = useTheme();
  const compactDialogs = useMediaQuery(theme.breakpoints.down('sm'));
  const [rows, setRows] = useState<BlockedUserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ telegramId: '', reason: '' });

  /**
   * Reloads the blocked user list.
   */
  const refresh = useCallback((): void => {
    apiFetch<BlockedUserRow[]>(`/api/bots/${botId}/moderation/blocked`)
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  }, [botId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * Submits the manual ban dialog.
   */
  function submit(): void {
    const raw = form.telegramId.trim().replace(/^@/, '');
    if (!raw) return;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setError(t('moderation.invalidTelegramId'));
      return;
    }
    setError(null);
    apiFetch(`/api/bots/${botId}/moderation/blocked`, {
      method: 'POST',
      body: JSON.stringify({
        telegramId: numeric,
        username: raw !== String(numeric) ? raw : undefined,
        reason: form.reason.trim() || undefined,
      }),
    })
      .then(() => {
        setDialogOpen(false);
        setForm({ telegramId: '', reason: '' });
        refresh();
      })
      .catch((err: Error) => setError(err.message));
  }

  /**
   * Lifts a ban.
   */
  function unblock(telegramId: number | string): void {
    apiFetch(`/api/bots/${botId}/moderation/blocked/${telegramId}`, { method: 'DELETE' })
      .then(refresh)
      .catch((err: Error) => setError(err.message));
  }

  return (
    <Card variant="outlined" sx={{ mt: 3 }}>
      <CardContent>
        <Stack
          direction="row"
          sx={{
            justifyContent: 'space-between',
            alignItems: 'center',
            mb: 2,
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: 'center',
            }}
          >
            <PersonOffIcon color="action" fontSize="small" />
            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 700,
              }}
            >
              {t('moderation.blockedTitle')}
            </Typography>
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: 'center',
            }}
          >
            <Chip size="small" label={rows.length} />
            <Button
              size="small"
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setDialogOpen(true)}
            >
              {t('moderation.blockButton')}
            </Button>
          </Stack>
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {rows.length === 0 ? (
          <Typography
            variant="body2"
            sx={{
              color: 'text.secondary',
            }}
          >
            {t('moderation.blockedEmpty')}
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('moderation.colTelegramId')}</TableCell>
                  <TableCell>{t('moderation.colUser')}</TableCell>
                  <TableCell>{t('moderation.colReason')}</TableCell>
                  <TableCell>{t('moderation.colBlockedAt')}</TableCell>
                  <TableCell align="right">{t('moderation.colActions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={String(row.telegramId)}>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{String(row.telegramId)}</TableCell>
                    <TableCell>
                      {row.username ? `@${row.username}` : (row.firstName ?? '—')}
                    </TableCell>
                    <TableCell>{row.reason ?? '—'}</TableCell>
                    <TableCell>{row.blockedAt ?? '—'}</TableCell>
                    <TableCell align="right">
                      <Button size="small" color="error" onClick={() => unblock(row.telegramId)}>
                        {t('moderation.unblock')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth="xs"
        fullWidth
        fullScreen={compactDialogs}
      >
        <DialogTitle>{t('moderation.blockButton')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label={t('moderation.colTelegramId')}
              value={form.telegramId}
              onChange={(event) => setForm((prev) => ({ ...prev, telegramId: event.target.value }))}
              fullWidth
            />
            <TextField
              label={t('moderation.colReason')}
              value={form.reason}
              onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))}
              fullWidth
            />
            <Typography
              variant="caption"
              sx={{
                color: 'text.secondary',
              }}
            >
              {t('moderation.blockHelp')}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('actions.cancel')}</Button>
          <Button variant="contained" onClick={submit}>
            {t('moderation.blockButton')}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
