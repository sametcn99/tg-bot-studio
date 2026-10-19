import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  Grid,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import GridViewIcon from '@mui/icons-material/GridView';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import SearchIcon from '@mui/icons-material/Search';
import ViewListIcon from '@mui/icons-material/ViewList';
import { apiFetch } from '../services/api';
import PageHeader from '../components/PageHeader';
import { EmptyState, LoadingState } from '../components/Feedback';
import { moduleIcon } from '../components/ModuleIcons';
import { normalize } from '../components/sidebar/shared';
import { localizedCategory, useLocalizedModules } from '../registry/localize';
import type { ModuleEntry } from '../registry/modules';
import { localizedErrorMessage } from '../utils/errors';
import { useModuleDocs } from '../context/ModuleDocsContext';

/**
 * Effective module state returned by `GET /api/bots/:id/modules`.
 * @interface ModuleState
 * @property {string} key - Module registry key.
 * @property {boolean} isEnabled - Runtime toggle state.
 * @property {Record<string, unknown>} config - Effective configuration.
 */
interface ModuleState {
  key: string;
  name: string;
  category: string;
  description: string;
  isEnabled: boolean;
  config: Record<string, unknown>;
}

/** API state merged with its localized registry entry. */
interface CatalogRow {
  state: ModuleState;
  entry: ModuleEntry | undefined;
}

/** Status segment shown in the toolbar toggle group. */
type StatusFilter = 'all' | 'enabled' | 'disabled';
/** Card grid vs compact row presentation. */
type ViewMode = 'grid' | 'list';
/** Registry order vs localized alphabetical order. */
type SortOrder = 'registry' | 'name';

/**
 * Switch with an inline spinner while the toggle request is in flight, kept
 * at a fixed footprint so pending swaps never shift the card layout.
 * @param {object} props - Component props.
 * @param {boolean} props.checked - Current (optimistic) toggle state.
 * @param {boolean} props.pending - True while the PUT request is in flight.
 * @param {string} props.ariaLabel - Accessible name for the switch.
 * @param {(checked: boolean) => void} props.onChange - Requests the new state.
 * @returns {React.ReactElement} The toggle control.
 */
function ToggleControl({
  checked,
  pending,
  ariaLabel,
  onChange,
}: {
  checked: boolean;
  pending: boolean;
  ariaLabel: string;
  onChange: (checked: boolean) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 46,
        height: 34,
        flexShrink: 0,
      }}
    >
      {pending ? (
        <CircularProgress size={18} aria-label={t('common.saving')} />
      ) : (
        <Switch
          size="small"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          slotProps={{ input: { 'aria-label': ariaLabel } }}
        />
      )}
    </Box>
  );
}

/**
 * Module icon inside a rounded, tinted tile whose color reflects the module's
 * enabled state. The icon component is resolved by the caller (outside this
 * component's render) and passed in.
 * @param {object} props - Component props.
 * @param {React.ElementType} props.icon - Icon component to render.
 * @param {boolean} props.enabled - Tints the tile with the accent color.
 * @param {number} [props.size=40] - Tile edge length in pixels.
 * @returns {React.ReactElement} The icon tile.
 */
function ModuleAvatar({
  icon: Icon,
  enabled,
  size = 40,
}: {
  icon: React.ElementType;
  enabled: boolean;
  size?: number;
}): React.ReactElement {
  return (
    <Box
      aria-hidden="true"
      sx={(theme) => ({
        width: size,
        height: size,
        borderRadius: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        color: enabled ? 'primary.main' : 'text.secondary',
        bgcolor: enabled
          ? alpha(theme.palette.primary.main, 0.12)
          : alpha(theme.palette.text.primary, 0.06),
        transition: theme.transitions.create(['color', 'background-color'], {
          duration: theme.transitions.duration.shortest,
        }),
      })}
    >
      <Icon fontSize={size >= 40 ? 'small' : 'inherit'} sx={{ fontSize: size >= 40 ? 22 : 18 }} />
    </Box>
  );
}

/** Small glowing status dot marking an enabled module. */
function EnabledDot(): React.ReactElement {
  return (
    <Box
      aria-hidden="true"
      sx={(theme) => ({
        width: 7,
        height: 7,
        borderRadius: '50%',
        flexShrink: 0,
        bgcolor: 'success.main',
        boxShadow: `0 0 0 3px ${alpha(theme.palette.success.main, 0.18)}`,
      })}
    />
  );
}

/**
 * Feature Toggles Center: searchable, filterable catalog of every bot module
 * with per-category sections, grid and list presentations, and instant
 * toggles that hot-reload the bot runtime.
 * @returns {React.ReactElement} The catalog page.
 */
export default function ModulesManagerPage(): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { botId } = useParams<{ botId: string }>();
  const navigate = useNavigate();
  const localizedModules = useLocalizedModules();
  const { openDocs } = useModuleDocs();
  const [states, setStates] = useState<ModuleState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());

  // Toolbar state: live search, status segment, category chip, sort, view.
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('registry');
  const [view, setView] = useState<ViewMode>('grid');
  const searchRef = useRef<HTMLInputElement>(null);
  const [closedSections, setClosedSections] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    apiFetch<ModuleState[]>(`/api/bots/${botId}/modules`)
      .then(setStates)
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }, [botId]);

  // "/" anywhere outside a text field focuses module search.
  useEffect(() => {
    /**
     * Focuses the search field on "/" unless the user is typing.
     * @param {KeyboardEvent} event - Global keydown event.
     * @returns {void}
     */
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const byKey = useMemo(
    () => new Map(localizedModules.map((module) => [module.key, module])),
    [localizedModules],
  );

  const rows = useMemo<CatalogRow[]>(() => {
    const base = (states ?? []).map((state) => ({
      state,
      entry: byKey.get(state.key),
    }));
    const needle = normalize(search.trim());
    const filtered = base.filter(({ state, entry }) => {
      if (statusFilter === 'enabled' && !state.isEnabled) return false;
      if (statusFilter === 'disabled' && state.isEnabled) return false;
      if (categoryFilter !== null && state.category !== categoryFilter) return false;
      if (needle) {
        const haystack = normalize(
          [
            state.key,
            state.name,
            entry?.name ?? '',
            state.description,
            entry?.description ?? '',
          ].join(' '),
        );
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
    if (sortOrder === 'name') {
      return [...filtered].sort((a, b) =>
        (a.entry?.name ?? a.state.name).localeCompare(b.entry?.name ?? b.state.name, i18n.language),
      );
    }
    return filtered;
  }, [states, byKey, search, statusFilter, categoryFilter, sortOrder, i18n.language]);

  // Category groups keep first-appearance (registry) order.
  const groups = useMemo(() => {
    const grouped = new Map<string, CatalogRow[]>();
    for (const row of rows) {
      const bucket = grouped.get(row.state.category);
      if (bucket) {
        bucket.push(row);
      } else {
        grouped.set(row.state.category, [row]);
      }
    }
    return [...grouped.entries()];
  }, [rows]);

  // Any filter that can hide cards force-expands every category section.
  const filtersActive = search.trim() !== '' || statusFilter !== 'all' || categoryFilter !== null;

  const enabledCount = (states ?? []).filter((state) => state.isEnabled).length;
  const total = states?.length ?? 0;
  const subtitle = t('modules.enabled', {
    count: enabledCount,
    total: total === 0 ? localizedModules.length : total,
  });

  /**
   * Toggles a module optimistically, tracking the in-flight request so the
   * switch can show a spinner and roll back on failure.
   * @param {CatalogRow} row - Module being toggled.
   * @param {boolean} enabled - Desired state.
   * @returns {void}
   */
  function toggle(row: CatalogRow, enabled: boolean): void {
    const key = row.state.key;
    setPendingKeys((current) => new Set(current).add(key));
    setStates((current) =>
      (current ?? []).map((entry) =>
        entry.key === key ? { ...entry, isEnabled: enabled } : entry,
      ),
    );
    apiFetch(`/api/bots/${botId}/modules/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ isEnabled: enabled, config: row.state.config }),
    })
      .catch(() => {
        setStates((current) =>
          (current ?? []).map((entry) =>
            entry.key === key ? { ...entry, isEnabled: !enabled } : entry,
          ),
        );
        setError(t('modules.toggleFailed'));
      })
      .finally(() => {
        setPendingKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      });
  }

  /**
   * Collapses or expands one category section.
   * @param {string} category - Category to toggle.
   * @returns {void}
   */
  function toggleSection(category: string): void {
    setClosedSections((current) => {
      const next = new Set(current);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }

  /** Clears search, status, and category filters in one action. */
  function resetFilters(): void {
    setSearch('');
    setStatusFilter('all');
    setCategoryFilter(null);
  }

  return (
    <Box>
      <PageHeader title={t('modules.managerTitle')} subtitle={subtitle} />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {states === null ? (
        <>
          <LoadingState label={t('common.loading')} />
          <Grid container spacing={1.5} aria-hidden="true">
            {Array.from({ length: 8 }, (_, index) => (
              <Grid size={{ xs: 12, md: 6, lg: 4 }} key={index}>
                <Card>
                  <CardContent>
                    <Stack spacing={1.25}>
                      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                        <Skeleton variant="rounded" width={40} height={40} />
                        <Skeleton height={22} sx={{ flex: 1 }} />
                        <Skeleton width={46} height={34} />
                      </Stack>
                      <Skeleton height={14} width="92%" />
                      <Skeleton height={14} width="68%" />
                      <Skeleton height={26} width={128} />
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </>
      ) : (
        <>
          <Paper sx={{ p: 1.5, mb: 3 }}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={1.25}
              sx={{ alignItems: { xs: 'stretch', md: 'center' } }}
            >
              <TextField
                size="small"
                value={search}
                inputRef={searchRef}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setSearch('');
                }}
                placeholder={t('modules.searchPlaceholder')}
                sx={{ maxWidth: { md: 340 } }}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                    endAdornment: search ? (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          aria-label={t('nav.clearSearch')}
                          onClick={() => setSearch('')}
                          edge="end"
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ) : (
                      <Box
                        component="span"
                        aria-hidden="true"
                        sx={(theme) => ({
                          display: { xs: 'none', sm: 'inline-block' },
                          px: 0.5,
                          minWidth: 20,
                          textAlign: 'center',
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          fontFamily: 'monospace',
                          color: 'text.disabled',
                          border: `1px solid ${theme.palette.divider}`,
                          borderRadius: 1,
                        })}
                      >
                        /
                      </Box>
                    ),
                  },
                }}
              />
              <ToggleButtonGroup
                exclusive
                size="small"
                value={statusFilter}
                onChange={(_, value: StatusFilter | null) => {
                  if (value !== null) setStatusFilter(value);
                }}
                aria-label={t('modules.statusFilter')}
              >
                <ToggleButton value="all">{t('modules.filterAll')}</ToggleButton>
                <ToggleButton value="enabled">{t('status.enabled')}</ToggleButton>
                <ToggleButton value="disabled">{t('status.disabled')}</ToggleButton>
              </ToggleButtonGroup>
              <TextField
                select
                size="small"
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value as SortOrder)}
                sx={{ minWidth: 168 }}
                slotProps={{ select: { 'aria-label': t('modules.sortLabel') } }}
              >
                <MenuItem value="registry">{t('modules.sortDefault')}</MenuItem>
                <MenuItem value="name">{t('modules.sortName')}</MenuItem>
              </TextField>
              <Box sx={{ flexGrow: 1 }} />
              <ToggleButtonGroup
                exclusive
                size="small"
                value={view}
                onChange={(_, value: ViewMode | null) => {
                  if (value !== null) setView(value);
                }}
                aria-label={t('modules.viewLabel')}
              >
                <ToggleButton value="grid" aria-label={t('modules.viewGrid')}>
                  <GridViewIcon fontSize="small" />
                </ToggleButton>
                <ToggleButton value="list" aria-label={t('modules.viewList')}>
                  <ViewListIcon fontSize="small" />
                </ToggleButton>
              </ToggleButtonGroup>
            </Stack>

            <Stack
              direction="row"
              useFlexGap
              spacing={1}
              sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}
            >
              <Chip
                size="small"
                clickable
                label={`${t('modules.allCategories')} · ${total}`}
                color={categoryFilter === null ? 'primary' : 'default'}
                variant={categoryFilter === null ? 'filled' : 'outlined'}
                onClick={() => setCategoryFilter(null)}
              />
              {[...new Set(states.map((state) => state.category))].map((category) => {
                const active = categoryFilter === category;
                const categoryCount = states.filter((state) => state.category === category).length;
                return (
                  <Chip
                    key={category}
                    size="small"
                    clickable
                    label={`${localizedCategory(t, category)} · ${categoryCount}`}
                    color={active ? 'primary' : 'default'}
                    variant={active ? 'filled' : 'outlined'}
                    onClick={() => setCategoryFilter(active ? null : category)}
                  />
                );
              })}
            </Stack>

            {total > 0 && (
              <LinearProgress
                variant="determinate"
                value={(enabledCount / total) * 100}
                aria-label={subtitle}
                sx={{ mt: 1.5, height: 6, borderRadius: 3 }}
              />
            )}
          </Paper>

          {rows.length === 0 ? (
            <EmptyState
              message={t('modules.noResults')}
              action={
                filtersActive ? (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<CloseIcon />}
                    onClick={resetFilters}
                  >
                    {t('modules.clearFilters')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            groups.map(([category, categoryRows]) => {
              const label = localizedCategory(t, category);
              const enabledInSection = categoryRows.filter((row) => row.state.isEnabled).length;
              const open = filtersActive || !closedSections.has(category);
              return (
                <Box component="section" key={category} aria-label={label} sx={{ mb: 2.5 }}>
                  <ButtonBase
                    onClick={() => toggleSection(category)}
                    disabled={filtersActive}
                    aria-expanded={open}
                    sx={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      px: 0.5,
                      py: 0.75,
                      borderRadius: 1.5,
                      '&.Mui-disabled': { cursor: 'default' },
                    }}
                  >
                    <Typography
                      component="h3"
                      sx={{
                        color: 'text.secondary',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {label.toLocaleUpperCase(i18n.language)}
                    </Typography>
                    <Typography
                      component="span"
                      sx={{
                        fontSize: '0.6875rem',
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                        color: 'text.disabled',
                      }}
                    >
                      {enabledInSection}/{categoryRows.length}
                    </Typography>
                    <ExpandMoreIcon
                      aria-hidden="true"
                      sx={(theme) => ({
                        ml: 'auto',
                        fontSize: 18,
                        color: 'text.disabled',
                        transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
                        transition: theme.transitions.create('transform', {
                          duration: theme.transitions.duration.shorter,
                        }),
                      })}
                    />
                  </ButtonBase>
                  <Collapse in={open} timeout="auto">
                    {view === 'grid' ? (
                      <Grid container spacing={1.5}>
                        {categoryRows.map((row) => {
                          const { state, entry } = row;
                          const name = entry?.name ?? state.name;
                          const pending = pendingKeys.has(state.key);
                          return (
                            <Grid size={{ xs: 12, md: 6, lg: 4 }} key={state.key}>
                              <Card
                                sx={(theme) => ({
                                  height: '100%',
                                  position: 'relative',
                                  overflow: 'hidden',
                                  transition: theme.transitions.create(
                                    ['transform', 'box-shadow', 'border-color'],
                                    { duration: theme.transitions.duration.shortest },
                                  ),
                                  ...(state.isEnabled && {
                                    borderColor: alpha(theme.palette.primary.main, 0.5),
                                    '&::before': {
                                      content: '""',
                                      position: 'absolute',
                                      inset: '0 0 auto 0',
                                      height: 3,
                                      background: `linear-gradient(90deg, ${theme.palette.primary.main}, ${alpha(theme.palette.primary.main, 0)})`,
                                    },
                                  }),
                                  '@media (hover: hover)': {
                                    '&:hover': {
                                      transform: 'translateY(-2px)',
                                      boxShadow: theme.shadows[4],
                                      borderColor: alpha(
                                        theme.palette.primary.main,
                                        state.isEnabled ? 0.8 : 0.35,
                                      ),
                                    },
                                  },
                                })}
                              >
                                <CardContent>
                                  <Stack spacing={1} sx={{ height: '100%' }}>
                                    <Stack
                                      direction="row"
                                      spacing={1.25}
                                      sx={{ alignItems: 'center' }}
                                    >
                                      <ModuleAvatar
                                        icon={moduleIcon(state.key)}
                                        enabled={state.isEnabled}
                                      />
                                      <Stack
                                        direction="row"
                                        spacing={0.75}
                                        sx={{
                                          alignItems: 'center',
                                          flex: 1,
                                          minWidth: 0,
                                        }}
                                      >
                                        <Typography
                                          variant="subtitle2"
                                          component="h4"
                                          noWrap
                                          title={name}
                                        >
                                          {name}
                                        </Typography>
                                        {state.isEnabled && <EnabledDot />}
                                      </Stack>
                                      <ToggleControl
                                        checked={state.isEnabled}
                                        pending={pending}
                                        ariaLabel={`${name} ${t('status.enabled')}`}
                                        onChange={(checked) => toggle(row, checked)}
                                      />
                                    </Stack>
                                    <Typography
                                      variant="caption"
                                      sx={(theme) => ({
                                        color: 'text.secondary',
                                        lineHeight: 1.55,
                                        flexGrow: 1,
                                        display: '-webkit-box',
                                        WebkitLineClamp: 3,
                                        WebkitBoxOrient: 'vertical',
                                        overflow: 'hidden',
                                        ...(state.isEnabled && {
                                          color: alpha(theme.palette.text.secondary, 0.95),
                                        }),
                                      })}
                                    >
                                      {entry?.description ?? state.description}
                                    </Typography>
                                    <Stack
                                      direction="row"
                                      spacing={1}
                                      sx={{
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        mt: 'auto',
                                      }}
                                    >
                                      <Button
                                        size="small"
                                        startIcon={<MenuBookOutlinedIcon />}
                                        disabled={!entry}
                                        onClick={() => {
                                          if (entry) openDocs(entry);
                                        }}
                                        sx={{ color: 'text.secondary' }}
                                      >
                                        {t('modules.docsLink')}
                                      </Button>
                                      <Button
                                        size="small"
                                        endIcon={<ArrowForwardIcon />}
                                        onClick={() => navigate(`/bots/${botId}/m/${state.key}`)}
                                      >
                                        {t('modules.configureLink')}
                                      </Button>
                                    </Stack>
                                  </Stack>
                                </CardContent>
                              </Card>
                            </Grid>
                          );
                        })}
                      </Grid>
                    ) : (
                      <Paper>
                        <Stack divider={<Divider />}>
                          {categoryRows.map((row) => {
                            const { state, entry } = row;
                            const name = entry?.name ?? state.name;
                            const pending = pendingKeys.has(state.key);
                            return (
                              <Stack
                                key={state.key}
                                direction="row"
                                spacing={1.5}
                                sx={{ alignItems: 'center', px: 2, py: 1.25 }}
                              >
                                <ModuleAvatar
                                  icon={moduleIcon(state.key)}
                                  enabled={state.isEnabled}
                                  size={32}
                                />
                                <Stack sx={{ flex: 1, minWidth: 0 }}>
                                  <Stack
                                    direction="row"
                                    spacing={0.75}
                                    sx={{ alignItems: 'center' }}
                                  >
                                    <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                                      {name}
                                    </Typography>
                                    {state.isEnabled && <EnabledDot />}
                                  </Stack>
                                  <Typography
                                    variant="caption"
                                    noWrap
                                    title={entry?.description ?? state.description}
                                    sx={{ color: 'text.secondary' }}
                                  >
                                    {entry?.description ?? state.description}
                                  </Typography>
                                </Stack>
                                <Tooltip title={t('modules.docsLink')}>
                                  <span>
                                    <IconButton
                                      size="small"
                                      disabled={!entry}
                                      aria-label={`${name} ${t('modules.docsLink')}`}
                                      onClick={() => {
                                        if (entry) openDocs(entry);
                                      }}
                                    >
                                      <MenuBookOutlinedIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                                <Button
                                  size="small"
                                  sx={{ color: 'text.secondary', flexShrink: 0 }}
                                  onClick={() => navigate(`/bots/${botId}/m/${state.key}`)}
                                >
                                  {t('modules.configureLink')}
                                </Button>
                                <ToggleControl
                                  checked={state.isEnabled}
                                  pending={pending}
                                  ariaLabel={`${name} ${t('status.enabled')}`}
                                  onChange={(checked) => toggle(row, checked)}
                                />
                              </Stack>
                            );
                          })}
                        </Stack>
                      </Paper>
                    )}
                  </Collapse>
                </Box>
              );
            })
          )}
        </>
      )}
    </Box>
  );
}
