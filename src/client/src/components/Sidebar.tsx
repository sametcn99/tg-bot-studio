import React, { useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Divider,
  IconButton,
  InputBase,
  List,
  MenuItem,
  Select,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { UI_LANGUAGES, ensureLanguage } from '../i18n';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined';
import LanguageIcon from '@mui/icons-material/Language';
import AppsIcon from '@mui/icons-material/Apps';
import SpaceDashboardOutlinedIcon from '@mui/icons-material/SpaceDashboardOutlined';
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined';
import PhoneIphoneIcon from '@mui/icons-material/PhoneIphone';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import SearchIcon from '@mui/icons-material/Search';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import CloseIcon from '@mui/icons-material/Close';
import KeyboardDoubleArrowLeftIcon from '@mui/icons-material/KeyboardDoubleArrowLeft';
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight';
import { useBots } from '../context/BotContext';
import { useAuth } from '../context/AuthContext';
import { useThemeMode } from '../theme';
import { useLocalizedModules } from '../registry/localize';
import { openSimulator } from '../utils/simulatorBus';
import {
  BrandMark,
  IS_MAC,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_WIDTH,
  RailTooltip,
  normalize,
} from './sidebar/shared';
import { BotSwitcherCard } from './sidebar/BotSwitcherCard';
import { NavItem, SectionLabel, ModuleNavSections } from './sidebar/ModuleNav';

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
  // Tooltip must hide while the language dropdown is open (MUI tooltips
  // render above menus and would otherwise overlap the option list).
  const [languageTipHover, setLanguageTipHover] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);

  /**
   * Applies a dashboard language choice.
   * @param {string} code - Language code from UI_LANGUAGES.
   * @returns {void}
   */
  function selectLanguage(code: string): void {
    // Load the catalogs first so the UI never renders raw keys mid-switch.
    void ensureLanguage(code).then(() => i18n.changeLanguage(code));
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
              noWrap
              sx={{
                color: 'text.secondary',
                display: 'block',
                lineHeight: 1.3,
              }}
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

      {/* Live Bot Simulator Trigger */}
      <Box sx={{ px: collapsed ? 1.5 : 2, pb: 1.5, flexShrink: 0 }}>
        {collapsed ? (
          <RailTooltip
            collapsed={collapsed}
            title={activeBot ? t('simulator.title') : t('nav.selectBotHint')}
          >
            <span>
              <IconButton
                size="small"
                disabled={!activeBot}
                onClick={() => {
                  openSimulator();
                  onNavigate?.();
                }}
                aria-label={t('simulator.title')}
                sx={(th) => ({
                  width: 42,
                  height: 42,
                  mx: 'auto',
                  display: 'flex',
                  borderRadius: '10px',
                  color: '#fff',
                  background:
                    th.palette.mode === 'dark'
                      ? 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)'
                      : 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)',
                  boxShadow: `0 2px 8px ${alpha(th.palette.primary.main, 0.3)}`,
                  '&:hover': {
                    background:
                      th.palette.mode === 'dark'
                        ? 'linear-gradient(135deg, #1d4ed8 0%, #4338ca 100%)'
                        : 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)',
                    boxShadow: `0 4px 12px ${alpha(th.palette.primary.main, 0.45)}`,
                  },
                  '&.Mui-disabled': {
                    background: 'none',
                    color: 'text.disabled',
                    border: '1px solid',
                    borderColor: 'divider',
                    boxShadow: 'none',
                  },
                })}
              >
                <SmartToyIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </span>
          </RailTooltip>
        ) : (
          <Tooltip
            title={!activeBot ? t('nav.selectBotHint') : ''}
            disableHoverListener={Boolean(activeBot)}
          >
            <span>
              <Button
                variant="contained"
                fullWidth
                disabled={!activeBot}
                startIcon={<SmartToyIcon sx={{ fontSize: 20 }} />}
                onClick={() => {
                  openSimulator();
                  onNavigate?.();
                }}
                sx={(th) => ({
                  minHeight: 40,
                  py: 1,
                  px: 1.75,
                  borderRadius: '10px',
                  textTransform: 'none',
                  fontWeight: 600,
                  fontSize: '0.8125rem',
                  justifyContent: 'flex-start',
                  gap: 1,
                  background:
                    th.palette.mode === 'dark'
                      ? 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)'
                      : 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)',
                  boxShadow: `0 2px 10px ${alpha(th.palette.primary.main, 0.28)}`,
                  transition: th.transitions.create(['background', 'box-shadow', 'transform'], {
                    duration: th.transitions.duration.shortest,
                  }),
                  '&:hover': {
                    background:
                      th.palette.mode === 'dark'
                        ? 'linear-gradient(135deg, #1d4ed8 0%, #4338ca 100%)'
                        : 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)',
                    boxShadow: `0 4px 14px ${alpha(th.palette.primary.main, 0.42)}`,
                  },
                  '&:active': {
                    transform: 'scale(0.98)',
                  },
                  '&.Mui-disabled': {
                    background: alpha(th.palette.text.primary, 0.05),
                    color: 'text.disabled',
                    boxShadow: 'none',
                  },
                })}
              >
                <Box
                  component="span"
                  sx={{
                    flex: 1,
                    textAlign: 'left',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t('simulator.title')}
                </Box>
              </Button>
            </span>
          </Tooltip>
        )}
      </Box>

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
          <Stack
            spacing={0.75}
            sx={{
              alignItems: 'center',
            }}
          >
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
            <Stack
              direction="row"
              spacing={0.75}
              sx={{
                alignItems: 'center',
              }}
            >
              {/* Language select */}
              <Tooltip title={t('nav.language')} arrow open={languageTipHover && !languageMenuOpen}>
                <span
                  onMouseEnter={() => setLanguageTipHover(true)}
                  onMouseLeave={() => setLanguageTipHover(false)}
                  style={{ display: 'inline-flex' }}
                >
                  <Select
                    size="small"
                    value={currentLanguageMeta.code}
                    onChange={(event) => selectLanguage(String(event.target.value))}
                    onOpen={() => setLanguageMenuOpen(true)}
                    onClose={() => setLanguageMenuOpen(false)}
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
                </span>
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

export { SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH, BrandMark };
