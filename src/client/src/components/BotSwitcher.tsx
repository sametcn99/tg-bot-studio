import React from 'react';
import { Button, ListItemIcon, ListItemText, Menu, Typography } from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CheckIcon from '@mui/icons-material/Check';
import { useNavigate } from 'react-router-dom';
import { useBots } from '../context/BotContext';
import StatusDot from './StatusDot';

/**
 * Cloudflare-zone style bot switcher implemented as an accessible button
 * opening a menu. Selecting a bot scopes every view to that bot and
 * navigates to its dashboard.
 * @returns {React.ReactElement} The switcher control.
 */
export default function BotSwitcher(): React.ReactElement {
  const { bots, activeBot, setActiveBotId } = useBots();
  const navigate = useNavigate();
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const open = Boolean(anchor);

  /**
   * Switches the active bot, closes the menu, and opens its dashboard.
   * @param {number} botId - Selected bot id.
   * @returns {void}
   */
  function select(botId: number): void {
    setActiveBotId(botId);
    handleClose();
    navigate(`/bots/${botId}`);
  }

  /**
   * Opens the switcher menu.
   * @param {React.MouseEvent<HTMLButtonElement>} event - Click event.
   * @returns {void}
   */
  function handleOpen(event: React.MouseEvent<HTMLButtonElement>): void {
    setAnchor(event.currentTarget);
  }

  /** Closes the switcher menu. */
  function handleClose(): void {
    setAnchor(null);
  }

  return (
    <>
      <Button
        id="bot-switcher-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? 'bot-switcher-menu' : undefined}
        onClick={handleOpen}
        startIcon={<SmartToyIcon />}
        endIcon={<ArrowDropDownIcon />}
        size="small"
        variant="outlined"
        sx={{
          maxWidth: { xs: 150, sm: 240 },
          justifyContent: 'flex-start',
          textTransform: 'none',
        }}
      >
        <Typography component="span" variant="body2" noWrap sx={{ display: 'block' }}>
          {activeBot ? activeBot.name : 'Select a bot'}
        </Typography>
      </Button>
      <Menu
        id="bot-switcher-menu"
        anchorEl={anchor}
        open={open}
        onClose={handleClose}
        aria-labelledby="bot-switcher-button"
        slotProps={{
          list: { role: 'listbox', 'aria-label': 'Bots' },
        }}
      >
        {bots.length === 0 && (
          <Typography
            variant="body2"
            sx={{
              color: 'text.secondary',
              px: 2,
              py: 1,
            }}
          >
            No bots registered
          </Typography>
        )}
        {bots.map((bot) => {
          const selectedBot = activeBot?.id === bot.id;
          return (
            <Button
              key={bot.id}
              onClick={() => select(bot.id)}
              role="option"
              aria-selected={selectedBot}
              fullWidth
              sx={{
                justifyContent: 'flex-start',
                textTransform: 'none',
                borderRadius: 0,
                px: 2,
                py: 1,
                minWidth: 260,
                color: 'text.primary',
              }}
            >
              <ListItemIcon sx={{ minWidth: 28 }} aria-hidden="true">
                {selectedBot ? <CheckIcon fontSize="small" /> : <SmartToyIcon fontSize="small" />}
              </ListItemIcon>
              <ListItemText
                primary={bot.name}
                secondary={bot.username ? `@${bot.username}` : `ID ${bot.id}`}
                slotProps={{
                  primary: { noWrap: true },
                }}
              />
              <StatusDot status={bot.status} />
            </Button>
          );
        })}
      </Menu>
    </>
  );
}
