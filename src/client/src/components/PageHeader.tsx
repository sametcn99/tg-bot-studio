import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

/**
 * Standard page header with title, subtitle, action slot, and the mandatory
 * per-module Documentation & Setup Guide button. Wraps responsively on
 * narrow viewports.
 * @param {object} props - Component props.
 * @param {string} props.title - Page title.
 * @param {string} [props.subtitle] - Muted subtitle line.
 * @param {() => void} [props.onDocs] - Opens the module documentation dialog.
 * @param {React.ReactNode} [props.actions] - Additional action elements.
 * @returns {React.ReactElement} The header row.
 */
export default function PageHeader({
  title,
  subtitle,
  onDocs,
  actions,
}: {
  title: string;
  subtitle?: string;
  onDocs?: () => void;
  actions?: React.ReactNode;
}): React.ReactElement {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      alignItems={{ xs: 'stretch', sm: 'flex-start' }}
      justifyContent="space-between"
      spacing={1.5}
      sx={{ mb: 3, gap: 2 }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h5" component="h1" fontWeight={700} letterSpacing="-0.01em">
          {title}
        </Typography>
        {subtitle ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        ) : null}
      </Box>
      <Stack
        direction={{ xs: 'row', sm: 'row' }}
        spacing={1}
        alignItems="center"
        sx={{ flexShrink: 0, flexWrap: 'wrap', gap: 1 }}
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
