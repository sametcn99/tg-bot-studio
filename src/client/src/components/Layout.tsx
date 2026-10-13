import React, { useCallback, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AppBar,
  Box,
  Breadcrumbs,
  Drawer,
  IconButton,
  Link,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import LogoutIcon from '@mui/icons-material/Logout';
import LanguageIcon from '@mui/icons-material/Language';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useBots } from '../context/BotContext';
import { useThemeMode } from '../theme';
import BotSwitcher from './BotSwitcher';
import BotSimulatorDrawer from './BotSimulatorDrawer';
import Sidebar, { BrandMark, SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_WIDTH } from './Sidebar';
import { useLocalizedModule } from '../registry/localize';

/** localStorage key for the persisted desktop rail state. */
const SIDEBAR_COLLAPSED_KEY = 'studio-sidebar-collapsed';

/**
 * Application shell: responsive sidebar (temporary drawer below `md`,
 * permanent collapsible rail above), sticky top bar with breadcrumbs, bot
 * switcher, theme toggle, and sign-out. Renders the active route through an
 * outlet inside a `<main>` landmark with a skip-navigation link.
 * @returns {React.ReactElement} The layout.
 */
export default function Layout(): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { logout } = useAuth();
  const { activeBot } = useBots();
  const { mode, toggle } = useThemeMode();
  const navigate = useNavigate();
  const location = useLocation();
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

  const currentLang = i18n.language || 'en';
  const toggleLanguage = (): void => {
    const next = currentLang.startsWith('tr') ? 'en' : 'tr';
    void i18n.changeLanguage(next);
    localStorage.setItem('studio_language', next);
  };

  const pathParts = location.pathname.split('/').filter(Boolean);
  const moduleKey = pathParts[2] === 'm' ? pathParts[3] : null;
  const localizedModule = useLocalizedModule(moduleKey ?? '');
  const sectionTitle = moduleKey ? localizedModule?.name : pathParts.join('/');

  const railWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <a href="#main-content" className="skip-link">
        {t('nav.skipToContent')}
      </a>

      {/* Permanent, collapsible rail on md+ */}
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

      <Box
        component="main"
        id="main-content"
        sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
      >
        <AppBar
          position="sticky"
          elevation={0}
          color="inherit"
          sx={{
            bgcolor: 'background.paper',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Toolbar sx={{ gap: 1 }}>
            {isCompact && (
              <IconButton
                edge="start"
                onClick={() => setDrawerOpen(true)}
                aria-label={t('nav.openMenu')}
                aria-controls="app-sidebar"
                aria-expanded={drawerOpen}
              >
                <MenuIcon />
              </IconButton>
            )}
            {isCompact && (
              <Box sx={{ mr: 0.5, display: 'flex' }}>
                <BrandMark size={28} />
              </Box>
            )}
            <Box sx={{ flexGrow: 1, minWidth: 0, display: { xs: 'none', sm: 'block' } }}>
              <Breadcrumbs aria-label={t('nav.breadcrumbs')}>
                <Link
                  underline="hover"
                  color="text.primary"
                  component="button"
                  type="button"
                  sx={{ cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => navigate('/')}
                >
                  {t('nav.studio')}
                </Link>
                {activeBot && (
                  <Link
                    underline="hover"
                    color="text.primary"
                    component="button"
                    type="button"
                    sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/bots/${activeBot.id}`)}
                  >
                    @{activeBot.username ?? activeBot.name}
                  </Link>
                )}
                {sectionTitle && (
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {sectionTitle}
                  </Typography>
                )}
              </Breadcrumbs>
            </Box>
            <Box sx={{ flexGrow: { xs: 1, sm: 0 } }} />
            <BotSwitcher />
            <Tooltip
              title={
                currentLang.startsWith('tr') ? t('nav.switchToEnglish') : t('nav.switchToTurkish')
              }
            >
              <IconButton size="small" onClick={toggleLanguage} aria-label={t('nav.language')}>
                <LanguageIcon fontSize="small" />
                <Typography variant="caption" sx={{ ml: 0.5, fontWeight: 700 }}>
                  {currentLang.startsWith('tr') ? 'TR' : 'EN'}
                </Typography>
              </IconButton>
            </Tooltip>
            <Tooltip title={mode === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}>
              <IconButton size="small" onClick={toggle} aria-label={t('nav.toggleTheme')}>
                {mode === 'dark' ? (
                  <LightModeIcon fontSize="small" />
                ) : (
                  <DarkModeIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
            <Tooltip title={t('nav.signOut')}>
              <IconButton size="small" onClick={logout} aria-label={t('nav.signOut')}>
                <LogoutIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Toolbar>
        </AppBar>
        <Box sx={{ p: { xs: 1.5, sm: 2.5, md: 3 }, maxWidth: 1280, mx: 'auto', width: '100%' }}>
          <Outlet />
        </Box>
        <BotSimulatorDrawer />
      </Box>
    </Box>
  );
}
