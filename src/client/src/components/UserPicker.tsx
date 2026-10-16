import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import { parseUsersPage } from '../utils/usersPage';
import { formatDateTime } from '../utils/format';

/** Page size requested from the server per load (page 1 + "load more"). */
const PAGE_SIZE = 50;

/**
 * Subscriber row returned by the CRM list endpoint.
 * @interface CrmUser
 */
interface CrmUser {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  last_seen_at?: string | null;
}

/**
 * Subscriber picker: searchable modal over the Audience CRM endpoint (server
 * side search + paging with a "load more" button) so operators can target
 * real subscribers (VIP grants, broadcast tests) instead of typing raw
 * Telegram ids. Manual numeric entry stays available.
 * @param {object} props - Component props.
 * @param {number | string} props.botId - Active bot id.
 * @param {string | number} props.value - Currently selected Telegram id.
 * @param {(value: number) => void} props.onChange - Selection callback.
 * @param {string} [props.label] - Field label.
 * @param {string} [props.helperText] - Helper text under the field.
 * @returns {React.ReactElement} The picker field.
 */
export default function UserPicker({
  botId,
  value,
  onChange,
  label,
  helperText,
}: {
  botId: number | string;
  value: string | number;
  onChange: (value: number) => void;
  label?: string;
  helperText?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<CrmUser[] | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce keystrokes into the server query; reset the list when it lands.
  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
      setUsers(null);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchInput, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (search) params.set('search', search);
    apiFetch<unknown>(`/api/bots/${botId}/users?${params.toString()}`)
      .then((payload) => {
        if (cancelled) return;
        const result = parseUsersPage<CrmUser>(payload, page, PAGE_SIZE);
        setTotal(result.total);
        setUsers((current) => (page === 1 ? result.items : [...(current ?? []), ...result.items]));
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setUsers((current) => current ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, search, page, botId]);

  const loadedCount = users?.length ?? 0;
  const hasMore = loadedCount < total;

  /**
   * Builds a display name for a subscriber row.
   * @param {CrmUser} user - Subscriber row.
   * @returns {string} Name, @username, or #id fallback.
   */
  function displayName(user: CrmUser): string {
    return (
      [user.first_name, user.last_name].filter(Boolean).join(' ') ||
      (user.username ? `@${user.username}` : `#${user.telegram_id}`)
    );
  }

  return (
    <Stack spacing={0.5}>
      <TextField
        label={label ?? t('userPicker.label')}
        value={value === 0 || value === '' ? '' : String(value)}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        size="small"
        fullWidth
        type="number"
        helperText={helperText}
        slotProps={{
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <Button
                  size="small"
                  startIcon={<PersonSearchIcon fontSize="small" />}
                  onClick={() => setOpen(true)}
                  sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
                >
                  {t('userPicker.pick')}
                </Button>
              </InputAdornment>
            ),
          },
        }}
      />
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="xs"
        fullWidth
        aria-labelledby="user-picker-title"
      >
        <DialogTitle
          id="user-picker-title"
          sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Typography
            variant="subtitle1"
            sx={{
              fontWeight: 700,
            }}
          >
            {t('userPicker.title')}
          </Typography>
          <IconButton size="small" aria-label={t('actions.close')} onClick={() => setOpen(false)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ pt: 1 }}>
          <TextField
            size="small"
            fullWidth
            placeholder={t('userPicker.searchPlaceholder')}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              },
            }}
            sx={{ mb: 1 }}
          />
          {error && (
            <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1 }}>
              {error}
            </Typography>
          )}
          <Box sx={{ maxHeight: 320, overflowY: 'auto' }}>
            {users === null ? (
              <Typography
                variant="body2"
                sx={{
                  color: 'text.secondary',
                  p: 2,
                }}
              >
                {t('common.loading')}
              </Typography>
            ) : users.length === 0 ? (
              <Typography
                variant="body2"
                sx={{
                  color: 'text.secondary',
                  p: 2,
                }}
              >
                {t('userPicker.empty')}
              </Typography>
            ) : (
              <List dense disablePadding>
                {users.map((user) => (
                  <ListItemButton
                    key={user.telegram_id}
                    onClick={() => {
                      onChange(user.telegram_id);
                      setOpen(false);
                    }}
                  >
                    <ListItemText
                      primary={displayName(user)}
                      secondary={
                        user.last_seen_at
                          ? `${user.telegram_id} · ${t('crm.lastSeen')}: ${formatDateTime(user.last_seen_at)}`
                          : String(user.telegram_id)
                      }
                      slotProps={{
                        primary: { variant: 'body2', sx: { fontWeight: 600 } },
                        secondary: { variant: 'caption' },
                      }}
                    />
                  </ListItemButton>
                ))}
              </List>
            )}
          </Box>
          {hasMore && users !== null && (
            <Button size="small" fullWidth disabled={loading} onClick={() => setPage(page + 1)}>
              {loading ? t('common.loading') : t('userPicker.loadMore')}
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
