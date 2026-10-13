import React, { useCallback, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Box, Drawer, IconButton, useMediaQuery, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import { useTranslation } from 'react-i18next';
import BotSimulatorDrawer from './BotSimulatorDrawer';
import Sidebar, { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_WIDTH } from './Sidebar';

/** localStorage key for the persisted desktop rail state. */
const SIDEBAR_COLLAPSED_KEY = 'studio-sidebar-collapsed';

/**
 * Application shell: sidebar-centric workspace layout without top header.
 * All controls (workspace bot switcher, navigation, search, language,
 * theme mode, and sign-out) are integrated directly into the responsive
 * sidebar. On small screens, a floating mobile trigger opens the drawer.
 * @returns {React.ReactElement} The layout.
 */
export default function Layout(): React.ReactElement {
  const { t } = useTranslation();
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down('md'));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(
    () => window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1',
  );

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

      {/* Floating mobile drawer toggle on small viewports */}
      {isCompact && (
        <IconButton
          edge="start"
          onClick={() => setDrawerOpen(true)}
          aria-label={t('nav.openMenu')}
          aria-controls="app-sidebar"
          aria-expanded={drawerOpen}
          sx={(th) => ({
            position: 'fixed',
            top: 14,
            left: 14,
            zIndex: 1100,
            borderRadius: '10px',
            bgcolor: alpha(th.palette.background.paper, 0.9),
            backdropFilter: 'blur(8px)',
            border: '1px solid',
            borderColor: 'divider',
            boxShadow:
              th.palette.mode === 'dark'
                ? '0 4px 14px rgba(0,0,0,0.5)'
                : '0 4px 14px rgba(15,23,42,0.1)',
            '&:hover': {
              bgcolor: th.palette.background.paper,
            },
          })}
        >
          <MenuIcon fontSize="small" />
        </IconButton>
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
        <Box
          sx={{
            p: { xs: 2, sm: 3, md: 3.5 },
            pt: { xs: 7, md: 3.5 },
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
