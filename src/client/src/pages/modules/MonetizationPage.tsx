import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  Table,
  TableContainer,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import PaidIcon from '@mui/icons-material/Paid';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../services/api';
import PageHeader from '../../components/PageHeader';
import ModuleHelpDialog from '../../components/ModuleHelpDialog';
import { ConnectionSelect, NoConnectionsNotice } from '../../components/ConnectionSelect';
import { useConnections } from '../../context/ConnectionsContext';
import type { ModuleEntry } from '../../registry/modules';

/**
 * VIP subscription row.
 * @interface VipRow
 * @property {number} id - Subscription id.
 * @property {number} telegram_id - Subscriber Telegram id.
 * @property {number} channel_id - Protected channel id.
 * @property {string} expires_at - Expiry timestamp.
 * @property {number} is_active - Active flag.
 */
interface VipRow {
  id: number;
  telegram_id: number;
  channel_id: number;
  expires_at: string;
  is_active: number;
}

/**
 * Monetization page: paid media paywall sender, VIP subscription grants and
 * the subscription table, plus the two module configuration cards.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {ModuleEntry} props.module - Paid media catalog entry.
 * @returns {React.ReactElement} The page.
 */
export default function MonetizationPage({
  botId,
  module,
}: {
  botId: number;
  module: ModuleEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  const { connections, loading: connectionsLoading } = useConnections();
  const [tab, setTab] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [vip, setVip] = useState<VipRow[]>([]);

  const [mediaForm, setMediaForm] = useState({ chatId: '', mediaType: 'photo', mediaUrl: '', caption: '', starCount: 25 });
  const [vipForm, setVipForm] = useState({ telegramId: '', channelChatId: '', periodDays: 30, starPrice: 50 });

  useEffect(() => {
    apiFetch<VipRow[]>(`/api/bots/${botId}/monetization/vip`)
      .then(setVip)
      .catch(() => undefined);
  }, [botId]);

  /**
   * Sends a Stars-locked paid media message.
   * @returns {void}
   */
  function sendPaidMedia(): void {
    setError(null);
    setStatus(null);
    apiFetch(`/api/bots/${botId}/monetization/paid-media/send`, {
      method: 'POST',
      body: JSON.stringify({
        chatId: mediaForm.chatId,
        mediaType: mediaForm.mediaType,
        mediaUrl: mediaForm.mediaUrl,
        caption: mediaForm.caption,
        starCount: Number(mediaForm.starCount),
      }),
    })
      .then(() => setStatus('Paid media sent.'))
      .catch((err: Error) => setError(err.message));
  }

  /**
   * Grants a VIP subscription invite link.
   * @returns {void}
   */
  function grantVip(): void {
    setError(null);
    setStatus(null);
    if (!/^-?\d+$/.test(vipForm.channelChatId)) {
      setError('VIP subscriptions need a connection with a numeric channel id.');
      return;
    }
    apiFetch(`/api/bots/${botId}/monetization/vip/grant`, {
      method: 'POST',
      body: JSON.stringify({
        telegramId: Number(vipForm.telegramId),
        channelChatId: Number(vipForm.channelChatId),
        periodDays: Number(vipForm.periodDays),
        starPrice: Number(vipForm.starPrice),
      }),
    })
      .then(() => setStatus('VIP invite link sent to the subscriber.'))
      .catch((err: Error) => setError(err.message));
  }

  return (
    <Box>
      <PageHeader
        title="Monetization"
        subtitle="Telegram Stars paywalls and VIP channel subscriptions"
        onDocs={() => setDocsOpen(true)}
      />
      {status && <Alert severity="success" sx={{ mb: 2 }}>{status}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Tabs
        value={tab}
        onChange={(_event, value: number) => setTab(value)}
        sx={{ mb: 2 }}
        aria-label="Monetization sections"
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
      >
        <Tab label="Paid Media Paywall" />
        <Tab label="VIP Subscriptions" />
      </Tabs>

      {tab === 0 && (
        <Stack spacing={2}>
          {!connectionsLoading && connections.length === 0 && <NoConnectionsNotice />}
          <Card>
            <CardContent>
              <Stack spacing={2} sx={{ maxWidth: 520 }}>
                <Typography variant="body2" color="text.secondary">
                  {module.description}
                </Typography>
                <ConnectionSelect
                  label="Target chat"
                  value={mediaForm.chatId}
                  onChange={(value) => setMediaForm({ ...mediaForm, chatId: value })}
                  helperText="Chat that receives the Stars-locked media"
                />
              <TextField
                select
                label="Media type"
                size="small"
                value={mediaForm.mediaType}
                onChange={(event) => setMediaForm({ ...mediaForm, mediaType: event.target.value })}
              >
                <MenuItem value="photo">Photo</MenuItem>
                <MenuItem value="video">Video</MenuItem>
              </TextField>
              <TextField
                label="Media URL"
                size="small"
                value={mediaForm.mediaUrl}
                onChange={(event) => setMediaForm({ ...mediaForm, mediaUrl: event.target.value })}
              />
              <TextField
                label="Caption"
                size="small"
                multiline
                minRows={2}
                value={mediaForm.caption}
                onChange={(event) => setMediaForm({ ...mediaForm, caption: event.target.value })}
              />
              <TextField
                label="Price (Stars)"
                type="number"
                size="small"
                value={mediaForm.starCount}
                onChange={(event) => setMediaForm({ ...mediaForm, starCount: Number(event.target.value) })}
              />
              <Box>
                <Button variant="contained" startIcon={<PaidIcon />} onClick={sendPaidMedia}>
                  Send paid media
                </Button>
              </Box>
            </Stack>
          </CardContent>
        </Card>
        </Stack>
      )}

      {tab === 1 && (
        <Stack spacing={2}>
          {!connectionsLoading && (
            <NoConnectionsNotice typeLabel={connections.length === 0 ? undefined : 'channel'} />
          )}
          <Card>
            <CardContent>
              <Stack spacing={2} sx={{ maxWidth: 520 }}>
                <TextField
                  label="Subscriber Telegram id"
                  type="number"
                  size="small"
                  value={vipForm.telegramId}
                  onChange={(event) => setVipForm({ ...vipForm, telegramId: event.target.value })}
                />
                <ConnectionSelect
                  label="Channel"
                  types={['channel']}
                  value={vipForm.channelChatId}
                  onChange={(value) => setVipForm({ ...vipForm, channelChatId: value })}
                  helperText="Bot must administrate this channel"
                />
                <Stack direction="row" spacing={2}>
                  <TextField
                    label="Period (days)"
                    type="number"
                    size="small"
                    value={vipForm.periodDays}
                    onChange={(event) => setVipForm({ ...vipForm, periodDays: Number(event.target.value) })}
                  />
                  <TextField
                    label="Price (Stars)"
                    type="number"
                    size="small"
                    value={vipForm.starPrice}
                    onChange={(event) => setVipForm({ ...vipForm, starPrice: Number(event.target.value) })}
                  />
                </Stack>
                <Box>
                  <Button variant="contained" onClick={grantVip}>
                    Grant subscription
                  </Button>
                </Box>
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label="VIP subscriptions">
              <TableHead>
                <TableRow>
                  <TableCell>Subscriber</TableCell>
                  <TableCell>Channel</TableCell>
                  <TableCell>Expires</TableCell>
                  <TableCell>State</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {vip.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.telegram_id}</TableCell>
                    <TableCell>{row.channel_id}</TableCell>
                    <TableCell>{row.expires_at?.slice(0, 19).replace('T', ' ')}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={row.is_active ? 'success' : 'default'}
                        label={row.is_active ? 'Active' : 'Expired'}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {vip.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4}>
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

      <ModuleHelpDialog module={docsOpen ? module : null} onClose={() => setDocsOpen(false)} />
    </Box>
  );
}
