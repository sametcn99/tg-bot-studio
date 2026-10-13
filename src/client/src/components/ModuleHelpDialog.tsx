import React, { useState } from 'react';
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import { useTranslation } from 'react-i18next';
import type { ModuleEntry } from '../registry/modules';
import { PLACEHOLDERS } from '../registry/modules';

/** Unique ids for dialog accessibility wiring. */
const DIALOG_TITLE_ID = 'module-help-dialog-title';

/**
 * Standard integrated documentation modal shown for every module. Tabs:
 * Overview & Use Cases, Step-by-Step Setup, Variables & Placeholders
 * (with one-click copy), and Troubleshooting & Rate Limits.
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
  const [tab, setTab] = useState(0);

  return (
    <Dialog
      open={Boolean(module)}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      aria-labelledby={DIALOG_TITLE_ID}
    >
      <DialogTitle
        id={DIALOG_TITLE_ID}
        sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" fontWeight={700} noWrap>
            {module?.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('help.open')}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose} aria-label={t('actions.close')}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Tabs
          value={tab}
          onChange={(_event, value: number) => setTab(value)}
          aria-label={t('help.open')}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
        >
          <Tab label={t('help.overview')} />
          <Tab label={t('help.setup')} />
          <Tab label={t('help.placeholders')} />
          <Tab label={t('help.troubleshooting')} />
        </Tabs>

        {tab === 0 && (
          <List dense aria-label={t('help.overview')}>
            {module?.docs.overview.map((line) => (
              <ListItem key={line} disableGutters>
                <ListItemText primary={line} />
              </ListItem>
            ))}
          </List>
        )}
        {tab === 1 && (
          <List dense aria-label={t('help.setup')} component="ol">
            {module?.docs.setup.map((line, index) => (
              <ListItem key={line} disableGutters>
                <ListItemText primary={`${index + 1}. ${line}`} />
              </ListItem>
            ))}
          </List>
        )}
        {tab === 2 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, pt: 2 }}>
            {PLACEHOLDERS.map((placeholder) => (
              <PlaceholderChip
                key={placeholder.tag}
                tag={placeholder.tag}
                description={t(`placeholders.${placeholder.tag.replace(/[{}]/g, '')}`, {
                  defaultValue: placeholder.description,
                })}
              />
            ))}
          </Box>
        )}
        {tab === 3 && (
          <List dense aria-label={t('help.troubleshooting')}>
            {module?.docs.troubleshooting.map((line) => (
              <ListItem key={line} disableGutters>
                <ListItemText primary={line} />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Placeholder chip implemented as a real button with one-click copy.
 * @param {object} props - Component props.
 * @param {string} props.tag - Placeholder tag (e.g. `{first_name}`).
 * @param {string} props.description - Explanation shown in the tooltip.
 * @returns {React.ReactElement} The chip button.
 */
function PlaceholderChip({
  tag,
  description,
}: {
  tag: string;
  description: string;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);

  /**
   * Copies the tag and flashes the confirmation icon.
   * @returns {void}
   */
  function copy(): void {
    void navigator.clipboard.writeText(tag).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Tooltip title={description}>
      <Chip
        component="button"
        type="button"
        size="small"
        label={tag}
        onClick={copy}
        onDelete={copy}
        deleteIcon={copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
        sx={{ fontFamily: 'monospace' }}
      />
    </Tooltip>
  );
}
