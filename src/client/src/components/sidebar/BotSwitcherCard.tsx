import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Avatar,
  Box,
  ButtonBase,
  Divider,
  ListSubheader,
  Menu,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import AppsIcon from '@mui/icons-material/Apps';
import CheckIcon from '@mui/icons-material/Check';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import { useBots } from '../../context/BotContext';
import { BotAvatar, RailTooltip, sectionLabelSx } from './shared';

/**
 * Workspace-style bot switcher card (Linear/Vercel pattern): shows the
 * active bot and opens a menu to switch bots or jump to the bot list.
 * @param {object} props - Component props.
 * @param {boolean} props.collapsed - Icon-rail mode.
 * @param {() => void} [props.onNavigate] - Called after a navigation (closes mobile drawer).
 * @returns {React.ReactElement} The switcher.
 */
export function BotSwitcherCard({
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
  function select(botId: string): void {
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
                <Typography
                  variant="body2"
                  noWrap
                  sx={{
                    fontWeight: 600,
                    lineHeight: 1.3,
                  }}
                >
                  {activeBot?.name ?? t('nav.noBotSelected')}
                </Typography>
                <Typography
                  variant="caption"
                  noWrap
                  sx={{
                    color: 'text.secondary',
                    display: 'block',
                    lineHeight: 1.3,
                  }}
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
                  primary: { variant: 'body2', sx: { fontWeight: 600 }, noWrap: true },
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
