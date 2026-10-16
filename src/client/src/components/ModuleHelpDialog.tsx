import React, { createElement, useEffect, useRef, useState } from 'react';
import {
  Box,
  Chip,
  Dialog,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme, type Theme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ChecklistIcon from '@mui/icons-material/Checklist';
import DataObjectIcon from '@mui/icons-material/DataObject';
import LiveHelpOutlinedIcon from '@mui/icons-material/LiveHelpOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import { useTranslation } from 'react-i18next';
import type { ModuleEntry } from '../registry/modules';
import { PLACEHOLDERS } from '../registry/modules';
import { localizedCategory } from '../registry/localize';
import { moduleIcon } from './ModuleIcons';

/** Unique ids for dialog accessibility wiring. */
const DIALOG_TITLE_ID = 'module-help-dialog-title';

/** Monospace stack used for placeholder tags and the footer key hint. */
const MONO_FONT = "ui-monospace, SFMono-Regular, 'Cascadia Mono', Menlo, monospace";

/**
 * Standard integrated documentation modal shown for every module. Renders a
 * header with the module brand tile, a vertical section rail on desktop
 * (scrollable tabs on mobile), and four sections: Overview & Use Cases,
 * Step-by-Step Setup (numbered stepper), Variables & Placeholders (copyable
 * card grid), and Troubleshooting & Rate Limits.
 * @param {object} props - Component props.
 * @param {ModuleEntry | null} props.module - Module whose docs are shown; null closes.
 * @param {() => void} props.onClose - Closes the dialog.
 * @returns {React.ReactElement} The modal.
 */
export default function ModuleHelpDialog({
  module,
  onClose,
}: {
  module: ModuleEntry | null;
  onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down('md'));
  const [tab, setTab] = useState(0);
  const scrollRef = useRef<HTMLElement | null>(null);

  // Opening a different module always starts from the Overview section and
  // resets the content scroll position.
  useEffect(() => {
    setTab(0);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [module?.key]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  const sections = [
    {
      key: 'overview',
      label: t('help.overview'),
      icon: <InfoOutlinedIcon fontSize="small" />,
      count: module?.docs.overview.length ?? 0,
    },
    {
      key: 'setup',
      label: t('help.setup'),
      icon: <ChecklistIcon fontSize="small" />,
      count: module?.docs.setup.length ?? 0,
    },
    {
      key: 'placeholders',
      label: t('help.placeholders'),
      icon: <DataObjectIcon fontSize="small" />,
      count: PLACEHOLDERS.length,
    },
    {
      key: 'troubleshooting',
      label: t('help.troubleshooting'),
      icon: <LiveHelpOutlinedIcon fontSize="small" />,
      count: module?.docs.troubleshooting.length ?? 0,
    },
  ];

  const headerIcon = moduleIcon(module?.key);

  return (
    <Dialog
      open={Boolean(module)}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      aria-labelledby={DIALOG_TITLE_ID}
      slotProps={{
        paper: {
          elevation: 0,
          sx: {
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            height: { xs: '92vh', sm: 'min(84vh, 760px)' },
            borderRadius: { xs: 2.5, sm: 3.5 },
            border: '1px solid',
            borderColor: 'divider',
          },
        },
        backdrop: {
          sx: { backgroundColor: 'rgba(2,6,23,0.65)', backdropFilter: 'blur(4px)' },
        },
      }}
    >
      <Box
        component="header"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.75,
          px: { xs: 2, sm: 3 },
          pt: { xs: 2, sm: 2.25 },
          pb: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <Box
          aria-hidden="true"
          sx={{
            width: 46,
            height: 46,
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
            boxShadow: `0 6px 16px ${alpha(theme.palette.primary.main, 0.35)}`,
            flexShrink: 0,
          }}
        >
          {createElement(headerIcon, { sx: { fontSize: 24 } })}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <Typography
              id={DIALOG_TITLE_ID}
              component="h2"
              variant="subtitle1"
              noWrap
              sx={{
                fontWeight: 700,
              }}
            >
              {module?.name}
            </Typography>
            <Chip
              size="small"
              label={module ? localizedCategory(t, module.category) : ''}
              sx={() => ({
                height: 22,
                flexShrink: 0,
                borderRadius: 1,
                bgcolor: alpha(theme.palette.primary.main, 0.1),
                color: 'primary.main',
                fontWeight: 600,
                '& .MuiChip-label': { px: 1, fontSize: 11.5 },
              })}
            />
          </Box>
          <Typography
            variant="body2"
            noWrap
            sx={{
              color: 'text.secondary',
              mt: 0.25,
            }}
          >
            {module?.description}
          </Typography>
        </Box>
        <IconButton onClick={onClose} aria-label={t('actions.close')} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box
        sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, minHeight: 0, flex: 1 }}
      >
        {isCompact ? (
          <Tabs
            value={tab}
            onChange={(_event, value: number) => setTab(value)}
            aria-label={t('help.open')}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            sx={{
              borderBottom: '1px solid',
              borderColor: 'divider',
              minHeight: 44,
              '& .MuiTab-root': { minHeight: 44, fontSize: 13 },
            }}
          >
            {sections.map((section, index) => (
              <Tab
                key={section.key}
                label={section.label}
                id={`module-help-tab-${index}`}
                aria-controls={`module-help-panel-${index}`}
              />
            ))}
          </Tabs>
        ) : (
          <Box
            component="nav"
            aria-label={t('help.open')}
            sx={{
              width: 252,
              flexShrink: 0,
              borderRight: '1px solid',
              borderColor: 'divider',
              p: 1.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.5,
            }}
          >
            {sections.map((section, index) => {
              const active = tab === index;
              return (
                <Box
                  key={section.key}
                  component="button"
                  type="button"
                  role="tab"
                  id={`module-help-tab-${index}`}
                  aria-selected={active}
                  aria-controls={`module-help-panel-${index}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setTab(index)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.25,
                    width: '100%',
                    px: 1.5,
                    py: 1.1,
                    borderRadius: 1.5,
                    border: '1px solid',
                    borderColor: active
                      ? () => alpha(theme.palette.primary.main, 0.35)
                      : 'transparent',
                    bgcolor: active ? () => alpha(theme.palette.primary.main, 0.12) : 'transparent',
                    color: active ? 'primary.main' : 'text.secondary',
                    cursor: 'pointer',
                    font: 'inherit',
                    fontSize: 13.5,
                    fontWeight: 600,
                    textAlign: 'left',
                    transition: 'background-color 150ms ease, color 150ms ease',
                    '&:hover': {
                      bgcolor: () => alpha(theme.palette.primary.main, 0.08),
                      color: 'primary.main',
                    },
                    '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
                  }}
                >
                  {section.icon}
                  <span>{section.label}</span>
                  <Box sx={{ flexGrow: 1 }} />
                  <Typography
                    variant="caption"
                    sx={{ fontSize: 11, fontWeight: 700, opacity: 0.75 }}
                    component="span"
                  >
                    {section.count}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        )}

        <Box
          ref={scrollRef}
          component="section"
          role="tabpanel"
          id={`module-help-panel-${tab}`}
          aria-labelledby={`module-help-tab-${tab}`}
          sx={{
            flex: 1,
            minWidth: 0,
            overflowY: 'auto',
            px: { xs: 2.25, sm: 3.5 },
            py: { xs: 2.25, sm: 3 },
          }}
        >
          {tab === 0 && <OverviewSection lines={module?.docs.overview ?? []} />}
          {tab === 1 && <SetupSection lines={module?.docs.setup ?? []} />}
          {tab === 2 && <PlaceholdersSection />}
          {tab === 3 && <TroubleshootingSection lines={module?.docs.troubleshooting ?? []} />}
        </Box>
      </Box>

      <Box
        component="footer"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 3,
          py: 1.25,
          borderTop: '1px solid',
          borderColor: 'divider',
          flexShrink: 0,
          justifyContent: 'flex-end',
        }}
      >
        <Box
          component="kbd"
          aria-hidden="true"
          sx={{
            fontFamily: MONO_FONT,
            fontSize: 11,
            fontWeight: 600,
            px: 0.75,
            py: 0.25,
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'action.hover',
          }}
        >
          Esc
        </Box>
        <Typography
          variant="caption"
          sx={{
            color: 'text.secondary',
          }}
        >
          {t('help.escHint')}
        </Typography>
      </Box>
    </Dialog>
  );
}

/**
 * Overview section: the first docs line renders as a lead paragraph, the rest
 * as icon bullets.
 * @param {object} props - Component props.
 * @param {string[]} props.lines - Localized overview lines.
 * @returns {React.ReactElement} The section.
 */
function OverviewSection({ lines }: { lines: string[] }): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Stack spacing={2.25} aria-label={t('help.overview')}>
      {lines[0] !== undefined && (
        <Typography sx={{ fontSize: 15.5, lineHeight: 1.65, fontWeight: 500 }}>
          {lines[0]}
        </Typography>
      )}
      <Stack spacing={1.25}>
        {lines.slice(1).map((line) => (
          <Box key={line} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
            <CheckCircleRoundedIcon
              color="primary"
              sx={{ fontSize: 19, mt: '2px', flexShrink: 0 }}
            />
            <Typography variant="body2" sx={{ lineHeight: 1.65 }}>
              {line}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Stack>
  );
}

/**
 * Setup section rendered as a numbered vertical stepper with connector lines.
 * @param {object} props - Component props.
 * @param {string[]} props.lines - Localized setup steps in order.
 * @returns {React.ReactElement} The section.
 */
function SetupSection({ lines }: { lines: string[] }): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Stack spacing={0} aria-label={t('help.setup')}>
      {lines.map((line, index) => {
        const last = index === lines.length - 1;
        return (
          <Box key={line} sx={{ display: 'flex', gap: 2, alignItems: 'stretch' }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Box
                aria-hidden="true"
                sx={(theme: Theme) => ({
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: alpha(theme.palette.primary.main, 0.14),
                  color: 'primary.main',
                  fontWeight: 700,
                  fontSize: 13,
                })}
              >
                {index + 1}
              </Box>
              {!last && (
                <Box
                  aria-hidden="true"
                  sx={{ width: '2px', flex: 1, my: 0.5, borderRadius: 1, bgcolor: 'divider' }}
                />
              )}
            </Box>
            <Typography
              variant="body2"
              sx={{ pt: '4px', pb: last ? 0 : 3.25, lineHeight: 1.65, fontWeight: 500 }}
            >
              {line}
            </Typography>
          </Box>
        );
      })}
    </Stack>
  );
}

/**
 * Placeholders section: hint paragraph plus a responsive grid of copyable
 * variable cards with their descriptions always visible. Cards use the
 * native `title` hint instead of MUI Tooltips — nine Tooltip mounts made the
 * Placeholders tab the slowest section to open.
 * @returns {React.ReactElement} The section.
 */
function PlaceholdersSection(): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Box aria-label={t('help.placeholders')}>
      <Typography
        variant="body2"
        sx={{
          color: 'text.secondary',
          mb: 2.25,
          lineHeight: 1.65,
        }}
      >
        {t('help.placeholdersHint')}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(215px, 1fr))',
          gap: 1.25,
        }}
      >
        {PLACEHOLDERS.map((placeholder) => (
          <PlaceholderCard
            key={placeholder.tag}
            tag={placeholder.tag}
            description={t(`placeholders.${placeholder.tag.replace(/[{}]/g, '')}`, {
              defaultValue: placeholder.description,
            })}
          />
        ))}
      </Box>
    </Box>
  );
}

/**
 * Copyable placeholder card: monospace tag row with a copy affordance and the
 * description beneath it. Clicking anywhere on the card copies the tag; the
 * copy hint is a native `title` so the section stays cheap to mount.
 * @param {object} props - Component props.
 * @param {string} props.tag - Placeholder tag (e.g. `{first_name}`).
 * @param {string} props.description - Explanation shown under the tag.
 * @returns {React.ReactElement} The card.
 */
function PlaceholderCard({
  tag,
  description,
}: {
  tag: string;
  description: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  /**
   * Copies the tag and flashes the confirmation icon.
   * @returns {void}
   */
  function copy(): void {
    navigator.clipboard
      .writeText(tag)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  }

  return (
    <Box
      component="button"
      type="button"
      title={copied ? t('actions.copied') : t('actions.copy')}
      onClick={copy}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
        textAlign: 'left',
        p: 1.5,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        cursor: 'pointer',
        font: 'inherit',
        transition: 'border-color 150ms ease, background-color 150ms ease',
        '&:hover': {
          borderColor: 'primary.main',
          bgcolor: () => alpha(theme.palette.primary.main, 0.04),
        },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        <Typography
          component="code"
          sx={{
            fontFamily: MONO_FONT,
            fontSize: 13,
            fontWeight: 600,
            color: 'primary.main',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {tag}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        {copied ? (
          <CheckIcon sx={{ fontSize: 16, color: 'success.main' }} />
        ) : (
          <ContentCopyOutlinedIcon sx={{ fontSize: 15, color: 'text.disabled' }} />
        )}
      </Box>
      <Typography
        variant="caption"
        sx={{
          color: 'text.secondary',
          lineHeight: 1.5,
        }}
      >
        {description}
      </Typography>
    </Box>
  );
}

/**
 * Troubleshooting section rendered as amber icon bullets.
 * @param {object} props - Component props.
 * @param {string[]} props.lines - Localized troubleshooting notes.
 * @returns {React.ReactElement} The section.
 */
function TroubleshootingSection({ lines }: { lines: string[] }): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Stack spacing={1.5} aria-label={t('help.troubleshooting')}>
      {lines.map((line) => (
        <Box key={line} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
          <WarningAmberRoundedIcon
            color="warning"
            sx={{ fontSize: 19, mt: '2px', flexShrink: 0 }}
          />
          <Typography variant="body2" sx={{ lineHeight: 1.65 }}>
            {line}
          </Typography>
        </Box>
      ))}
    </Stack>
  );
}
