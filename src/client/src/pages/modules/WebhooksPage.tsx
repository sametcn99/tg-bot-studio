import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  Stack,
  Tab,
  Table,
  TableContainer,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../services/api';
import PageHeader from '../../components/PageHeader';
import ModuleHelpDialog from '../../components/ModuleHelpDialog';
import ConfirmDialog from '../../components/ConfirmDialog';
import DataTable, { type Column } from '../../components/DataTable';
import { useSnackbar } from '../../context/SnackbarContext';
import { ConnectionSelect, NoConnectionsNotice } from '../../components/ConnectionSelect';
import { useConnections } from '../../context/ConnectionsContext';
import type { ModuleEntry } from '../../registry/modules';
import { formatDateTime } from '../../utils/format';
import { localizedErrorMessage } from '../../utils/errors';

/**
 * Outgoing webhook endpoint row.
 * @interface WebhookEndpoint
 * @property {string} id - Endpoint id.
 * @property {string} url - Target URL.
 * @property {string} secret - Signing secret.
 * @property {string[]} events - Subscribed events (empty = all).
 */
interface WebhookEndpoint {
  id: string;
  url: string;
  secret: string;
  events: string[];
}

/**
 * Inbound hook action row.
 * @interface InboundHook
 * @property {string} hookId - URL path segment.
 * @property {number | string} targetChatId - Message destination chat.
 * @property {string} template - Message template.
 */
interface InboundHook {
  hookId: string;
  targetChatId: number | string;
  template: string;
}

/**
 * Delivery log entry.
 * @interface DeliveryLog
 * @property {string} event - Event name.
 * @property {string} url - Target URL.
 * @property {number|string} status - HTTP status or 'error'.
 * @property {string} at - Timestamp.
 */
interface DeliveryLog {
  event: string;
  url: string;
  status: number | 'error';
  at: string;
}

/**
 * Webhooks Hub page: outgoing endpoint management, inbound hook creation,
 * and the delivery log.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {ModuleEntry} props.module - Webhooks catalog entry.
 * @returns {React.ReactElement} The page.
 */
export default function WebhooksPage({
  botId,
  module,
}: {
  botId: number;
  module: ModuleEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const { connections, loading: connectionsLoading } = useConnections();
  const [tab, setTab] = useState(0);
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [inbound, setInbound] = useState<InboundHook[]>([]);
  const [log, setLog] = useState<DeliveryLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);

  const [outForm, setOutForm] = useState({ url: '', secret: '', events: '' });
  const [inForm, setInForm] = useState({ targetChatId: '', template: 'Event: {payload.event}' });

  const [deletingEndpoint, setDeletingEndpoint] = useState<WebhookEndpoint | null>(null);
  const [deletingInbound, setDeletingInbound] = useState<InboundHook | null>(null);

  const STANDARD_EVENTS = [
    'order_created',
    'form_submitted',
    'support_message',
    'member_joined',
    'points_updated',
  ];

  function toggleEvent(evt: string): void {
    const current = outForm.events
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const updated = current.includes(evt) ? current.filter((e) => e !== evt) : [...current, evt];
    setOutForm({ ...outForm, events: updated.join(', ') });
  }

  const reload = useCallback((): void => {
    apiFetch<WebhookEndpoint[]>(`/api/bots/${botId}/webhooks/endpoints`)
      .then(setEndpoints)
      .catch(() => undefined);
    apiFetch<InboundHook[]>(`/api/bots/${botId}/webhooks/inbound`)
      .then(setInbound)
      .catch(() => undefined);
    apiFetch<DeliveryLog[]>(`/api/bots/${botId}/webhooks/log`)
      .then(setLog)
      .catch(() => undefined);
  }, [botId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /**
   * Creates an outgoing endpoint.
   * @returns {void}
   */
  function createEndpoint(): void {
    const events = outForm.events
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    apiFetch(`/api/bots/${botId}/webhooks/endpoints`, {
      method: 'POST',
      body: JSON.stringify({ url: outForm.url, secret: outForm.secret, events }),
    })
      .then(() => {
        showSuccess(t('webhooks.endpointCreated'));
        setOutForm({ url: '', secret: '', events: '' });
        reload();
      })
      .catch((err: Error) => {
        setError(localizedErrorMessage(err));
        showError(localizedErrorMessage(err));
      });
  }

  /**
   * Creates an inbound hook action.
   * @returns {void}
   */
  function createInbound(): void {
    apiFetch(`/api/bots/${botId}/webhooks/inbound`, {
      method: 'POST',
      body: JSON.stringify({
        targetChatId: inForm.targetChatId,
        template: inForm.template,
      }),
    })
      .then(() => {
        showSuccess(t('webhooks.inboundCreated'));
        setInForm({ targetChatId: '', template: 'Event: {payload.event}' });
        reload();
      })
      .catch((err: Error) => {
        setError(localizedErrorMessage(err));
        showError(localizedErrorMessage(err));
      });
  }

  function confirmDeleteEndpoint(): void {
    if (!deletingEndpoint) return;
    apiFetch(`/api/bots/${botId}/webhooks/endpoints/${deletingEndpoint.id}`, { method: 'DELETE' })
      .then(() => {
        showSuccess(t('webhooks.endpointDeleted'));
        setDeletingEndpoint(null);
        reload();
      })
      .catch((err: Error) => showError(localizedErrorMessage(err)));
  }

  function confirmDeleteInbound(): void {
    if (!deletingInbound) return;
    apiFetch(`/api/bots/${botId}/webhooks/inbound/${deletingInbound.hookId}`, { method: 'DELETE' })
      .then(() => {
        showSuccess(t('webhooks.inboundDeleted'));
        setDeletingInbound(null);
        reload();
      })
      .catch((err: Error) => showError(localizedErrorMessage(err)));
  }

  return (
    <Box>
      <PageHeader
        title={module.name}
        subtitle={module.description}
        onDocs={() => setDocsOpen(true)}
      />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Tabs
        value={tab}
        onChange={(_event, value: number) => setTab(value)}
        sx={{ mb: 2 }}
        aria-label={t('webhooks.sectionsAria')}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
      >
        <Tab label={t('webhooks.tabOutgoing')} />
        <Tab label={t('webhooks.tabInbound')} />
        <Tab label={t('webhooks.tabDeliveryLog')} />
      </Tabs>

      {tab === 0 && (
        <Stack spacing={2}>
          <Card>
            <CardContent>
              <Stack spacing={2} sx={{ maxWidth: 520 }}>
                <TextField
                  label={t('webhooks.targetUrl')}
                  size="small"
                  value={outForm.url}
                  onChange={(event) => setOutForm({ ...outForm, url: event.target.value })}
                />
                <TextField
                  label={t('webhooks.signingSecret')}
                  size="small"
                  value={outForm.secret}
                  onChange={(event) => setOutForm({ ...outForm, secret: event.target.value })}
                  helperText={t('webhooks.signingSecretHelp')}
                />
                <TextField
                  label={t('webhooks.eventsLabel')}
                  size="small"
                  value={outForm.events}
                  onChange={(event) => setOutForm({ ...outForm, events: event.target.value })}
                  helperText={t('webhooks.eventsHelp')}
                />
                <Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mb: 0.5, display: 'block' }}
                  >
                    {t('webhooks.quickAddEvents')}
                  </Typography>
                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                    {STANDARD_EVENTS.map((evt) => (
                      <Chip
                        key={evt}
                        size="small"
                        label={evt}
                        clickable
                        onClick={() => toggleEvent(evt)}
                        color={outForm.events.includes(evt) ? 'primary' : 'default'}
                      />
                    ))}
                  </Stack>
                </Box>
                <Box>
                  <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    disabled={!outForm.url}
                    onClick={createEndpoint}
                  >
                    {t('actions.create')}
                  </Button>
                </Box>
              </Stack>
            </CardContent>
          </Card>
          <Card>
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small" aria-label={t('webhooks.recordsAria')}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('webhooks.url')}</TableCell>
                    <TableCell>{t('webhooks.events')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {endpoints.map((endpoint) => (
                    <TableRow key={endpoint.id}>
                      <TableCell>
                        <Typography variant="body2" noWrap sx={{ maxWidth: 360 }}>
                          {endpoint.url}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {endpoint.events.length === 0 ? (
                          <Chip size="small" label={t('webhooks.allEvents')} />
                        ) : (
                          <Stack direction="row" spacing={0.5}>
                            {endpoint.events.map((event) => (
                              <Chip key={event} size="small" label={event} />
                            ))}
                          </Stack>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={() => setDeletingEndpoint(endpoint)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                  {endpoints.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3}>
                        <Typography color="text.secondary" align="center" sx={{ py: 2 }}>
                          {t('common.empty')}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Stack>
      )}

      {tab === 1 && (
        <Stack spacing={2}>
          {!connectionsLoading && connections.length === 0 && <NoConnectionsNotice />}
          <Card>
            <CardContent>
              <Stack spacing={2} sx={{ maxWidth: 520 }}>
                <ConnectionSelect
                  label={t('webhooks.targetChat')}
                  value={inForm.targetChatId}
                  onChange={(value) => setInForm({ ...inForm, targetChatId: value })}
                  helperText={t('webhooks.targetChatHelp')}
                />
                <TextField
                  label={t('webhooks.messageTemplate')}
                  size="small"
                  multiline
                  minRows={2}
                  value={inForm.template}
                  onChange={(event) => setInForm({ ...inForm, template: event.target.value })}
                  helperText={t('webhooks.messageTemplateHelp')}
                />
                <Box>
                  <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    disabled={!inForm.targetChatId}
                    onClick={createInbound}
                  >
                    {t('actions.create')}
                  </Button>
                </Box>
              </Stack>
            </CardContent>
          </Card>
          <Card>
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small" aria-label={t('webhooks.recordsAria')}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('webhooks.receiverUrl')}</TableCell>
                    <TableCell>{t('webhooks.targetChat')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {inbound.map((hook) => (
                    <TableRow key={hook.hookId}>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="body2" fontFamily="monospace" noWrap>
                            /api/hooks/{botId}/{hook.hookId}
                          </Typography>
                          <IconButton
                            size="small"
                            onClick={() =>
                              void navigator.clipboard.writeText(
                                `/api/hooks/${botId}/${hook.hookId}`,
                              )
                            }
                          >
                            <ContentCopyIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                      </TableCell>
                      <TableCell>{hook.targetChatId}</TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={() => setDeletingInbound(hook)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                  {inbound.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3}>
                        <Typography color="text.secondary" align="center" sx={{ py: 2 }}>
                          {t('common.empty')}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Stack>
      )}

      {tab === 2 && (
        <Card sx={{ p: 1 }}>
          <DataTable<DeliveryLog & { id: number }>
            rows={log.map((entry, index) => ({ ...entry, id: index }))}
            columns={
              [
                { id: 'event', label: t('webhooks.eventCol') },
                {
                  id: 'url',
                  label: t('webhooks.url'),
                  render: (row) => (
                    <Typography variant="body2" noWrap sx={{ maxWidth: 320 }}>
                      {row.url}
                    </Typography>
                  ),
                },
                {
                  id: 'status',
                  label: t('common.status'),
                  render: (row) => (
                    <Chip
                      size="small"
                      color={
                        row.status === 'error' ? 'error' : row.status < 300 ? 'success' : 'warning'
                      }
                      label={
                        row.status === 'error' ? t('webhooks.statusError') : String(row.status)
                      }
                    />
                  ),
                },
                {
                  id: 'at',
                  label: t('webhooks.time'),
                  render: (row) => formatDateTime(row.at),
                },
              ] satisfies Column<DeliveryLog & { id: number }>[]
            }
            keyField="id"
            ariaLabel={t('webhooks.recordsAria')}
          />
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(deletingEndpoint)}
        title={t('actions.delete')}
        message={t('webhooks.deleteEndpointConfirm', { url: deletingEndpoint?.url ?? '' })}
        onConfirm={confirmDeleteEndpoint}
        onCancel={() => setDeletingEndpoint(null)}
      />

      <ConfirmDialog
        open={Boolean(deletingInbound)}
        title={t('actions.delete')}
        message={t('webhooks.deleteInboundConfirm')}
        onConfirm={confirmDeleteInbound}
        onCancel={() => setDeletingInbound(null)}
      />

      <ModuleHelpDialog module={docsOpen ? module : null} onClose={() => setDocsOpen(false)} />
    </Box>
  );
}
