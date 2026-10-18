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
  TextField,
  Typography,
} from '@mui/material';
import PaidIcon from '@mui/icons-material/Paid';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../services/api';
import PageHeader from '../../components/PageHeader';
import { useModuleDocs } from '../../context/ModuleDocsContext';
import {
  ConnectionSelect,
  ConnectionMultiSelect,
  NoConnectionsNotice,
} from '../../components/ConnectionSelect';
import UserPicker from '../../components/UserPicker';
import DataTable, { type Column } from '../../components/DataTable';
import { useConnections } from '../../context/ConnectionsContext';
import type { ModuleEntry } from '../../registry/modules';
import { formatDateTime } from '../../utils/format';
import { localizedErrorMessage } from '../../utils/errors';

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
  id: string;
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
  botId: string;
  module: ModuleEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  const { connections, loading: connectionsLoading } = useConnections();
  const [tab, setTab] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [sendingPaid, setSendingPaid] = useState(false);
  const { openDocs } = useModuleDocs();
  const [vip, setVip] = useState<VipRow[]>([]);

  const [mediaForm, setMediaForm] = useState({
    chatIds: [] as string[],
    mediaType: 'photo',
    mediaUrl: '',
    caption: '',
    starCount: 25,
  });
  const [vipForm, setVipForm] = useState({
    telegramId: '',
    channelChatId: '',
    periodDays: 30,
    starPrice: 50,
  });

  useEffect(() => {
    apiFetch<VipRow[]>(`/api/bots/${botId}/monetization/vip`)
      .then(setVip)
      .catch(() => undefined);
  }, [botId]);

  /**
   * Sends a Stars-locked paid media message to every selected chat.
   * @returns {void}
   */
  function sendPaidMedia(): void {
    setError(null);
    setStatus(null);
    if (mediaForm.chatIds.length === 0) {
      setError(t('monetization.pickTargetChat'));
      return;
    }
    const chatIds = [...mediaForm.chatIds];
    setSendingPaid(true);
    const sendNext = (index: number): void => {
      if (index >= chatIds.length) {
        setSendingPaid(false);
        setStatus(t('monetization.paidMediaSent'));
        return;
      }
      apiFetch(`/api/bots/${botId}/monetization/paid-media/send`, {
        method: 'POST',
        body: JSON.stringify({
          chatId: chatIds[index],
          mediaType: mediaForm.mediaType,
          mediaUrl: mediaForm.mediaUrl,
          caption: mediaForm.caption,
          starCount: Number(mediaForm.starCount),
        }),
      })
        .then(() => sendNext(index + 1))
        .catch((err: Error) => {
          setSendingPaid(false);
          setError(`${chatIds[index]}: ${localizedErrorMessage(err)}`);
        });
    };
    sendNext(0);
  }

  /**
   * Grants a VIP subscription invite link.
   * @returns {void}
   */
  function grantVip(): void {
    setError(null);
    setStatus(null);
    if (!/^-?\d+$/.test(vipForm.channelChatId)) {
      setError(t('monetization.vipNeedsNumericChannel'));
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
      .then(() => setStatus(t('monetization.vipInviteSent')))
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }

  return (
    <Box>
      <PageHeader
        title={t('monetization.title')}
        subtitle={t('monetization.subtitle')}
        onDocs={() => openDocs(module)}
      />
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

      <Tabs
        value={tab}
        onChange={(_event, value: number) => setTab(value)}
        sx={{ mb: 2 }}
        aria-label={t('monetization.sectionsAria')}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
      >
        <Tab label={t('monetization.tabPaidMedia')} />
        <Tab label={t('monetization.tabVip')} />
      </Tabs>

      {tab === 0 && (
        <Stack spacing={2}>
          {!connectionsLoading && connections.length === 0 && <NoConnectionsNotice />}
          <Card>
            <CardContent>
              <Stack spacing={2} sx={{ maxWidth: 520 }}>
                <Typography
                  variant="body2"
                  sx={{
                    color: 'text.secondary',
                  }}
                >
                  {module.description}
                </Typography>
                <ConnectionMultiSelect
                  label={t('monetization.targetChat')}
                  value={mediaForm.chatIds}
                  onChange={(chatIds) => setMediaForm({ ...mediaForm, chatIds })}
                  helperText={t('monetization.targetChatHelp')}
                />
                <TextField
                  select
                  label={t('monetization.mediaType')}
                  size="small"
                  value={mediaForm.mediaType}
                  onChange={(event) =>
                    setMediaForm({ ...mediaForm, mediaType: event.target.value })
                  }
                >
                  <MenuItem value="photo">{t('monetization.photo')}</MenuItem>
                  <MenuItem value="video">{t('monetization.video')}</MenuItem>
                </TextField>
                <TextField
                  label={t('monetization.mediaUrl')}
                  size="small"
                  value={mediaForm.mediaUrl}
                  onChange={(event) => setMediaForm({ ...mediaForm, mediaUrl: event.target.value })}
                />
                <TextField
                  label={t('monetization.caption')}
                  size="small"
                  multiline
                  minRows={2}
                  value={mediaForm.caption}
                  onChange={(event) => setMediaForm({ ...mediaForm, caption: event.target.value })}
                />
                <TextField
                  label={t('monetization.priceStars')}
                  type="number"
                  size="small"
                  value={mediaForm.starCount}
                  onChange={(event) =>
                    setMediaForm({ ...mediaForm, starCount: Number(event.target.value) })
                  }
                />
                <Box>
                  <Button
                    variant="contained"
                    startIcon={<PaidIcon />}
                    onClick={sendPaidMedia}
                    disabled={sendingPaid || mediaForm.chatIds.length === 0}
                  >
                    {sendingPaid ? t('common.saving') : t('monetization.sendPaidMedia')}
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
            <NoConnectionsNotice
              typeLabel={connections.length === 0 ? undefined : t('connections.typeChannel')}
            />
          )}
          <Card>
            <CardContent>
              <Stack spacing={2} sx={{ maxWidth: 520 }}>
                <UserPicker
                  botId={botId}
                  value={vipForm.telegramId}
                  onChange={(telegramId) =>
                    setVipForm({ ...vipForm, telegramId: String(telegramId) })
                  }
                  label={t('monetization.subscriberId')}
                />
                <ConnectionSelect
                  label={t('monetization.channel')}
                  types={['channel']}
                  value={vipForm.channelChatId}
                  onChange={(value) => setVipForm({ ...vipForm, channelChatId: value })}
                  helperText={t('monetization.channelHelp')}
                />
                <Stack direction="row" spacing={2}>
                  <TextField
                    label={t('monetization.periodDays')}
                    type="number"
                    size="small"
                    value={vipForm.periodDays}
                    onChange={(event) =>
                      setVipForm({ ...vipForm, periodDays: Number(event.target.value) })
                    }
                  />
                  <TextField
                    label={t('monetization.priceStars')}
                    type="number"
                    size="small"
                    value={vipForm.starPrice}
                    onChange={(event) =>
                      setVipForm({ ...vipForm, starPrice: Number(event.target.value) })
                    }
                  />
                </Stack>
                <Box>
                  <Button variant="contained" onClick={grantVip}>
                    {t('monetization.grantSubscription')}
                  </Button>
                </Box>
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ p: 1 }}>
            <DataTable<VipRow>
              rows={vip}
              columns={
                [
                  {
                    id: 'telegram_id',
                    label: t('monetization.subscriber'),
                    align: 'right',
                  },
                  { id: 'channel_id', label: t('monetization.channel'), align: 'right' },
                  {
                    id: 'expires_at',
                    label: t('monetization.expires'),
                    render: (row) => formatDateTime(row.expires_at),
                  },
                  {
                    id: 'is_active',
                    label: t('monetization.state'),
                    render: (row) => (
                      <Chip
                        size="small"
                        color={row.is_active ? 'success' : 'default'}
                        label={row.is_active ? t('status.active') : t('monetization.expired')}
                      />
                    ),
                  },
                ] satisfies Column<VipRow>[]
              }
              keyField="id"
              ariaLabel={t('monetization.vipRecordsAria')}
            />
          </Card>
        </Stack>
      )}
    </Box>
  );
}
