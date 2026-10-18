import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
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
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import { formatDateTime } from '../utils/format';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import { localizedErrorMessage } from '../utils/errors';

/**
 * Session row from the auth API.
 * @interface SessionInfo
 * @property {string} id - Session identifier.
 * @property {string} ip - Login IP.
 * @property {string} browser - Parsed browser.
 * @property {string} os - Parsed operating system.
 * @property {string} device_type - Device class.
 * @property {string} created_at - Creation timestamp.
 * @property {string} last_active_at - Last activity timestamp.
 * @property {number} is_revoked - Revocation flag.
 */
interface SessionInfo {
  id: string;
  ip: string;
  browser: string;
  os: string;
  device_type: string;
  created_at: string;
  last_active_at: string;
  is_revoked: number;
}

/**
 * Security audit log row.
 * @interface SecurityLog
 * @property {number} id - Entry id.
 * @property {string} event - Event name.
 * @property {string} [ip] - Client IP.
 * @property {string} [details] - Context.
 * @property {string} created_at - Timestamp.
 */
interface SecurityLog {
  id: string;
  event: string;
  ip: string | null;
  details: string | null;
  created_at: string;
}

/**
 * Security & Sessions page: active session management, master key rotation,
 * and the security audit log.
 * @returns {React.ReactElement} The security page.
 */
export default function SecurityPage(): React.ReactElement {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [logs, setLogs] = useState<SecurityLog[]>([]);
  const [currentKey, setCurrentKey] = useState('');
  const [newKey, setNewKey] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    reload();
  }, []);

  /**
   * Reloads sessions and audit log.
   * @returns {void}
   */
  function reload(): void {
    apiFetch<SessionInfo[]>('/api/auth/sessions')
      .then(setSessions)
      .catch(() => undefined);
    apiFetch<SecurityLog[]>('/api/auth/security-logs')
      .then(setLogs)
      .catch(() => undefined);
  }

  /**
   * Revokes a session by id.
   * @param {string} id - Session identifier.
   * @returns {void}
   */
  function revoke(id: string): void {
    apiFetch(`/api/auth/sessions/${id}`, { method: 'DELETE' })
      .then(reload)
      .catch(() => undefined);
  }

  /**
   * Revokes every session except the current one.
   * @returns {void}
   */
  function revokeOthers(): void {
    apiFetch('/api/auth/sessions/revoke-others', { method: 'POST' })
      .then(reload)
      .catch(() => undefined);
  }

  /**
   * Rotates the master key after validating inputs.
   * @returns {void}
   */
  function rotateKey(): void {
    if (newKey.length < 8) {
      setError(t('security.newKeyTooShort'));
      return;
    }
    setError(null);
    apiFetch('/api/auth/change-key', {
      method: 'POST',
      body: JSON.stringify({ currentKey, newKey }),
    })
      .then(() => {
        setStatus(t('security.keyChanged'));
        setCurrentKey('');
        setNewKey('');
      })
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }

  return (
    <Box>
      <PageHeader title={t('nav.security')} />

      {status && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {status}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack
            direction="row"
            sx={{
              justifyContent: 'space-between',
              alignItems: 'center',
              mb: 1,
            }}
          >
            <Typography variant="subtitle2" component="h3">
              {t('security.sessions')}
            </Typography>
            <Button size="small" onClick={revokeOthers}>
              {t('security.revokeOthers')}
            </Button>
          </Stack>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label={t('security.sessions')}>
              <TableHead>
                <TableRow>
                  <TableCell>{t('security.browser')}</TableCell>
                  <TableCell>{t('security.os')}</TableCell>
                  <TableCell>{t('security.device')}</TableCell>
                  <TableCell>{t('security.ip')}</TableCell>
                  <TableCell>{t('security.lastActive')}</TableCell>
                  <TableCell>{t('security.state')}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell>{session.browser}</TableCell>
                    <TableCell>{session.os}</TableCell>
                    <TableCell>{session.device_type}</TableCell>
                    <TableCell>{session.ip}</TableCell>
                    <TableCell>{formatDateTime(session.last_active_at)}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={session.is_revoked ? 'default' : 'success'}
                        label={session.is_revoked ? t('security.revoked') : t('status.active')}
                      />
                    </TableCell>
                    <TableCell>
                      {!session.is_revoked && (
                        <Button size="small" color="error" onClick={() => revoke(session.id)}>
                          {t('security.revoke')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 2 }} component="h3">
            {t('security.changeKey')}
          </Typography>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TextField
              label={t('security.currentKey')}
              type="password"
              size="small"
              value={currentKey}
              onChange={(event) => setCurrentKey(event.target.value)}
              autoComplete="current-password"
              fullWidth
            />
            <TextField
              label={t('security.newKey')}
              type="password"
              size="small"
              value={newKey}
              onChange={(event) => setNewKey(event.target.value)}
              fullWidth
            />
            <Button variant="contained" onClick={rotateKey} disabled={!currentKey || !newKey}>
              {t('actions.save')}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 2 }} component="h3">
            {t('security.logs')}
          </Typography>
          <DataTable<SecurityLog>
            rows={logs}
            columns={[
              { id: 'event', label: t('security.event'), sortable: true },
              { id: 'ip', label: t('security.ip'), sortable: true, render: (r) => r.ip ?? '-' },
              {
                id: 'details',
                label: t('security.details'),
                sortable: true,
                render: (r) => r.details ?? '-',
              },
              {
                id: 'created_at',
                label: t('security.time'),
                sortable: true,
                render: (r) => formatDateTime(r.created_at),
              },
            ]}
            keyField="id"
            searchPlaceholder={t('security.searchPlaceholder')}
            emptyMessage={t('common.empty')}
            ariaLabel={t('security.logs')}
          />
        </CardContent>
      </Card>
    </Box>
  );
}
