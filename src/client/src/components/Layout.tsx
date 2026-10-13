import React, { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AppBar,
  Box,
  Breadcrumbs,
  Collapse,
  Divider,
  Drawer,
  IconButton,
  Link,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MenuIcon from '@mui/icons-material/Menu';
import HubIcon from '@mui/icons-material/Hub';
import DashboardIcon from '@mui/icons-material/Dashboard';
import TuneIcon from '@mui/icons-material/Tune';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import SecurityIcon from '@mui/icons-material/Security';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import CableIcon from '@mui/icons-material/Cable';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import BusinessCenterIcon from '@mui/icons-material/BusinessCenter';
import ForumIcon from '@mui/icons-material/Forum';
import CampaignIcon from '@mui/icons-material/Campaign';
import GroupsIcon from '@mui/icons-material/Groups';
import WavingHandIcon from '@mui/icons-material/WavingHand';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import GavelIcon from '@mui/icons-material/Gavel';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import ShareIcon from '@mui/icons-material/Share';
import QuizIcon from '@mui/icons-material/Quiz';
import SmartButtonIcon from '@mui/icons-material/SmartButton';
import PsychologyIcon from '@mui/icons-material/Psychology';
import ReplyIcon from '@mui/icons-material/Reply';
import PaidIcon from '@mui/icons-material/Paid';
import StarIcon from '@mui/icons-material/Star';
import WebhookIcon from '@mui/icons-material/Webhook';
import LanguageIcon from '@mui/icons-material/Language';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useBots } from '../context/BotContext';
import { useThemeMode } from '../theme';
import BotSwitcher from './BotSwitcher';
import BotSimulatorDrawer from './BotSimulatorDrawer';
import { MODULES, modulesByCategory } from '../registry/modules';

/** Sidebar width in pixels on medium screens and up. */
const SIDEBAR_WIDTH = 264;

/** Icon registry keyed by module key. */
const MODULE_ICONS: Record<string, React.ReactElement> = {
  connections: <CableIcon />,
  'start-menu': <MenuBookIcon />,
  scheduler: <ScheduleIcon />,
  support: <SupportAgentIcon />,
  business: <BusinessCenterIcon />,
  drip: <ForumIcon />,
  broadcast: <CampaignIcon />,
  crm: <GroupsIcon />,
  welcome: <WavingHandIcon />,
  captcha: <VerifiedUserIcon />,
  moderation: <GavelIcon />,
  giveaways: <EmojiEventsIcon />,
  referrals: <ShareIcon />,
  quizzes: <QuizIcon />,
  reactions: <SmartButtonIcon />,
  'ai-assistant': <PsychologyIcon />,
  autoresponder: <ReplyIcon />,
  'paid-media': <PaidIcon />,
  'vip-subs': <StarIcon />,
  webhooks: <WebhookIcon />,
};

/**
 * Application shell: responsive sidebar (temporary drawer below `md`,
 * permanent rail above), sticky top bar with breadcrumbs, bot switcher,
 * theme toggle, and sign-out. Renders the active route through an outlet
 * inside a `<main>` landmark with a skip-navigation link.
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

  const currentLang = i18n.language || 'en';
  const toggleLanguage = (): void => {
    const next = currentLang.startsWith('tr') ? 'en' : 'tr';
    void i18n.changeLanguage(next);
    localStorage.setItem('studio_language', next);
  };

  const pathParts = location.pathname.split('/').filter(Boolean);
  const botId = pathParts[0] === 'bots' ? Number(pathParts[1]) : null;
  const moduleKey = pathParts[2] === 'm' ? pathParts[3] : null;
  const sectionTitle = moduleKey
    ? MODULES.find((module) => module.key === moduleKey)?.name
    : pathParts.join('/');

  /**
   * Closes the mobile drawer after a navigation.
   * @param {() => void} target - Navigation callback.
   * @returns {void}
   */
  const navigateAndClose = (target: () => void): void => {
    target();
    setDrawerOpen(false);
  };

  const sidebar = (
    <Box
      component="nav"
      aria-label={t('nav.primary')}
      sx={{ overflowY: 'auto', height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <Toolbar sx={{ px: 2 }} disableGutters={false}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <HubIcon color="primary" aria-hidden="true" />
          <Box>
            <Typography variant="subtitle1" fontWeight={700} lineHeight={1.1} noWrap>
              {t('app.title')}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {t('app.subtitle')}
            </Typography>
          </Box>
        </Stack>
      </Toolbar>
      <Divider />
      <List dense sx={{ px: 1.5, py: 1 }} aria-label={t('nav.studio')}>
        <NavItem
          icon={<DashboardIcon />}
          label={t('nav.overview')}
          selected={location.pathname === '/'}
          onClick={() => navigateAndClose(() => navigate('/'))}
        />
      </List>
      {activeBot && (
        <>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ px: 3, pt: 1 }}
            noWrap
            component="h2"
          >
            @{activeBot.username ?? activeBot.name}
          </Typography>
          <List dense sx={{ px: 1.5, py: 1 }} aria-label={t('nav.bot')}>
            <NavItem
              icon={<DashboardIcon />}
              label={t('nav.botDashboard')}
              selected={location.pathname === `/bots/${activeBot.id}`}
              onClick={() => navigateAndClose(() => navigate(`/bots/${activeBot.id}`))}
            />
            <NavItem
              icon={<TuneIcon />}
              label={t('nav.modules')}
              selected={location.pathname === `/bots/${activeBot.id}/modules`}
              onClick={() => navigateAndClose(() => navigate(`/bots/${activeBot.id}/modules`))}
            />
            <NavItem
              icon={<SmartphoneIcon />}
              label={t('nav.miniApps')}
              selected={location.pathname === `/bots/${activeBot.id}/mini-apps`}
              onClick={() => navigateAndClose(() => navigate(`/bots/${activeBot.id}/mini-apps`))}
            />
          </List>
          <ModuleNavSections
            activeModuleKey={moduleKey}
            onNavigate={(key) =>
              navigateAndClose(() => navigate(`/bots/${activeBot.id}/m/${key}`))
            }
          />
        </>
      )}
      <Box sx={{ flexGrow: 1 }} />
      <Divider />
      <List dense sx={{ px: 1.5, py: 1 }} aria-label={t('nav.account')}>
        <NavItem
          icon={<SecurityIcon />}
          label={t('nav.security')}
          selected={location.pathname === '/security'}
          onClick={() => navigateAndClose(() => navigate('/security'))}
        />
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <a href="#main-content" className="skip-link">
        {t('nav.skipToContent')}
      </a>

      {/* Permanent rail on md+ */}
      {!isCompact && (
        <Box
          component="nav"
          aria-label={t('nav.primary')}
          sx={{
            width: SIDEBAR_WIDTH,
            flexShrink: 0,
            height: '100vh',
            position: 'sticky',
            top: 0,
          }}
        >
          <Box
            sx={{
              width: SIDEBAR_WIDTH,
              height: '100%',
              bgcolor: 'background.paper',
              borderRight: '1px solid',
              borderColor: 'divider',
            }}
          >
            {sidebar}
          </Box>
        </Box>
      )}

      {/* Temporary drawer below md */}
      <Drawer
        variant="temporary"
        open={isCompact && drawerOpen}
        onClose={() => setDrawerOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': { boxSizing: 'border-box', width: SIDEBAR_WIDTH },
        }}
      >
        {sidebar}
      </Drawer>

      <Box component="main" id="main-content" sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
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
              >
                <MenuIcon />
              </IconButton>
            )}
            {isCompact && <HubIcon color="primary" aria-hidden="true" sx={{ mr: 0.5 }} />}
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
                  Studio
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
            <Tooltip title={currentLang.startsWith('tr') ? 'Switch to English' : 'Türkçe Dilini Seç'}>
              <IconButton size="small" onClick={toggleLanguage} aria-label="Toggle language">
                <LanguageIcon fontSize="small" />
                <Typography variant="caption" sx={{ ml: 0.5, fontWeight: 700 }}>
                  {currentLang.startsWith('tr') ? 'TR' : 'EN'}
                </Typography>
              </IconButton>
            </Tooltip>
            <Tooltip title={mode === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}>
              <IconButton size="small" onClick={toggle} aria-label={t('nav.toggleTheme')}>
                {mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
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

/**
 * Sidebar navigation item with an accessible active state.
 * @param {object} props - Component props.
 * @param {React.ReactElement} props.icon - Leading icon (decorative).
 * @param {string} props.label - Item label (also the accessible name).
 * @param {boolean} props.selected - Active state.
 * @param {() => void} props.onClick - Navigation callback.
 * @returns {React.ReactElement} The item.
 */
function NavItem({
  icon,
  label,
  selected,
  onClick,
}: {
  icon: React.ReactElement;
  label: string;
  selected: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <ListItemButton
      selected={selected}
      onClick={onClick}
      aria-current={selected ? 'page' : undefined}
      title={label}
      sx={{ borderRadius: 1, mb: 0.25, minHeight: 40 }}
    >
      <ListItemIcon sx={{ minWidth: 36 }} aria-hidden="true">
        {icon}
      </ListItemIcon>
      <ListItemText
        primary={label}
        primaryTypographyProps={{ variant: 'body2', noWrap: true }}
      />
    </ListItemButton>
  );
}

/** Builds a DOM-id-safe slug from a category name. */
const categorySlug = (category: string): string =>
  `nav-group-${category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

/**
 * Sidebar module navigation grouped by registry category with collapsible
 * sections — keeps 19 modules scannable instead of one long flat list.
 * The section containing the active module auto-expands on navigation.
 * @param {object} props - Component props.
 * @param {string | null} props.activeModuleKey - Key of the active module route, if any.
 * @param {(key: string) => void} props.onNavigate - Callback with the module key to open.
 * @returns {React.ReactElement} The grouped module navigation.
 */
function ModuleNavSections({
  activeModuleKey,
  onNavigate,
}: {
  activeModuleKey: string | null;
  onNavigate: (key: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const groups = useMemo(() => modulesByCategory(), []);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(groups.map(([category]) => category)),
  );

  // Auto-expand the section owning the active module (including on later navigations).
  useEffect(() => {
    if (!activeModuleKey) return;
    const owner = groups.find(([, modules]) =>
      modules.some((module) => module.key === activeModuleKey),
    )?.[0];
    if (owner) {
      setCollapsed((current) => {
        if (!current.has(owner)) return current;
        const next = new Set(current);
        next.delete(owner);
        return next;
      });
    }
  }, [activeModuleKey, groups]);

  /**
   * Toggles one category section.
   * @param {string} category - Category to toggle.
   * @returns {void}
   */
  function toggle(category: string): void {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }

  return (
    <Box component="nav" aria-label={t('nav.modules')} sx={{ pb: 1 }}>
      {groups.map(([category, modules]) => {
        const open = !collapsed.has(category);
        return (
          <Box key={category} sx={{ px: 1.5 }}>
            <ListItemButton
              onClick={() => toggle(category)}
              aria-expanded={open}
              aria-controls={categorySlug(category)}
              sx={{ borderRadius: 1, minHeight: 36 }}
            >
              <ListItemText
                primary={category}
                primaryTypographyProps={{
                  variant: 'overline',
                  sx: { lineHeight: 1.4 },
                }}
              />
              <ExpandMoreIcon
                fontSize="small"
                aria-hidden="true"
                sx={{
                  transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
                  transition: (theme) =>
                    theme.transitions.create('transform', { duration: 'short' }),
                }}
              />
            </ListItemButton>
            <Collapse in={open} id={categorySlug(category)}>
              <List
                dense
                disablePadding
                role="group"
                aria-label={category}
                sx={{ pl: 1 }}
              >
                {modules.map((module) => (
                  <NavItem
                    key={module.key}
                    icon={MODULE_ICONS[module.key] ?? <TuneIcon />}
                    label={module.name}
                    selected={activeModuleKey === module.key}
                    onClick={() => onNavigate(module.key)}
                  />
                ))}
              </List>
            </Collapse>
          </Box>
        );
      })}
    </Box>
  );
}
