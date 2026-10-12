import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  Table,
  TableContainer,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import SearchIcon from '@mui/icons-material/Search';
import DownloadIcon from '@mui/icons-material/Download';
import { useTranslation } from 'react-i18next';
import { apiDownload, apiFetch } from '../../services/api';
import PageHeader from '../../components/PageHeader';
import { LoadingState } from '../../components/Feedback';
import ModuleHelpDialog from '../../components/ModuleHelpDialog';
import type { ModuleEntry } from '../../registry/modules';

/**
 * CRM subscriber profile.
 * @interface CrmUser
 * @property {number} telegram_id - Subscriber Telegram id.
 * @property {string} [username] - Telegram @username.
 * @property {string} [first_name] - First name.
 * @property {string} language_code - Client language.
 * @property {number} points - Point balance.
 * @property {number} [referrer_id] - Referrer Telegram id.
 * @property {string[]} tags - Operator tags.
 * @property {string} notes - Operator notes.
 * @property {string} last_seen_at - Last activity timestamp.
 */
interface CrmUser {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string | null;
  points: number;
  referrer_id: number | null;
  tags: string[];
  notes: string;
  last_seen_at: string | null;
}

/**
 * Audience CRM & Segmentation page: searchable subscriber table with tag and
 * note editing plus CSV/JSON export.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {ModuleEntry} props.module - CRM catalog entry.
 * @returns {React.ReactElement} The page.
 */
export default function UsersCrmPage({
  botId,
  module,
}: {
  botId: number;
  module: ModuleEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  const [users, setUsers] = useState<CrmUser[] | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CrmUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  useEffect(() => {
    reload();
  }, [botId, search]);

  /**
   * Reloads the audience with the current search filter.
   * @returns {void}
   */
  function reload(): void {
    apiFetch<CrmUser[]>(`/api/bots/${botId}/users?search=${encodeURIComponent(search)}`)
      .then(setUsers)
      .catch((err: Error) => setError(err.message));
  }

  /**
   * Saves tags and notes for a subscriber.
   * @returns {void}
   */
  function saveEditing(): void {
    if (!editing) return;
    apiFetch(`/api/bots/${botId}/users/${editing.telegram_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ tags: editing.tags, notes: editing.notes }),
    })
      .then(() => {
        setEditing(null);
        reload();
      })
      .catch((err: Error) => setError(err.message));
  }

  const paged = (users ?? []).slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Box>
      <PageHeader
        title={module.name}
        subtitle={module.description}
        onDocs={() => setDocsOpen(true)}
        actions={
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              startIcon={<DownloadIcon />}
              onClick={() => void apiDownload(`/api/bots/${botId}/users/export/csv`, 'audience.csv')}
            >
              CSV
            </Button>
            <Button
              size="small"
              startIcon={<DownloadIcon />}
              onClick={() => void apiDownload(`/api/bots/${botId}/users/export/json`, 'audience.json')}
            >
              JSON
            </Button>
          </Stack>
        }
      />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Card>
        {users === null ? (
          <LoadingState label={t('common.loading')} />
        ) : (
        <>
        <Stack direction="row" sx={{ p: 2 }}>
          <TextField
            size="small"
            placeholder={t('common.search')}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ maxWidth: 360 }}
          />
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
            {(users ?? []).length} subscribers
          </Typography>
        </Stack>
        <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label="Audience CRM subscribers">
          <TableHead>
            <TableRow>
              <TableCell>User</TableCell>
              <TableCell>Language</TableCell>
              <TableCell align="right">Points</TableCell>
              <TableCell>Tags</TableCell>
              <TableCell>Last seen</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paged.map((user) => (
              <TableRow key={user.telegram_id}>
                <TableCell>
                  <Typography variant="body2" fontWeight={600}>
                    {user.first_name ?? 'Unknown'} {user.last_name ?? ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {user.username ? `@${user.username} ` : ''}
                    {user.telegram_id}
                  </Typography>
                </TableCell>
                <TableCell>{user.language_code ?? '-'}</TableCell>
                <TableCell align="right">{user.points}</TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                    {user.tags.map((tag) => (
                      <Chip key={tag} size="small" label={tag} />
                    ))}
                  </Stack>
                </TableCell>
                <TableCell>{user.last_seen_at?.slice(0, 19).replace('T', ' ') ?? '-'}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => setEditing(user)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {users !== null && users.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography color="text.secondary" align="center" sx={{ py: 3 }}>
                    {t('common.empty')}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
          </TableContainer>
        <TablePagination
          component="div"
          count={(users ?? []).length}
          page={page}
          onPageChange={(_event, value: number) => setPage(value)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(event) => {
            setRowsPerPage(Number(event.target.value));
            setPage(0);
          }}
          rowsPerPageOptions={[10, 25, 50, 100]}
        />
        </>
        )}
      </Card>

      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editing?.first_name ?? 'Subscriber'} - {editing?.telegram_id}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Tags (comma separated)"
              value={editing?.tags.join(', ') ?? ''}
              onChange={(event) =>
                setEditing((current) =>
                  current
                    ? {
                        ...current,
                        tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean),
                      }
                    : current,
                )
              }
              fullWidth
              size="small"
            />
            <TextField
              label="Internal notes"
              multiline
              minRows={3}
              value={editing?.notes ?? ''}
              onChange={(event) =>
                setEditing((current) => (current ? { ...current, notes: event.target.value } : current))
              }
              fullWidth
              size="small"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>{t('actions.cancel')}</Button>
          <Button variant="contained" onClick={saveEditing}>
            {t('actions.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <ModuleHelpDialog module={docsOpen ? module : null} onClose={() => setDocsOpen(false)} />
    </Box>
  );
}
