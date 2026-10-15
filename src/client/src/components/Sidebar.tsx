import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Avatar,
  Box,
  ButtonBase,
  Collapse,
  Divider,
  IconButton,
  InputBase,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Select,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme, type Theme } from '@mui/material/styles';
import { keyframes } from '@emotion/react';
import { useTranslation } from 'react-i18next';
import { UI_LANGUAGES } from '../i18n';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined';
import LanguageIcon from '@mui/icons-material/Language';
import TelegramIcon from '@mui/icons-material/Telegram';
import AppsIcon from '@mui/icons-material/Apps';
import SpaceDashboardOutlinedIcon from '@mui/icons-material/SpaceDashboardOutlined';
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined';
import PhoneIphoneIcon from '@mui/icons-material/PhoneIphone';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import CheckIcon from '@mui/icons-material/Check';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import KeyboardDoubleArrowLeftIcon from '@mui/icons-material/KeyboardDoubleArrowLeft';
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight';
import { useBots, type BotSummary } from '../context/BotContext';
import { useAuth } from '../context/AuthContext';
import { useThemeMode } from '../theme';
import { modulesByCategory } from '../registry/modules';
import { localizedCategory, useLocalizedModules } from '../registry/localize';
import { moduleIcon } from './ModuleIcons';
import { colorFor as statusColor } from './StatusDot';

/** Expanded sidebar width in pixels. */
export const SIDEBAR_WIDTH = 272;

/** Collapsed (icon rail) sidebar width in pixels. */
export const SIDEBAR_COLLAPSED_WIDTH = 76;

/** Deterministic avatar gradients, picked by bot id. */
const AVATAR_GRADIENTS: Array<[string, string]> = [
  ['#3b82f6', '#8b5cf6'],
  ['#06b6d4', '#3b82f6'],
  ['#10b981', '#06b6d4'],
  ['#f59e0b', '#ef4444'],
  ['#ec4899', '#8b5cf6'],
  ['#14b8a6', '#22c55e'],
];

/** Soft "live" ring for active bots. */
const pulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.55); }
  70% { box-shadow: 0 0 0 6px rgba(22, 163, 74, 0); }
  100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0); }
`;

/** Whether the platform uses ⌘ instead of Ctrl for shortcuts. */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent);

/**
 * Normalizes text for accent/case-insensitive search (handles Turkish
 * dotted/dotless i so "modul" matches "Modül").
 * @param {string} value - Raw text.
 * @returns {string} Normalized text.
 */
function normalize(value: string): string {
  return value
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i');
}

/**
 * Builds up to two initials from a display name.
 * @param {string} name - Display name.
 * @returns {string} Uppercase initials.
 */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase() || '?';
}

/** Builds a DOM-id-safe slug from a category name. */
const categorySlug = (category: string): string =>
  `nav-group-${category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

/** Shared typography for small uppercase section labels. */
const sectionLabelSx = {
  fontSize: '0.6875rem',
  fontWeight: 600,
  letterSpacing: '0.08em',
  lineHeight: 1.4,
} as const;

/**
 * Sidebar item styles shared by link and action items.
 * @param {Theme} theme - Active MUI theme.
 * @param {boolean} collapsed - Icon-rail mode.
 * @returns {object} sx style object.
 */
function itemSx(theme: Theme, collapsed: boolean) {
  const dark = theme.palette.mode === 'dark';
  const primary = theme.palette.primary.main;
  return {
    position: 'relative',
    minHeight: 38,
    mb: 0.25,
    px: collapsed ? 0 : 1.25,
    borderRadius: '8px',
    justifyContent: collapsed ? 'center' : 'flex-start',
    color: theme.palette.text.secondary,
    transition: theme.transitions.create(['background-color', 'color'], {
      duration: theme.transitions.duration.shortest,
    }),
    '& .MuiListItemIcon-root': {
      minWidth: collapsed ? 0 : 34,
      color: 'inherit',
      justifyContent: 'center',
      '& svg': { fontSize: 20 },
    },
    '&:hover': {
      bgcolor: alpha(theme.palette.text.primary, dark ? 0.06 : 0.045),
      color: theme.palette.text.primary,
    },
    '&.Mui-selected': {
      bgcolor: alpha(primary, dark ? 0.16 : 0.09),
      color: dark ? theme.palette.primary.light : primary,
      '& .MuiListItemText-primary': { fontWeight: 600 },
      '&:hover': { bgcolor: alpha(primary, dark ? 0.22 : 0.13) },
      '&::before': {
        content: '""',
        position: 'absolute',
        left: -12,
        top: '50%',
        transform: 'translateY(-50%)',
        width: 3,
        height: 20,
        borderRadius: '0 4px 4px 0',
        bgcolor: dark ? theme.palette.primary.light : primary,
      },
    },
  };
}

/**
 * Wraps a node in a right-side tooltip only when the rail is collapsed.
 * @param {object} props - Component props.
 * @param {boolean} props.collapsed - Icon-rail mode.
 * @param {string} props.title - Tooltip text.
 * @param {React.ReactElement} props.children - Anchor element.
 * @returns {React.ReactElement} The (optionally) wrapped element.
 */
function RailTooltip({
  collapsed,
  title,
  children,
}: {
  collapsed: boolean;
  title: string;
  children: React.ReactElement;
}): React.ReactElement {
  if (!collapsed) return children;
  return (
    <Tooltip title={title} placement="right" arrow disableInteractive>
      {children}
    </Tooltip>
  );
}

/**
 * Gradient brand tile used in the sidebar header and the compact top bar.
 * @param {object} props - Component props.
 * @param {number} [props.size=36] - Tile size in pixels.
 * @returns {React.ReactElement} The brand mark.
 */
export function BrandMark({ size = 36 }: { size?: number }): React.ReactElement {
  return (
    <Box
      aria-hidden="true"
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: `${Math.round(size * 0.28)}px`,
        display: 'grid',
        placeItems: 'center',
        color: '#fff',
        background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 55%, #8b5cf6 100%)',
        boxShadow: `0 6px 16px -6px ${alpha('#4f46e5', 0.7)}, inset 0 1px 0 rgba(255,255,255,0.25)`,
      }}
    >
      <TelegramIcon sx={{ fontSize: Math.round(size * 0.6) }} />
    </Box>
  );
}

/**
 * Rounded gradient avatar with bot initials and a live status badge.
 * @param {object} props - Component props.
 * @param {BotSummary} props.bot - Bot to render.
 * @param {number} props.size - Avatar size in pixels.
 * @returns {React.ReactElement} The avatar.
 */
function BotAvatar({ bot, size }: { bot: BotSummary; size: number }): React.ReactElement {
  const { t } = useTranslation();
  const [from, to] = AVATAR_GRADIENTS[Math.abs(bot.id) % AVATAR_GRADIENTS.length];
  const statusLabel = t(`status.${bot.status}`, {
    defaultValue: bot.status.charAt(0).toUpperCase() + bot.status.slice(1),
  });
  return (
    <Box sx={{ position: 'relative', flexShrink: 0, lineHeight: 0 }}>
      <Avatar
        variant="rounded"
        sx={{
          width: size,
          height: size,
          borderRadius: `${Math.round(size * 0.28)}px`,
          fontSize: Math.round(size * 0.38),
          fontWeight: 700,
          color: '#fff',
          background: `linear-gradient(135deg, ${from}, ${to})`,
        }}
      >
        {initials(bot.name)}
      </Avatar>
      <Box
        role="img"
        aria-label={statusLabel}
        sx={(theme) => ({
          position: 'absolute',
          right: -2,
          bottom: -2,
          width: 10,
          height: 10,
          borderRadius: '50%',
          bgcolor: statusColor(bot.status),
          border: `2px solid ${theme.palette.background.paper}`,
          animation: bot.status === 'active' ? `${pulse} 2.4s ease-out infinite` : 'none',
        })}
      />
    </Box>
  );
}

/**
 * Workspace-style bot switcher card (Linear/Vercel pattern): shows the
 * active bot and opens a menu to switch bots or jump to the bot list.
 * @param {object} props - Component props.
 * @param {boolean} props.collapsed - Icon-rail mode.
 * @param {() => void} [props.onNavigate] - Called after a navigation (closes mobile drawer).
 * @returns {React.ReactElement} The switcher.
 */
function BotSwitcherCard({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { bots, activeBot, setActiveBotId } = useBots();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = Boolean(anchor);
  const buttonId = collapsed ? 'sidebar-bot-switcher-rail' : 'sidebar-bot-switcher';
  const menuId = `${buttonId}-menu`;

  /**
   * Activates a bot and opens its dashboard.
   * @param {number} botId - Selected bot id.
   * @returns {void}
   */
  function select(botId: number): void {
    setActiveBotId(botId);
    setAnchor(null);
    navigate(`/bots/${botId}`);
    onNavigate?.();
  }

  const subtitle = activeBot
    ? activeBot.username
      ? `@${activeBot.username}`
      : `ID ${activeBot.id}`
    : t('nav.selectBotHint');

  return (
    <>
      <RailTooltip collapsed={collapsed} title={activeBot?.name ?? t('nav.switchBot')}>
        <ButtonBase
          id={buttonId}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-label={collapsed ? t('nav.switchBot') : undefined}
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={(theme) => ({
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: 1.25,
            p: collapsed ? 0.75 : 1,
            textAlign: 'left',
            borderRadius: '10px',
            border: '1px solid',
            borderColor: collapsed ? 'transparent' : 'divider',
            bgcolor: collapsed ? 'transparent' : alpha(theme.palette.text.primary, 0.025),
            transition: theme.transitions.create(['background-color', 'border-color'], {
              duration: theme.transitions.duration.shortest,
            }),
            '&:hover': {
              bgcolor: alpha(theme.palette.text.primary, 0.05),
              borderColor: collapsed ? 'transparent' : alpha(theme.palette.text.primary, 0.16),
            },
          })}
        >
          {activeBot ? (
            <BotAvatar bot={activeBot} size={34} />
          ) : (
            <Avatar
              variant="rounded"
              sx={{
                width: 34,
                height: 34,
                borderRadius: '10px',
                bgcolor: 'action.selected',
                color: 'text.secondary',
              }}
            >
              <SmartToyOutlinedIcon fontSize="small" />
            </Avatar>
          )}
          {!collapsed && (
            <>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" fontWeight={600} noWrap lineHeight={1.3}>
                  {activeBot?.name ?? t('nav.noBotSelected')}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  display="block"
                  lineHeight={1.3}
                >
                  {subtitle}
                </Typography>
              </Box>
              <UnfoldMoreIcon sx={{ fontSize: 18, color: 'text.secondary' }} aria-hidden="true" />
            </>
          )}
        </ButtonBase>
      </RailTooltip>

      <Menu
        id={menuId}
        anchorEl={anchor}
        open={open}
        onClose={() => setAnchor(null)}
        anchorOrigin={{
          vertical: collapsed ? 'top' : 'bottom',
          horizontal: collapsed ? 'right' : 'left',
        }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              width: 272,
              mt: collapsed ? 0 : 0.75,
              ml: collapsed ? 1 : 0,
              borderRadius: '12px',
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: (theme) =>
                theme.palette.mode === 'dark'
                  ? '0 16px 40px -12px rgba(0,0,0,0.7)'
                  : '0 16px 40px -12px rgba(15,23,42,0.25)',
            },
          },
          list: {
            'aria-labelledby': buttonId,
            dense: true,
            sx: { p: 0.75 },
          },
        }}
      >
        <ListSubheader
          disableSticky
          sx={{
            ...sectionLabelSx,
            bgcolor: 'transparent',
            color: 'text.secondary',
            px: 1,
            pt: 0.5,
            pb: 0.75,
          }}
        >
          {t('nav.switchBot')}
        </ListSubheader>
        {bots.length === 0 && (
          <MenuItem disabled sx={{ borderRadius: '8px' }}>
            <Typography variant="body2">{t('nav.noBots')}</Typography>
          </MenuItem>
        )}
        {bots.map((bot) => {
          const selected = activeBot?.id === bot.id;
          return (
            <MenuItem
              key={bot.id}
              selected={selected}
              onClick={() => select(bot.id)}
              sx={{ borderRadius: '8px', gap: 1.25, py: 0.75, mb: 0.25 }}
            >
              <BotAvatar bot={bot} size={28} />
              <ListItemText
                primary={bot.name}
                secondary={bot.username ? `@${bot.username}` : `ID ${bot.id}`}
                slotProps={{
                  primary: { variant: 'body2', fontWeight: 600, noWrap: true },
                  secondary: { variant: 'caption', noWrap: true },
                }}
              />
              {selected && <CheckIcon fontSize="small" color="primary" aria-hidden="true" />}
            </MenuItem>
          );
        })}
        <Divider sx={{ my: 0.75 }} />
        <MenuItem
          onClick={() => {
            setAnchor(null);
            navigate('/');
            onNavigate?.();
          }}
          sx={{ borderRadius: '8px' }}
        >
          <ListItemIcon>
            <AppsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={t('nav.allBots')} slotProps={{ primary: { variant: 'body2' } }} />
        </MenuItem>
      </Menu>
    </>
  );
}

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
function NavItem({
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
function SectionLabel({
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
function ModuleNavSections({
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

/**
 * Sidebar props.
 * @interface SidebarProps
 * @property {boolean} [collapsed] - Render as a compact icon rail.
 * @property {() => void} [onToggleCollapsed] - Shows the collapse toggle when provided.
 * @property {() => void} [onNavigate] - Called after any navigation (e.g. closes the mobile drawer).
 * @property {boolean} [enableShortcut] - Registers the global Ctrl/⌘+K search shortcut.
 */
export interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
  enableShortcut?: boolean;
}

/**
 * Primary application sidebar: brand header, bot switcher card, module
 * search, workspace links, category-grouped module navigation, and a
 * footer with account links and the rail collapse toggle.
 * @param {SidebarProps} props - Component props.
 * @returns {React.ReactElement} The sidebar.
 */
export default function Sidebar({
  collapsed = false,
  onToggleCollapsed,
  onNavigate,
  enableShortcut = false,
}: SidebarProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const { activeBot } = useBots();
  const { logout } = useAuth();
  const { mode, toggle: toggleTheme } = useThemeMode();
  const localizedModules = useLocalizedModules();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const focusAfterExpand = useRef(false);

  const currentLang = i18n.language || 'en';
  const currentLanguageMeta =
    UI_LANGUAGES.find((language) => language.code === currentLang) ?? UI_LANGUAGES[0];

  /**
   * Applies a dashboard language choice.
   * @param {string} code - Language code from UI_LANGUAGES.
   * @returns {void}
   */
  function selectLanguage(code: string): void {
    void i18n.changeLanguage(code);
    localStorage.setItem('studio_language', code);
  }

  const pathname = location.pathname;
  const parts = pathname.split('/').filter(Boolean);
  const activeModuleKey = parts[0] === 'bots' && parts[2] === 'm' ? (parts[3] ?? null) : null;
  const botBase = activeBot ? `/bots/${activeBot.id}` : null;
  const showSearch = Boolean(activeBot) && !collapsed;

  // Global Ctrl/⌘+K focuses module search (expanding the rail first if needed).
  useEffect(() => {
    if (!enableShortcut || !activeBot) return;
    const handler = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (collapsed && onToggleCollapsed) {
          focusAfterExpand.current = true;
          onToggleCollapsed();
        } else {
          searchRef.current?.focus();
          searchRef.current?.select();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enableShortcut, activeBot, collapsed, onToggleCollapsed]);

  useEffect(() => {
    if (!collapsed && focusAfterExpand.current) {
      focusAfterExpand.current = false;
      searchRef.current?.focus();
    }
  }, [collapsed]);

  /**
   * Keyboard handling for the search input: Escape clears, Enter opens
   * the first matching module.
   * @param {React.KeyboardEvent<HTMLInputElement>} event - Key event.
   * @returns {void}
   */
  function handleSearchKey(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      if (query) {
        event.stopPropagation();
        setQuery('');
      } else {
        searchRef.current?.blur();
      }
      return;
    }
    if (event.key === 'Enter' && botBase) {
      const needle = normalize(query.trim());
      if (!needle) return;
      const match = localizedModules.find((module) =>
        normalize(`${module.key} ${module.name} ${module.description}`).includes(needle),
      );
      if (match) {
        navigate(`${botBase}/m/${match.key}`);
        setQuery('');
        onNavigate?.();
      }
    }
  }

  const dark = theme.palette.mode === 'dark';

  return (
    <Box
      component="nav"
      aria-label={t('nav.primary')}
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: 'background.paper',
        backgroundImage: `linear-gradient(180deg, ${alpha(theme.palette.primary.main, dark ? 0.07 : 0.04)} 0%, transparent 240px)`,
      }}
    >
      {/* Brand */}
      <Box
        component={RouterLink}
        to="/"
        onClick={onNavigate}
        aria-label={t('app.title')}
        sx={{
          height: 64,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: 1.5,
          px: collapsed ? 0 : 2.5,
          color: 'text.primary',
          textDecoration: 'none',
        }}
      >
        <BrandMark />
        {!collapsed && (
          <Box sx={{ minWidth: 0 }}>
            <Typography
              noWrap
              sx={{
                fontWeight: 700,
                fontSize: '0.9375rem',
                letterSpacing: '-0.01em',
                lineHeight: 1.25,
              }}
            >
              {t('app.title')}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              display="block"
              lineHeight={1.3}
            >
              {t('app.subtitle')}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Bot switcher */}
      <Box sx={{ px: collapsed ? 1.5 : 2, pb: 1.5, flexShrink: 0 }}>
        <BotSwitcherCard collapsed={collapsed} onNavigate={onNavigate} />
      </Box>

      {/* Module search */}
      {showSearch && (
        <Box sx={{ px: 2, pb: 1, flexShrink: 0 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              height: 36,
              pl: 1.25,
              pr: 0.75,
              borderRadius: '8px',
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: alpha(theme.palette.text.primary, 0.03),
              transition: theme.transitions.create(
                ['border-color', 'box-shadow', 'background-color'],
                {
                  duration: theme.transitions.duration.shortest,
                },
              ),
              '&:hover': { borderColor: alpha(theme.palette.text.primary, 0.2) },
              '&:focus-within': {
                borderColor: 'primary.main',
                bgcolor: 'background.paper',
                boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.18)}`,
              },
              '& input:focus-visible': { outline: 'none' },
            }}
          >
            <SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} aria-hidden="true" />
            <InputBase
              inputRef={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKey}
              placeholder={t('nav.searchModules')}
              inputProps={{ 'aria-label': t('nav.searchModules'), spellCheck: false }}
              sx={{ flex: 1, fontSize: '0.8125rem', '& input': { p: 0 } }}
            />
            {query ? (
              <IconButton
                size="small"
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
                aria-label={t('nav.clearSearch')}
                sx={{ p: 0.25 }}
              >
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            ) : (
              enableShortcut && (
                <Box
                  component="kbd"
                  aria-hidden="true"
                  sx={{
                    px: 0.75,
                    py: 0.125,
                    borderRadius: '5px',
                    border: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'background.paper',
                    color: 'text.secondary',
                    fontFamily: 'inherit',
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                    lineHeight: 1.6,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {IS_MAC ? '⌘K' : 'Ctrl K'}
                </Box>
              )
            )}
          </Box>
        </Box>
      )}

      {/* Scrollable navigation */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          px: 1.5,
          pb: 1.5,
          scrollbarWidth: 'thin',
          scrollbarColor: 'transparent transparent',
          '&:hover': { scrollbarColor: `${alpha(theme.palette.text.primary, 0.2)} transparent` },
          '&::-webkit-scrollbar': { width: 6 },
          '&::-webkit-scrollbar-thumb': { borderRadius: 3, bgcolor: 'transparent' },
          '&:hover::-webkit-scrollbar-thumb': { bgcolor: alpha(theme.palette.text.primary, 0.2) },
        }}
      >
        {!query.trim() && (
          <>
            <SectionLabel label={t('nav.workspace')} collapsed={collapsed} />
            <List dense disablePadding aria-label={t('nav.studio')}>
              <NavItem
                to="/"
                icon={<AppsIcon />}
                label={t('nav.overview')}
                selected={pathname === '/'}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
              {activeBot && botBase && (
                <>
                  <NavItem
                    to={botBase}
                    icon={<SpaceDashboardOutlinedIcon />}
                    label={t('nav.botDashboard')}
                    selected={pathname === botBase}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                  />
                  <NavItem
                    to={`${botBase}/modules`}
                    icon={<ExtensionOutlinedIcon />}
                    label={t('nav.modules')}
                    selected={pathname === `${botBase}/modules`}
                    collapsed={collapsed}
                    badge={activeBot.activeModules}
                    onNavigate={onNavigate}
                  />
                  <NavItem
                    to={`${botBase}/mini-apps`}
                    icon={<PhoneIphoneIcon />}
                    label={t('nav.miniApps')}
                    selected={pathname === `${botBase}/mini-apps`}
                    collapsed={collapsed}
                    badge={activeBot.miniApps}
                    onNavigate={onNavigate}
                  />
                </>
              )}
            </List>
          </>
        )}

        {activeBot && (
          <ModuleNavSections
            botId={activeBot.id}
            activeModuleKey={activeModuleKey}
            query={collapsed ? '' : query}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        )}
      </Box>

      {/* Footer */}
      <Box
        sx={{
          flexShrink: 0,
          px: 1.5,
          py: 1.25,
          borderTop: '1px solid',
          borderColor: 'divider',
          bgcolor: alpha(theme.palette.text.primary, dark ? 0.02 : 0.015),
        }}
      >
        <List dense disablePadding aria-label={t('nav.account')}>
          <NavItem
            to="/security"
            icon={<ShieldOutlinedIcon />}
            label={t('nav.security')}
            selected={pathname === '/security'}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        </List>

        <Divider sx={{ my: 1 }} />

        {collapsed ? (
          <Stack spacing={0.75} alignItems="center">
            <RailTooltip collapsed={true} title={t('nav.expandSidebar')}>
              <IconButton
                size="small"
                onClick={onToggleCollapsed}
                aria-label={t('nav.expandSidebar')}
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: '8px',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <LanguageIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </RailTooltip>

            <RailTooltip
              collapsed={true}
              title={mode === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}
            >
              <IconButton
                size="small"
                onClick={toggleTheme}
                aria-label={t('nav.toggleTheme')}
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: '8px',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                {mode === 'dark' ? (
                  <LightModeOutlinedIcon sx={{ fontSize: 18 }} />
                ) : (
                  <DarkModeOutlinedIcon sx={{ fontSize: 18 }} />
                )}
              </IconButton>
            </RailTooltip>

            <RailTooltip collapsed={true} title={t('nav.signOut')}>
              <IconButton
                size="small"
                onClick={logout}
                aria-label={t('nav.signOut')}
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: '8px',
                  border: '1px solid',
                  borderColor: 'divider',
                  '&:hover': {
                    color: 'error.main',
                    borderColor: 'error.main',
                    bgcolor: alpha(theme.palette.error.main, 0.08),
                  },
                }}
              >
                <LogoutOutlinedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </RailTooltip>

            {onToggleCollapsed && (
              <RailTooltip collapsed={true} title={t('nav.expandSidebar')}>
                <IconButton
                  size="small"
                  onClick={onToggleCollapsed}
                  aria-label={t('nav.expandSidebar')}
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: '8px',
                    border: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <KeyboardDoubleArrowRightIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </RailTooltip>
            )}
          </Stack>
        ) : (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 0.75,
            }}
          >
            <Stack direction="row" spacing={0.75} alignItems="center">
              {/* Language select */}
              <Tooltip title={t('nav.language')} arrow>
                <Select
                  size="small"
                  value={currentLanguageMeta.code}
                  onChange={(event) => selectLanguage(String(event.target.value))}
                  aria-label={t('nav.language')}
                  sx={(th) => ({
                    height: 34,
                    minWidth: 104,
                    borderRadius: '8px',
                    border: '1px solid',
                    borderColor: 'divider',
                    color: 'text.secondary',
                    bgcolor: alpha(th.palette.text.primary, 0.02),
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
                    '&:hover': {
                      color: 'text.primary',
                      bgcolor: alpha(th.palette.text.primary, 0.06),
                    },
                    '& .MuiSelect-select': {
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.75,
                      py: 0.625,
                    },
                  })}
                >
                  {UI_LANGUAGES.map((language) => (
                    <MenuItem key={language.code} value={language.code} dense>
                      {language.native}
                    </MenuItem>
                  ))}
                </Select>
              </Tooltip>

              {/* Theme toggle */}
              <Tooltip title={mode === 'dark' ? t('nav.lightMode') : t('nav.darkMode')} arrow>
                <IconButton
                  size="small"
                  onClick={toggleTheme}
                  aria-label={t('nav.toggleTheme')}
                  sx={(th) => ({
                    width: 34,
                    height: 34,
                    borderRadius: '8px',
                    border: '1px solid',
                    borderColor: 'divider',
                    color: 'text.secondary',
                    bgcolor: alpha(th.palette.text.primary, 0.02),
                    '&:hover': {
                      color: 'text.primary',
                      borderColor: alpha(th.palette.text.primary, 0.2),
                      bgcolor: alpha(th.palette.text.primary, 0.06),
                    },
                  })}
                >
                  {mode === 'dark' ? (
                    <LightModeOutlinedIcon sx={{ fontSize: 18 }} />
                  ) : (
                    <DarkModeOutlinedIcon sx={{ fontSize: 18 }} />
                  )}
                </IconButton>
              </Tooltip>

              {/* Sign out */}
              <Tooltip title={t('nav.signOut')} arrow>
                <IconButton
                  size="small"
                  onClick={logout}
                  aria-label={t('nav.signOut')}
                  sx={(th) => ({
                    width: 34,
                    height: 34,
                    borderRadius: '8px',
                    border: '1px solid',
                    borderColor: 'divider',
                    color: 'text.secondary',
                    bgcolor: alpha(th.palette.text.primary, 0.02),
                    '&:hover': {
                      color: 'error.main',
                      borderColor: 'error.main',
                      bgcolor: alpha(th.palette.error.main, 0.08),
                    },
                  })}
                >
                  <LogoutOutlinedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            </Stack>

            {/* Collapse rail toggle */}
            {onToggleCollapsed && (
              <Tooltip title={t('nav.collapseSidebar')} arrow>
                <IconButton
                  size="small"
                  onClick={onToggleCollapsed}
                  aria-label={t('nav.collapseSidebar')}
                  sx={(th) => ({
                    width: 34,
                    height: 34,
                    borderRadius: '8px',
                    border: '1px solid',
                    borderColor: 'divider',
                    color: 'text.secondary',
                    bgcolor: alpha(th.palette.text.primary, 0.02),
                    '&:hover': {
                      color: 'text.primary',
                      borderColor: alpha(th.palette.text.primary, 0.2),
                      bgcolor: alpha(th.palette.text.primary, 0.06),
                    },
                  })}
                >
                  <KeyboardDoubleArrowLeftIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
