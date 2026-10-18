import React, { useEffect, useMemo, useState } from 'react';
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
  MenuItem,
  Stack,
  Table,
  TableContainer,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import SearchIcon from '@mui/icons-material/Search';
import DownloadIcon from '@mui/icons-material/Download';
import { useTranslation } from 'react-i18next';
import { apiDownload, apiFetch } from '../../services/api';
import { useApi } from '../../hooks/useApi';
import { parseUsersPage } from '../../utils/usersPage';
import PageHeader from '../../components/PageHeader';
import { LoadingState } from '../../components/Feedback';
import { useSnackbar } from '../../context/SnackbarContext';
import { useModuleDocs } from '../../context/ModuleDocsContext';
import { formatDateTime } from '../../utils/format';
import type { ModuleEntry } from '../../registry/modules';
import { localizedErrorMessage } from '../../utils/errors';

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
 * Audience CRM & Segmentation page: server-paginated subscriber table with
 * server-side search and tag filtering, tag and note editing, plus CSV/JSON
 * export.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {ModuleEntry} props.module - CRM catalog entry.
 * @returns {React.ReactElement} The page.
 */
export default function UsersCrmPage({
  botId,
  module,
}: {
  botId: string;
  module: ModuleEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [editing, setEditing] = useState<CrmUser | null>(null);
  const { openDocs } = useModuleDocs();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [orderBy, setOrderBy] = useState<'name' | 'points' | 'last_seen_at'>('last_seen_at');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');

  // Debounced search: keystrokes land in the query only after a short pause.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const queryParams = new URLSearchParams({
    page: String(page + 1),
    pageSize: String(rowsPerPage),
  });
  if (search) queryParams.set('search', search);
  if (tag) queryParams.set('tag', tag);
  const query = queryParams.toString();

  const {
    data,
    error: loadError,
    loading,
    reload,
  } = useApi<unknown>(`/api/bots/${botId}/users?${query}`, [botId, search, tag, page, rowsPerPage]);

  // Distinct tag inventory for the filter dropdown (single page, tiny).
  const { data: tagsData } = useApi<string[]>(`/api/bots/${botId}/users/tags/distinct`, [botId]);
  const availableTags = useMemo(() => tagsData ?? [], [tagsData]);

  const usersPage = useMemo(
    () => parseUsersPage<CrmUser>(data, page + 1, rowsPerPage),
    [data, page, rowsPerPage],
  );
  const users = usersPage.items;
  const [error, setError] = useState<string | null>(null);

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
        showSuccess(t('crm.profileUpdated'));
        reload();
      })
      .catch((err: unknown) => {
        const message = localizedErrorMessage(err);
        setError(message);
        showError(message);
      });
  }

  const sorted = React.useMemo(() => {
    if (!users) return [];
    return [...users].sort((a, b) => {
      if (orderBy === 'points') {
        const diff = a.points - b.points;
        return order === 'desc' ? -diff : diff;
      }
      if (orderBy === 'last_seen_at') {
        const aVal = a.last_seen_at ?? '';
        const bVal = b.last_seen_at ?? '';
        const diff = aVal.localeCompare(bVal);
        return order === 'desc' ? -diff : diff;
      }
      const aName = `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim();
      const bName = `${b.first_name ?? ''} ${b.last_name ?? ''}`.trim();
      const diff = aName.localeCompare(bName);
      return order === 'desc' ? -diff : diff;
    });
  }, [users, orderBy, order]);

  return (
    <Box>
      <PageHeader
        title={module.name}
        subtitle={module.description}
        onDocs={() => openDocs(module)}
        actions={
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              startIcon={<DownloadIcon />}
              onClick={() =>
                void apiDownload(`/api/bots/${botId}/users/export/csv`, 'audience.csv')
              }
            >
              CSV
            </Button>
            <Button
              size="small"
              startIcon={<DownloadIcon />}
              onClick={() =>
                void apiDownload(`/api/bots/${botId}/users/export/json`, 'audience.json')
              }
            >
              JSON
            </Button>
          </Stack>
        }
      />

      {(loadError || error) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {loadError ?? error}
        </Alert>
      )}

      <Card>
        {loading && data === null ? (
          <LoadingState label={t('common.loading')} />
        ) : (
          <>
            <Stack
              direction="row"
              sx={{ p: 2, flexWrap: 'wrap', gap: 1 }}
              spacing={{ xs: 1, sm: 2 }}
            >
              <TextField
                size="small"
                placeholder={t('common.search')}
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                sx={{ maxWidth: 360, flex: 1 }}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  },
                }}
              />
              <TextField
                select
                size="small"
                label={t('crm.tagFilter')}
                value={tag}
                onChange={(event) => {
                  setTag(event.target.value);
                  setPage(0);
                }}
                sx={{ minWidth: 180 }}
                disabled={availableTags.length === 0}
              >
                <MenuItem value="">{t('crm.allTags')}</MenuItem>
                {availableTags.map((option) => (
                  <MenuItem key={option} value={option}>
                    {option}
                  </MenuItem>
                ))}
              </TextField>
              <Box sx={{ flexGrow: 1 }} />
              <Typography
                variant="caption"
                sx={{
                  color: 'text.secondary',
                  alignSelf: 'center',
                }}
              >
                {t('crm.subscriberCount', { count: usersPage.total })}
              </Typography>
            </Stack>
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small" aria-label={t('crm.tableAria')}>
                <TableHead>
                  <TableRow>
                    <TableCell>
                      <TableSortLabel
                        active={orderBy === 'name'}
                        direction={orderBy === 'name' ? order : 'asc'}
                        onClick={() => {
                          const isAsc = orderBy === 'name' && order === 'asc';
                          setOrder(isAsc ? 'desc' : 'asc');
                          setOrderBy('name');
                        }}
                      >
                        {t('crm.user')}
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>{t('crm.language')}</TableCell>
                    <TableCell align="right">
                      <TableSortLabel
                        active={orderBy === 'points'}
                        direction={orderBy === 'points' ? order : 'asc'}
                        onClick={() => {
                          const isAsc = orderBy === 'points' && order === 'asc';
                          setOrder(isAsc ? 'desc' : 'asc');
                          setOrderBy('points');
                        }}
                      >
                        {t('crm.points')}
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>{t('crm.tags')}</TableCell>
                    <TableCell>
                      <TableSortLabel
                        active={orderBy === 'last_seen_at'}
                        direction={orderBy === 'last_seen_at' ? order : 'asc'}
                        onClick={() => {
                          const isAsc = orderBy === 'last_seen_at' && order === 'asc';
                          setOrder(isAsc ? 'desc' : 'asc');
                          setOrderBy('last_seen_at');
                        }}
                      >
                        {t('crm.lastSeen')}
                      </TableSortLabel>
                    </TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sorted.map((user) => (
                    <TableRow key={user.telegram_id}>
                      <TableCell>
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 600,
                          }}
                        >
                          {user.first_name ?? t('crm.unknown')} {user.last_name ?? ''}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{
                            color: 'text.secondary',
                          }}
                        >
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
                      <TableCell>{formatDateTime(user.last_seen_at)}</TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={() => setEditing(user)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                  {sorted.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <Typography
                          align="center"
                          sx={{
                            color: 'text.secondary',
                            py: 3,
                          }}
                        >
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
              count={usersPage.total}
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
          {editing?.first_name ?? t('crm.subscriber')} - {editing?.telegram_id}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label={t('crm.tagsLabel')}
              value={editing?.tags.join(', ') ?? ''}
              onChange={(event) =>
                setEditing((current) =>
                  current
                    ? {
                        ...current,
                        tags: event.target.value
                          .split(',')
                          .map((entry) => entry.trim())
                          .filter(Boolean),
                      }
                    : current,
                )
              }
              fullWidth
              size="small"
            />
            <TextField
              label={t('crm.internalNotes')}
              multiline
              minRows={3}
              value={editing?.notes ?? ''}
              onChange={(event) =>
                setEditing((current) =>
                  current ? { ...current, notes: event.target.value } : current,
                )
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
    </Box>
  );
}
