import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
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
  Grid,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PublishIcon from '@mui/icons-material/Publish';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import PageHeader from '../components/PageHeader';
import PhonePreview from '../components/PhonePreview';
import ModuleHelpDialog from '../components/ModuleHelpDialog';
import VisualMiniAppConfigBuilder from '../components/VisualMiniAppConfigBuilder';
import { EmptyState } from '../components/Feedback';
import { MINI_APPS_DOCS_ENTRY } from '../registry/modules';

/**
 * Mini App row from the studio API (config and theme parsed).
 * @interface MiniApp
 * @property {number} id - App identifier.
 * @property {string} name - Operator name.
 * @property {string} slug - URL slug under /tma/.
 * @property {string} template_type - Template key.
 * @property {string} title - In-app title.
 * @property {number} is_active - Enabled flag.
 * @property {Record<string, unknown>} config - Parsed configuration.
 */
interface MiniApp {
  id: number;
  name: string;
  slug: string;
  template_type: string;
  title: string;
  description: string | null;
  is_active: number;
  config: Record<string, unknown>;
  theme: Record<string, unknown>;
}

/** Available template choices. */
const TEMPLATES = [
  { value: 'ecommerce', label: 'E-Commerce & Digital Storefront' },
  { value: 'loyalty', label: 'Loyalty, Points & Referral Hub' },
  { value: 'forms', label: 'Dynamic Forms & Lead Capture' },
  { value: 'spin', label: 'Gamification & Daily Spin' },
  { value: 'webview', label: 'External Webview Wrapper' },
];

/**
 * Mini App Studio page: template-driven builder, live phone preview,
 * one-click chat menu button publishing, and per-app orders/forms viewers.
 * @returns {React.ReactElement} The Mini Apps page.
 */
export default function MiniAppsPage(): React.ReactElement {
  const { t } = useTranslation();
  const { botId } = useParams<{ botId: string }>();
  const [apps, setApps] = useState<MiniApp[]>([]);
  const [selected, setSelected] = useState<MiniApp | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publicBaseUrl, setPublicBaseUrl] = useState(
    (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ||
      window.location.origin,
  );

  const reload = useCallback((): void => {
    apiFetch<MiniApp[]>(`/api/bots/${botId}/mini-apps`)
      .then((list) => {
        setApps(list);
        setSelected((current) => list.find((app) => app.id === current?.id) ?? list[0] ?? null);
      })
      .catch((err: Error) => setError(err.message));
  }, [botId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /**
   * Persists edits to the selected app.
   * @param {Record<string, unknown>} patch - Changed fields (API payload shape).
   * @returns {void}
   */
  function save(patch: Record<string, unknown>): void {
    if (!selected) return;
    apiFetch<MiniApp>(`/api/bots/${botId}/mini-apps/${selected.id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
      .then(reload)
      .catch((err: Error) => setError(err.message));
  }

  /**
   * Publishes the selected app to the chat menu button.
   * @returns {void}
   */
  function publish(): void {
    if (!selected) return;
    apiFetch(`/api/bots/${botId}/mini-apps/${selected.id}/publish`, {
      method: 'POST',
      body: JSON.stringify({ publicBaseUrl }),
    })
      .then(() => setError(null))
      .catch((err: Error) => setError(err.message));
  }

  return (
    <Box>
      <PageHeader
        title={t('nav.miniApps')}
        subtitle="Create, configure, and host Telegram Mini Apps without external hosting"
        onDocs={() => setDocsOpen(true)}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
            {t('actions.create')}
          </Button>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 7 }}>
          {apps.length === 0 ? (
            <Card>
              <EmptyState message="No Mini Apps yet. Create one and it will be hosted live under /tma/." />
            </Card>
          ) : (
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                {apps.map((app) => (
                  <Chip
                    key={app.id}
                    component="button"
                    type="button"
                    label={app.name}
                    variant={selected?.id === app.id ? 'filled' : 'outlined'}
                    color="primary"
                    aria-pressed={selected?.id === app.id}
                    onClick={() => setSelected(app)}
                  />
                ))}
              </Stack>

              {selected && (
                <Card>
                  <CardContent>
                    <Stack spacing={2}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="subtitle2">{selected.title}</Typography>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="caption" color="text.secondary">
                            /tma/{selected.slug}
                          </Typography>
                          <Switch
                            size="small"
                            checked={selected.is_active === 1}
                            onChange={(event) => save({ is_active: event.target.checked ? 1 : 0 })}
                          />
                        </Stack>
                      </Stack>

                      <TextField
                        label={t('common.name')}
                        size="small"
                        defaultValue={selected.name}
                        onBlur={(event) => save({ name: event.target.value })}
                      />
                      <TextField
                        label={t('common.title')}
                        size="small"
                        defaultValue={selected.title}
                        onBlur={(event) => save({ title: event.target.value })}
                      />
                      <VisualMiniAppConfigBuilder
                        templateType={selected.template_type}
                        config={selected.config}
                        onChange={(newConfig) => save({ config: newConfig })}
                      />
                      <TextField
                        label={t('miniApps.publicBaseUrl')}
                        size="small"
                        value={publicBaseUrl}
                        onChange={(event) => setPublicBaseUrl(event.target.value)}
                        helperText={t('miniApps.publishHint')}
                      />
                      <Stack direction="row" spacing={1}>
                        <Button variant="contained" startIcon={<PublishIcon />} onClick={publish}>
                          {t('actions.publish')}
                        </Button>
                      </Stack>

                      <AppDataViewer botId={Number(botId)} app={selected} />
                    </Stack>
                  </CardContent>
                </Card>
              )}
            </Stack>
          )}
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Card>
            <CardContent sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <PhonePreview
                url={selected ? `${publicBaseUrl}/tma/${selected.slug}/` : ''}
                label={t('miniApps.preview')}
              />
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <CreateMiniAppDialog
        open={createOpen}
        botId={Number(botId)}
        onClose={() => setCreateOpen(false)}
        onCreated={reload}
      />
      <ModuleHelpDialog
        module={docsOpen ? MINI_APPS_DOCS_ENTRY : null}
        onClose={() => setDocsOpen(false)}
      />
    </Box>
  );
}

/**
 * Orders and form submissions viewer for one Mini App.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {MiniApp} props.app - Selected Mini App.
 * @returns {React.ReactElement} The viewer.
 */
function AppDataViewer({ botId, app }: { botId: number; app: MiniApp }): React.ReactElement {
  const { t } = useTranslation();
  const [tab, setTab] = useState(0);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    const path = tab === 0 ? 'orders' : 'forms';
    apiFetch<Array<Record<string, unknown>>>(`/api/bots/${botId}/mini-apps/${app.id}/${path}`)
      .then(setRows)
      .catch(() => setRows([]));
  }, [botId, app.id, tab]);

  const columns = rows.length > 0 ? Object.keys(rows[0]).slice(0, 5) : [];

  return (
    <Box sx={{ pt: 1 }}>
      <Tabs
        value={tab}
        onChange={(_event, value: number) => setTab(value)}
        aria-label="Mini App data sections"
      >
        <Tab label={t('miniApps.orders')} />
        <Tab label={t('miniApps.forms')} />
      </Tabs>
      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          {t('common.empty')}
        </Typography>
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                {columns.map((column) => (
                  <TableCell key={column}>{column}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.slice(0, 25).map((row, index) => (
                <TableRow key={index}>
                  {columns.map((column) => {
                    const value = row[column];
                    const text =
                      typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
                    return (
                      <TableCell key={column}>
                        <Typography variant="body2" noWrap sx={{ maxWidth: 180 }}>
                          {text.length > 60 ? `${text.slice(0, 60)}...` : text}
                        </Typography>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </Box>
  );
}

/**
 * Create Mini App dialog with template picker.
 * @param {object} props - Component props.
 * @param {boolean} props.open - Visibility.
 * @param {number} props.botId - Active bot id.
 * @param {() => void} props.onClose - Closes the dialog.
 * @param {() => void} props.onCreated - Refresh callback.
 * @returns {React.ReactElement} The dialog.
 */
function CreateMiniAppDialog({
  open,
  botId,
  onClose,
  onCreated,
}: {
  open: boolean;
  botId: number;
  onClose: () => void;
  onCreated: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [templateType, setTemplateType] = useState('ecommerce');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const theme = useTheme();
  const compactDialogs = useMediaQuery(theme.breakpoints.down('sm'));

  /**
   * Creates the Mini App.
   * @returns {void}
   */
  function create(): void {
    setBusy(true);
    setError(null);
    const sampleConfig = sampleConfigFor(templateType);
    apiFetch(`/api/bots/${botId}/mini-apps`, {
      method: 'POST',
      body: JSON.stringify({ name, slug, templateType, title: name, config: sampleConfig }),
    })
      .then(() => {
        onCreated();
        onClose();
        setName('');
        setSlug('');
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      fullScreen={compactDialogs}
      aria-labelledby="create-mini-app-title"
    >
      <DialogTitle id="create-mini-app-title">{t('miniApps.addTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label={t('common.name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            label={t('miniApps.slug')}
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            helperText="Served at /tma/<slug>"
            fullWidth
            size="small"
          />
          <TextField
            select
            label={t('miniApps.template')}
            value={templateType}
            onChange={(event) => setTemplateType(event.target.value)}
            fullWidth
            size="small"
          >
            {TEMPLATES.map((template) => (
              <MenuItem key={template.value} value={template.value}>
                {template.label}
              </MenuItem>
            ))}
          </TextField>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.cancel')}</Button>
        <Button variant="contained" disabled={!name || !slug || busy} onClick={create}>
          {t('actions.create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Sample starter configuration for a template type.
 * @param {string} templateType - Template key.
 * @returns {Record<string, unknown>} Starter config object.
 */
function sampleConfigFor(templateType: string): Record<string, unknown> {
  switch (templateType) {
    case 'ecommerce':
      return {
        products: [
          {
            id: 'p1',
            title: 'Sample Product',
            price: 25,
            category: 'All',
            description: 'Starter product entry',
          },
        ],
      };
    case 'loyalty':
      return {
        tiers: [
          { name: 'Bronze', minPoints: 0 },
          { name: 'Silver', minPoints: 500 },
        ],
        botUsername: '',
      };
    case 'forms':
      return {
        fields: [
          { label: 'Full name', type: 'text', required: true },
          { label: 'Phone', type: 'phone', required: true },
        ],
      };
    case 'spin':
      return {
        prizes: [
          { label: '10 points', points: 10, weight: 50 },
          { label: '50 points', points: 50, weight: 10 },
          { label: 'Try again', points: 0, weight: 40 },
        ],
      };
    case 'webview':
      return { url: 'https://example.com' };
    default:
      return {};
  }
}
