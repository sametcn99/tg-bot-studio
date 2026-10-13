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
import { formatDateTime } from '../utils/format';

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
 * Subscriber picker: searchable modal over the Audience CRM endpoint so
 * operators can target real subscribers (VIP grants, broadcast tests)
 * instead of typing raw Telegram ids. Manual numeric entry stays available.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
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
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<CrmUser[] | null>(null);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      apiFetch<CrmUser[]>(`/api/bots/${botId}/users?search=${encodeURIComponent(search)}`)
        .then(setUsers)
        .catch(() => setUsers([]));
    }, 300);
    return () => window.clearTimeout(handle);
  }, [open, search, botId]);

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
        InputProps={{
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
          <Typography variant="subtitle1" fontWeight={700}>
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
            value={search}
            onChange={(event) => setSearch(event.target.value)}
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
          <Box sx={{ maxHeight: 320, overflowY: 'auto' }}>
            {users === null ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                {t('common.loading')}
              </Typography>
            ) : users.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
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
                      primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }}
                      secondaryTypographyProps={{ variant: 'caption' }}
                    />
                  </ListItemButton>
                ))}
              </List>
            )}
          </Box>
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
