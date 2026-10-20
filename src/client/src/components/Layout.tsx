import React, { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Chip,
  Drawer,
  IconButton,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import { useTranslation } from 'react-i18next';
import { useBots } from '../context/BotContext';
import BotSimulatorDrawer from './BotSimulatorDrawer';
import Sidebar, { BrandMark, SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_WIDTH } from './Sidebar';
import { openSimulator } from '../utils/simulatorBus';

/** localStorage key for the persisted desktop rail state. */
const SIDEBAR_COLLAPSED_KEY = 'studio-sidebar-collapsed';

/**
 * Application shell: sidebar-centric workspace layout.
 * Desktop uses a collapsible rail sidebar.
 * Mobile uses a sticky header with a sidebar toggle button and a temporary drawer.
 * @returns {React.ReactElement} The layout.
 */
export default function Layout(): React.ReactElement {
  const { t } = useTranslation();
  const theme = useTheme();
  const location = useLocation();
  const { activeBot, setActiveBotId } = useBots();
  const isCompact = useMediaQuery(theme.breakpoints.down('md'));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(
    () => window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1',
  );

  useEffect(() => {
    const match = location.pathname.match(/^\/bots\/([^/]+)/);
    if (match && match[1]) {
      const routeBotId = match[1];
      if (activeBot?.id !== routeBotId) {
        setActiveBotId(routeBotId);
      }
    }
  }, [location.pathname, activeBot?.id, setActiveBotId]);

  const toggleCollapsed = useCallback((): void => {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  const closeDrawer = useCallback((): void => setDrawerOpen(false), []);

  const railWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <a href="#main-content" className="skip-link">
        {t('nav.skipToContent')}
      </a>

      {/* Permanent, collapsible sidebar rail on md+ */}
      {!isCompact && (
        <Box
          sx={{
            width: railWidth,
            flexShrink: 0,
            height: '100vh',
            position: 'sticky',
            top: 0,
            borderRight: '1px solid',
            borderColor: 'divider',
            transition: theme.transitions.create('width', {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.shorter,
            }),
          }}
        >
          <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} enableShortcut />
        </Box>
      )}

      {/* Temporary drawer below md */}
      <Drawer
        variant="temporary"
        open={isCompact && drawerOpen}
        onClose={closeDrawer}
        ModalProps={{ keepMounted: true }}
        slotProps={{ paper: { id: 'app-sidebar' } }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': {
            boxSizing: 'border-box',
            width: SIDEBAR_WIDTH,
            borderRight: '1px solid',
            borderColor: 'divider',
          },
        }}
      >
        <Sidebar onNavigate={closeDrawer} />
      </Drawer>

      {/* Main content view */}
      <Box
        component="main"
        id="main-content"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          overflowY: 'auto',
        }}
      >
        {/* Sticky mobile header with sidebar toggle button */}
        <Box
          component="header"
          sx={(th) => ({
            display: { xs: 'flex', md: 'none' },
            position: 'sticky',
            top: 0,
            zIndex: 1050,
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2,
            py: 1,
            minHeight: 56,
            bgcolor: alpha(th.palette.background.paper, 0.92),
            backdropFilter: 'blur(10px)',
            borderBottom: '1px solid',
            borderColor: 'divider',
            flexShrink: 0,
          })}
        >
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
            <IconButton
              edge="start"
              onClick={() => setDrawerOpen(true)}
              aria-label={t('nav.openMenu')}
              aria-controls="app-sidebar"
              aria-expanded={drawerOpen}
              size="small"
              sx={(th) => ({
                borderRadius: '8px',
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: alpha(th.palette.text.primary, 0.02),
                p: 0.75,
                '&:hover': {
                  bgcolor: alpha(th.palette.text.primary, 0.06),
                },
              })}
            >
              <MenuIcon fontSize="small" />
            </IconButton>

            <Box
              component={RouterLink}
              to="/"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                textDecoration: 'none',
                color: 'inherit',
                minWidth: 0,
              }}
            >
              <BrandMark size={28} />
              <Typography
                variant="subtitle2"
                noWrap
                sx={{
                  fontWeight: 700,
                  letterSpacing: '-0.01em',
                }}
              >
                {t('app.title')}
              </Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
            {activeBot && (
              <Chip
                size="small"
                label={activeBot.name}
                avatar={
                  <Box
                    component="span"
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      bgcolor: activeBot.is_active ? 'success.main' : 'text.disabled',
                      ml: '8px !important',
                    }}
                  />
                }
                sx={{
                  display: { xs: 'none', sm: 'inline-flex' },
                  maxWidth: 140,
                  fontWeight: 600,
                  fontSize: '0.75rem',
                  bgcolor: (th) => alpha(th.palette.text.primary, 0.04),
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              />
            )}
            {activeBot && (
              <IconButton
                size="small"
                color="primary"
                onClick={() => openSimulator()}
                aria-label={t('simulator.title')}
                sx={(th) => ({
                  borderRadius: '8px',
                  border: '1px solid',
                  borderColor: alpha(th.palette.primary.main, 0.25),
                  bgcolor: alpha(th.palette.primary.main, 0.08),
                  p: 0.75,
                  '&:hover': {
                    bgcolor: alpha(th.palette.primary.main, 0.16),
                  },
                })}
              >
                <SmartToyIcon fontSize="small" />
              </IconButton>
            )}
          </Stack>
        </Box>

        <Box
          sx={{
            p: { xs: 2, sm: 3, md: 3.5 },
            maxWidth: 1400,
            mx: 'auto',
            width: '100%',
            flexGrow: 1,
          }}
        >
          <Outlet />
        </Box>
        <BotSimulatorDrawer />
      </Box>
    </Box>
  );
}
