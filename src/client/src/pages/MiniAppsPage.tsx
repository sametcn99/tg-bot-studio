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
import DeleteIcon from '@mui/icons-material/Delete';
import PublishIcon from '@mui/icons-material/Publish';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import PageHeader from '../components/PageHeader';
import PhonePreview from '../components/PhonePreview';
import ConfirmDialog from '../components/ConfirmDialog';
import VisualMiniAppConfigBuilder from '../components/VisualMiniAppConfigBuilder';
import { EmptyState } from '../components/Feedback';
import { useMiniAppsDocsEntry } from '../registry/localize';
import { localizedErrorMessage } from '../utils/errors';
import { useModuleDocs } from '../context/ModuleDocsContext';

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

/** Available template choices (labels resolved via i18n at render time). */
const TEMPLATES = [
  { value: 'ecommerce', labelKey: 'miniApps.templateEcommerce' },
  { value: 'loyalty', labelKey: 'miniApps.templateLoyalty' },
  { value: 'forms', labelKey: 'miniApps.templateForms' },
  { value: 'spin', labelKey: 'miniApps.templateSpin' },
  { value: 'webview', labelKey: 'miniApps.templateWebview' },
  { value: 'leaderboard', labelKey: 'miniApps.templateLeaderboard' },
  { value: 'support', labelKey: 'miniApps.templateSupport' },
];

/**
 * Mini App Studio page: template-driven builder, live phone preview,
 * one-click chat menu button publishing, and per-app orders/forms viewers.
 * @returns {React.ReactElement} The Mini Apps page.
 */
export default function MiniAppsPage(): React.ReactElement {
  const { t } = useTranslation();
  const miniAppsDocsEntry = useMiniAppsDocsEntry();
  const { openDocs } = useModuleDocs();
  const { botId } = useParams<{ botId: string }>();
  const [apps, setApps] = useState<MiniApp[]>([]);
  const [selected, setSelected] = useState<MiniApp | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0);
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
      .catch((err: Error) => setError(localizedErrorMessage(err)));
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
      .then(() => {
        if ('theme' in patch) setPreviewNonce((nonce) => nonce + 1);
        reload();
      })
      .catch((err: Error) => setError(localizedErrorMessage(err)));
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
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }

  /**
   * Deletes the selected app after confirmation.
   * @returns {void}
   */
  function remove(): void {
    if (!selected) return;
    apiFetch(`/api/bots/${botId}/mini-apps/${selected.id}`, { method: 'DELETE' })
      .then(() => {
        setDeleteOpen(false);
        setError(null);
        reload();
      })
      .catch((err: Error) => {
        setDeleteOpen(false);
        setError(localizedErrorMessage(err));
      });
  }

  return (
    <Box>
      <PageHeader
        title={t('nav.miniApps')}
        subtitle={t('miniApps.subtitle')}
        onDocs={() => openDocs(miniAppsDocsEntry)}
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
              <EmptyState message={t('miniApps.empty')} />
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
                      <ThemeEditor theme={selected.theme} onChange={(theme) => save({ theme })} />
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
                        <Button
                          color="error"
                          startIcon={<DeleteIcon />}
                          onClick={() => setDeleteOpen(true)}
                        >
                          {t('actions.delete')}
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
                key={previewNonce}
                url={
                  selected ? `${publicBaseUrl}/tma/${selected.slug}/?preview=${previewNonce}` : ''
                }
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

      <ConfirmDialog
        open={deleteOpen}
        title={t('miniApps.deleteTitle')}
        message={t('miniApps.deleteConfirm', { name: selected?.name ?? '' })}
        onConfirm={remove}
        onCancel={() => setDeleteOpen(false)}
      />
    </Box>
  );
}

/**
 * Branding editor for the selected app: writes themeJson overrides that the
 * TMA runtime applies as CSS variables (colors) plus a header logo.
 * @param {object} props - Component props.
 * @param {Record<string, unknown>} props.theme - Current theme overrides.
 * @param {(theme: Record<string, unknown>) => void} props.onChange - Persist callback.
 * @returns {React.ReactElement} The theme editor card section.
 */
function ThemeEditor({
  theme,
  onChange,
}: {
  theme: Record<string, unknown>;
  onChange: (theme: Record<string, unknown>) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    setDraft({
      primaryColor: String(theme.primaryColor ?? ''),
      backgroundColor: String(theme.backgroundColor ?? ''),
      textColor: String(theme.textColor ?? ''),
      logoUrl: String(theme.logoUrl ?? ''),
    });
    // Re-seed when switching between apps (object identity changes).
  }, [theme]);

  /**
   * Saves one theme key, dropping empty values.
   * @param {string} key - Theme key.
   * @param {string} value - New value ('' clears the override).
   * @returns {void}
   */
  function persist(key: string, value: string): void {
    const next = { ...theme, [key]: value };
    if (!value) delete next[key];
    onChange(next);
  }

  const colorFields: Array<{ key: string; label: string }> = [
    { key: 'primaryColor', label: t('miniApps.themePrimary') },
    { key: 'backgroundColor', label: t('miniApps.themeBackground') },
    { key: 'textColor', label: t('miniApps.themeText') },
  ];

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {t('miniApps.themeEditor')}
      </Typography>
      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 1 }}>
        {colorFields.map((field) => (
          <TextField
            key={field.key}
            label={field.label}
            size="small"
            type="color"
            value={draft[field.key] || '#000000'}
            sx={{ width: 140 }}
            onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
            onBlur={() => persist(field.key, draft[field.key] ?? '')}
          />
        ))}
        <TextField
          label={t('miniApps.themeLogo')}
          size="small"
          fullWidth
          placeholder="https://…/logo.png"
          value={draft.logoUrl ?? ''}
          onChange={(event) => setDraft({ ...draft, logoUrl: event.target.value })}
          onBlur={(event) => persist('logoUrl', event.target.value.trim())}
          helperText={t('miniApps.themeHelp')}
        />
      </Stack>
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
        aria-label={t('miniApps.dataSectionsAria')}
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
      .catch((err: Error) => setError(localizedErrorMessage(err)))
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
            helperText={t('miniApps.slugHint')}
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
                {t(template.labelKey)}
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
    case 'leaderboard':
      return {};
    case 'support':
      return { greeting: 'Describe your issue and our team will reply here or in the bot chat.' };
    default:
      return {};
  }
}
