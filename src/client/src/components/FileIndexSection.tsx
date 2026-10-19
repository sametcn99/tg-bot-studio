import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  InputAdornment,
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
import SearchIcon from '@mui/icons-material/Search';
import FindInPageIcon from '@mui/icons-material/FindInPage';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';

/** Indexed file row from GET /bots/:id/file-index. */
interface FileIndexRow {
  id: string;
  chatId: string;
  messageId: number;
  kind: string;
  fileName: string | null;
  caption: string | null;
  fileSize: number | null;
  senderName: string | null;
  sentAt: string | null;
}

/**
 * Formats a byte count compactly.
 * @param {number | null} bytes - Size in bytes.
 * @returns {string} Human-readable size or a dash.
 */
function formatSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Embedded manager for the group file-search module's index: lists the
 * files indexed from targeted chats with a free-text filter, links to the
 * original Telegram messages, and drops stale rows.
 */
export default function FileIndexSection({ botId }: { botId: string }): React.ReactElement {
  const { t } = useTranslation();
  const [rows, setRows] = useState<FileIndexRow[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  /**
   * Reloads the index with the current free-text filter.
   */
  const refresh = useCallback((): void => {
    const suffix = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
    apiFetch<FileIndexRow[]>(`/api/bots/${botId}/file-index${suffix}`)
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  }, [botId, query]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * Deletes one indexed row.
   */
  function remove(id: string): void {
    apiFetch(`/api/bots/${botId}/file-index/${id}`, { method: 'DELETE' })
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
            flexWrap: 'wrap',
            gap: 1,
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: 'center',
            }}
          >
            <FindInPageIcon color="action" fontSize="small" />
            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 700,
              }}
            >
              {t('fileIndex.title')}
            </Typography>
            <Chip size="small" label={rows.length} />
          </Stack>
          <TextField
            size="small"
            placeholder={t('fileIndex.searchPlaceholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            sx={{ width: 260 }}
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
            {t('fileIndex.empty')}
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('fileIndex.colFile')}</TableCell>
                  <TableCell>{t('fileIndex.colKind')}</TableCell>
                  <TableCell>{t('fileIndex.colChat')}</TableCell>
                  <TableCell>{t('fileIndex.colSize')}</TableCell>
                  <TableCell>{t('fileIndex.colDate')}</TableCell>
                  <TableCell align="right">{t('fileIndex.colActions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.fileName ?? row.caption?.slice(0, 40) ?? '—'}</TableCell>
                    <TableCell>
                      <Chip size="small" label={row.kind} />
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{row.chatId}</TableCell>
                    <TableCell>{formatSize(row.fileSize)}</TableCell>
                    <TableCell>
                      {row.sentAt ? row.sentAt.slice(0, 16).replace('T', ' ') : '—'}
                    </TableCell>
                    <TableCell align="right">
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{
                          justifyContent: 'flex-end',
                          alignItems: 'center',
                          display: 'inline-flex',
                        }}
                      >
                        {row.chatId.startsWith('-100') && (
                          <Button
                            size="small"
                            href={`https://t.me/c/${row.chatId.slice(4)}/${row.messageId}`}
                            target="_blank"
                            rel="noreferrer"
                            startIcon={<OpenInNewIcon />}
                          >
                            {t('fileIndex.open')}
                          </Button>
                        )}
                        <Button size="small" color="error" onClick={() => remove(row.id)}>
                          {t('actions.delete')}
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}
