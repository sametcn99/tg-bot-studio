import React, { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  ButtonBase,
  Collapse,
  Divider,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import { modulesByCategory } from '../../registry/modules';
import { localizedCategory, useLocalizedModules } from '../../registry/localize';
import { moduleIcon } from '../ModuleIcons';
import { categorySlug, itemSx, normalize, RailTooltip, sectionLabelSx } from './shared';

/**
 * Router-linked sidebar item with an accent indicator for the active page.
 * @param {object} props - Component props.
 * @param {string} props.to - Target route.
 * @param {React.ReactElement} props.icon - Leading icon (decorative).
 * @param {string} props.label - Item label (also the accessible name).
 * @param {boolean} props.selected - Active state.
 * @param {boolean} props.collapsed - Icon-rail mode.
 * @param {number} [props.badge] - Optional trailing count.
 * @param {() => void} [props.onNavigate] - Called after navigation.
 * @returns {React.ReactElement} The item.
 */
export function NavItem({
  to,
  icon,
  label,
  selected,
  collapsed,
  badge,
  onNavigate,
}: {
  to: string;
  icon: React.ReactElement;
  label: string;
  selected: boolean;
  collapsed: boolean;
  badge?: number;
  onNavigate?: () => void;
}): React.ReactElement {
  return (
    <RailTooltip collapsed={collapsed} title={label}>
      <ListItemButton
        component={RouterLink}
        to={to}
        onClick={onNavigate}
        selected={selected}
        aria-current={selected ? 'page' : undefined}
        aria-label={collapsed ? label : undefined}
        sx={(theme) => itemSx(theme, collapsed)}
      >
        <ListItemIcon aria-hidden="true">{icon}</ListItemIcon>
        {!collapsed && (
          <ListItemText
            primary={label}
            slotProps={{ primary: { variant: 'body2', noWrap: true, fontWeight: 500 } }}
          />
        )}
        {!collapsed && badge !== undefined && badge > 0 && (
          <Box
            component="span"
            sx={(theme) => ({
              ml: 1,
              px: 0.75,
              minWidth: 22,
              height: 20,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '6px',
              fontSize: '0.6875rem',
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              color: selected ? 'inherit' : 'text.secondary',
              bgcolor: selected
                ? alpha(theme.palette.primary.main, 0.18)
                : alpha(theme.palette.text.primary, 0.07),
            })}
          >
            {badge}
          </Box>
        )}
      </ListItemButton>
    </RailTooltip>
  );
}

/**
 * Small uppercase section heading; renders a divider in icon-rail mode.
 * @param {object} props - Component props.
 * @param {string} props.label - Heading text.
 * @param {boolean} props.collapsed - Icon-rail mode.
 * @returns {React.ReactElement} The heading.
 */
export function SectionLabel({
  label,
  collapsed,
}: {
  label: string;
  collapsed: boolean;
}): React.ReactElement {
  const { i18n } = useTranslation();
  if (collapsed) return <Divider sx={{ mx: 1, my: 1 }} />;
  return (
    <Typography
      component="h2"
      color="text.secondary"
      noWrap
      sx={{ ...sectionLabelSx, px: 1.25, pt: 1.5, pb: 0.75 }}
    >
      {label.toLocaleUpperCase(i18n.language)}
    </Typography>
  );
}

/**
 * Module navigation grouped by registry category with collapsible
 * sections and live search filtering. The section owning the active
 * module auto-expands on navigation; searching force-expands matches.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id (route prefix).
 * @param {string | null} props.activeModuleKey - Active module route key.
 * @param {string} props.query - Search query (may be empty).
 * @param {boolean} props.collapsed - Icon-rail mode.
 * @param {() => void} [props.onNavigate] - Called after navigation.
 * @returns {React.ReactElement} The grouped module navigation.
 */
export function ModuleNavSections({
  botId,
  activeModuleKey,
  query,
  collapsed,
  onNavigate,
}: {
  botId: number;
  activeModuleKey: string | null;
  query: string;
  collapsed: boolean;
  onNavigate?: () => void;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const localizedModules = useLocalizedModules();
  const byKey = useMemo(
    () => new Map(localizedModules.map((module) => [module.key, module])),
    [localizedModules],
  );
  const groups = useMemo(() => modulesByCategory(), []);
  // Categories start expanded; users can collapse any section manually.
  const [closed, setClosed] = useState<Set<string>>(() => new Set());

  // Auto-expand the section owning the active module (including on later navigations).
  useEffect(() => {
    if (!activeModuleKey) return;
    const owner = groups.find(([, modules]) =>
      modules.some((module) => module.key === activeModuleKey),
    )?.[0];
    if (owner) {
      setClosed((current) => {
        if (!current.has(owner)) return current;
        const next = new Set(current);
        next.delete(owner);
        return next;
      });
    }
  }, [activeModuleKey, groups]);

  const needle = normalize(query.trim());
  const visibleGroups = useMemo(() => {
    if (!needle) return groups;
    return groups
      .map(([category, modules]): [string, typeof modules] => [
        category,
        modules.filter((module) => {
          const localized = byKey.get(module.key);
          const haystack = normalize(
            [module.key, module.name, localized?.name ?? '', localized?.description ?? ''].join(
              ' ',
            ),
          );
          return haystack.includes(needle);
        }),
      ])
      .filter(([, modules]) => modules.length > 0);
  }, [groups, needle, byKey]);

  /**
   * Toggles one category section.
   * @param {string} category - Category to toggle.
   * @returns {void}
   */
  function toggle(category: string): void {
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }

  if (needle && visibleGroups.length === 0) {
    return (
      <Box sx={{ px: 1.25, py: 3, textAlign: 'center' }}>
        <SearchIcon sx={{ fontSize: 28, color: 'text.disabled', mb: 0.5 }} aria-hidden="true" />
        <Typography variant="body2" color="text.secondary" role="status">
          {t('nav.noModuleResults')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {visibleGroups.map(([category, modules]) => {
        const categoryLabel = localizedCategory(t, category);
        const open = collapsed || Boolean(needle) || !closed.has(category);
        const containsActive = modules.some((module) => module.key === activeModuleKey);
        const list = (
          <List dense disablePadding role="group" aria-label={categoryLabel}>
            {modules.map((module) => {
              const Icon = moduleIcon(module.key);
              return (
                <NavItem
                  key={module.key}
                  to={`/bots/${botId}/m/${module.key}`}
                  icon={<Icon />}
                  label={byKey.get(module.key)?.name ?? module.name}
                  selected={activeModuleKey === module.key}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                />
              );
            })}
          </List>
        );

        if (collapsed) {
          return (
            <Box key={category}>
              <Divider sx={{ mx: 1, my: 1 }} />
              {list}
            </Box>
          );
        }

        return (
          <Box key={category} sx={{ mt: 0.5 }}>
            <ButtonBase
              onClick={() => toggle(category)}
              disabled={Boolean(needle)}
              aria-expanded={open}
              aria-controls={categorySlug(category)}
              sx={(theme) => ({
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.25,
                py: 0.875,
                borderRadius: '6px',
                color: 'text.secondary',
                transition: theme.transitions.create('color', {
                  duration: theme.transitions.duration.shortest,
                }),
                '&:hover': { color: 'text.primary' },
                '&.Mui-disabled': { color: 'text.secondary' },
              })}
            >
              <Typography
                component="span"
                noWrap
                sx={{ ...sectionLabelSx, flex: 1, textAlign: 'left' }}
              >
                {categoryLabel.toLocaleUpperCase(i18n.language)}
              </Typography>
              {!open && containsActive && (
                <Box
                  aria-hidden="true"
                  sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'primary.main' }}
                />
              )}
              <Typography
                component="span"
                sx={{ fontSize: '0.6875rem', fontWeight: 600, color: 'text.disabled' }}
              >
                {modules.length}
              </Typography>
              <ExpandMoreIcon
                aria-hidden="true"
                sx={(theme) => ({
                  fontSize: 16,
                  transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
                  transition: theme.transitions.create('transform', {
                    duration: theme.transitions.duration.shorter,
                  }),
                })}
              />
            </ButtonBase>
            <Collapse in={open} id={categorySlug(category)} timeout="auto">
              {list}
            </Collapse>
          </Box>
        );
      })}
    </Box>
  );
}
