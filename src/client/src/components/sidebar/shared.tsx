import React from 'react';
import { Avatar, Box, Tooltip } from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import { keyframes } from '@emotion/react';
import { useTranslation } from 'react-i18next';
import TelegramIcon from '@mui/icons-material/Telegram';
import type { BotSummary } from '../../context/BotContext';
import { colorFor as statusColor } from '../StatusDot';

/** Expanded sidebar width in pixels. */
export const SIDEBAR_WIDTH = 272;

/** Collapsed (icon rail) sidebar width in pixels. */
export const SIDEBAR_COLLAPSED_WIDTH = 76;

/** Deterministic avatar gradients, picked by bot id. */
export const AVATAR_GRADIENTS: Array<[string, string]> = [
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
export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent);

/**
 * Normalizes text for accent/case-insensitive search (handles Turkish
 * dotted/dotless i so "modul" matches "Modül").
 * @param {string} value - Raw text.
 * @returns {string} Normalized text.
 */
export function normalize(value: string): string {
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
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase() || '?';
}

/** Builds a DOM-id-safe slug from a category name. */
export const categorySlug = (category: string): string =>
  `nav-group-${category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

/** Shared typography for small uppercase section labels. */
export const sectionLabelSx = {
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
export function itemSx(theme: Theme, collapsed: boolean) {
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
export function RailTooltip({
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
export function BotAvatar({ bot, size }: { bot: BotSummary; size: number }): React.ReactElement {
  const { t } = useTranslation();
  const avatarHash = [...bot.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const [from, to] = AVATAR_GRADIENTS[avatarHash % AVATAR_GRADIENTS.length];
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
