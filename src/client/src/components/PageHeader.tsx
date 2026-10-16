import React from 'react';
import { Box, Button, IconButton, Stack, Typography } from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

/**
 * Standard page header with title, subtitle, action slot, and the mandatory
 * per-module Documentation & Setup Guide button. Wraps responsively on
 * narrow viewports.
 * @param {object} props - Component props.
 * @param {string} props.title - Page title.
 * @param {string} [props.subtitle] - Muted subtitle line.
 * @param {() => void} [props.onDocs] - Opens the module documentation dialog.
 * @param {React.ReactNode} [props.actions] - Additional action elements.
 * @param {() => void} [props.onBack] - Optional back navigation action.
 * @param {React.ReactNode} [props.backIcon] - Back icon override.
 * @returns {React.ReactElement} The header row.
 */
export default function PageHeader({
  title,
  subtitle,
  onDocs,
  actions,
  onBack,
  backIcon,
}: {
  title: string;
  subtitle?: string;
  onDocs?: () => void;
  actions?: React.ReactNode;
  onBack?: () => void;
  backIcon?: React.ReactNode;
}): React.ReactElement {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1.5}
      sx={{
        alignItems: { xs: 'stretch', sm: 'flex-start' },
        justifyContent: 'space-between',
        mb: 3,
        gap: 2,
      }}
    >
      <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
        {onBack ? (
          <IconButton size="small" onClick={onBack} aria-label="back" sx={{ mt: 0.25 }}>
            {backIcon ?? <ArrowBackIcon fontSize="small" />}
          </IconButton>
        ) : null}
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="h5"
            component="h1"
            sx={{
              fontWeight: 700,
              letterSpacing: '-0.01em',
            }}
          >
            {title}
          </Typography>
          {subtitle ? (
            <Typography
              variant="body2"
              sx={{
                color: 'text.secondary',
                mt: 0.5,
              }}
            >
              {subtitle}
            </Typography>
          ) : null}
        </Box>
      </Box>
      <Stack
        direction={{ xs: 'row', sm: 'row' }}
        spacing={1}
        sx={{
          alignItems: 'center',
          flexShrink: 0,
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        {actions}
        {onDocs ? (
          <Button size="small" variant="outlined" startIcon={<HelpOutlineIcon />} onClick={onDocs}>
            Docs
          </Button>
        ) : null}
      </Stack>
    </Stack>
  );
}
