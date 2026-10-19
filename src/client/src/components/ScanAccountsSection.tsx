import React, { useCallback, useEffect, useState } from 'react';
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
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import ConfirmDialog from './ConfirmDialog';
import ScanAccountWizardDialog from './ScanAccountWizardDialog';
import { localizedErrorMessage } from '../utils/errors';

/** Scan account row as returned by the API. */
interface ScanAccountRow {
  id: string;
  phone: string;
  label: string | null;
  username: string | null;
  firstName: string | null;
  status: string;
  lastUsedAt: string | null;
}

/** Formats an ISO date compactly for the last-used column. */
function formatWhen(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : '—';
}

/**
 * Scan accounts panel for one bot: the MTProto user accounts available for
 * the file-search backfill. Connects via the login wizard, lists status,
 * renames and removes accounts.
 *
 * @param {object} props - Component props.
 * @param {string} props.botId - Active bot id.
 * @returns {React.ReactElement} The section.
 */
export default function ScanAccountsSection({ botId }: { botId: string }): React.ReactElement {
  const { t } = useTranslation();
  const theme = useTheme();
  const compactDialogs = useMediaQuery(theme.breakpoints.down('sm'));
  const [rows, setRows] = useState<ScanAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [renaming, setRenaming] = useState<ScanAccountRow | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<ScanAccountRow | null>(null);

  /**
   * Reloads the account list.
   */
  const refresh = useCallback((): void => {
    apiFetch<ScanAccountRow[]>(`/api/bots/${botId}/scan-accounts`)
      .then(setRows)
      .catch((err: Error) => setError(localizedErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [botId]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  /**
   * Saves the rename dialog.
   */
  function submitRename(): void {
    if (!renaming) return;
    apiFetch(`/api/bots/${botId}/scan-accounts/${renaming.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ label: renameValue }),
    })
      .then(() => {
        setRenaming(null);
        refresh();
      })
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }

  /**
   * Confirms deletion (server logs the session out best-effort).
   */
  function confirmDelete(): void {
    if (!deleting) return;
    apiFetch(`/api/bots/${botId}/scan-accounts/${deleting.id}`, { method: 'DELETE' })
      .then(() => {
        setDeleting(null);
        refresh();
      })
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }

  /**
   * Human display name for an account.
   */
  function displayName(row: ScanAccountRow): string {
    return row.firstName || row.username || row.phone;
  }

  return (
    <Card>
      <CardContent>
        <Stack
          direction="row"
          sx={{
            justifyContent: 'space-between',
            alignItems: 'center',
            mb: 2,
            flexWrap: 'wrap',
            gap: 1,
          }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <PersonSearchIcon color="action" fontSize="small" />
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {t('scanAccounts.title')}
            </Typography>
            {!loading && <Chip size="small" label={rows.length} />}
          </Stack>
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setWizardOpen(true)}
          >
            {t('scanAccounts.add')}
          </Button>
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('common.loading')}
          </Typography>
        ) : rows.length === 0 ? (
          <Stack spacing={1} sx={{ py: 2 }}>
            <Alert severity="info">{t('scanAccounts.empty')}</Alert>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {t('scanAccounts.securityNote')}
            </Typography>
          </Stack>
        ) : (
          <>
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small" aria-label={t('scanAccounts.title')}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('scanAccounts.colAccount')}</TableCell>
                    <TableCell>{t('scanAccounts.colPhone')}</TableCell>
                    <TableCell>{t('scanAccounts.colLabel')}</TableCell>
                    <TableCell>{t('scanAccounts.colStatus')}</TableCell>
                    <TableCell>{t('scanAccounts.colLastUsed')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Stack spacing={0.25}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {displayName(row)}
                          </Typography>
                          {row.username && (
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              @{row.username}
                            </Typography>
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                          {row.phone}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {row.label ? (
                          <Chip size="small" variant="outlined" label={row.label} />
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          color={row.status === 'active' ? 'success' : 'error'}
                          label={
                            row.status === 'active'
                              ? t('scanAccounts.statusActive')
                              : t('scanAccounts.statusExpired')
                          }
                        />
                      </TableCell>
                      <TableCell>{formatWhen(row.lastUsedAt)}</TableCell>
                      <TableCell align="right">
                        <Tooltip title={t('scanAccounts.rename')}>
                          <IconButton
                            size="small"
                            aria-label={`${t('scanAccounts.rename')} ${displayName(row)}`}
                            onClick={() => {
                              setRenaming(row);
                              setRenameValue(row.label ?? '');
                            }}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('actions.delete')}>
                          <IconButton
                            size="small"
                            aria-label={`${t('actions.delete')} ${displayName(row)}`}
                            onClick={() => setDeleting(row)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t('scanAccounts.securityNote')}
              </Typography>
            </Box>
          </>
        )}
      </CardContent>

      <ScanAccountWizardDialog
        open={wizardOpen}
        botId={botId}
        onClose={() => setWizardOpen(false)}
        onConnected={() => {
          setWizardOpen(false);
          refresh();
        }}
      />

      <Dialog
        open={Boolean(renaming)}
        onClose={() => setRenaming(null)}
        maxWidth="xs"
        fullWidth
        fullScreen={compactDialogs}
      >
        <DialogTitle>{t('scanAccounts.renameTitle')}</DialogTitle>
        <DialogContent>
          <TextField
            label={t('scanAccounts.labelField')}
            size="small"
            fullWidth
            sx={{ mt: 1 }}
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenaming(null)}>{t('actions.cancel')}</Button>
          <Button variant="contained" onClick={submitRename}>
            {t('actions.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={t('actions.delete')}
        message={t('scanAccounts.deleteConfirm', { name: deleting ? displayName(deleting) : '' })}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </Card>
  );
}
