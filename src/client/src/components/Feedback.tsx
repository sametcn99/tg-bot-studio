import React from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';

/**
 * Centered loading indicator used by every page while data is fetched.
 * Announced politely to screen readers via the ARIA live region role.
 * @param {object} [props] - Component props.
 * @param {string} [props.label='Loading'] - Accessible description.
 * @returns {React.ReactElement} The loading state.
 */
export function LoadingState({ label = 'Loading' }: { label?: string }): React.ReactElement {
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 8 }}
    >
      <CircularProgress size={32} aria-hidden="true" />
      <Typography variant="body2" color="text.secondary">
        {label}...
      </Typography>
    </Box>
  );
}

/**
 * Friendly empty-state block with icon and hint text.
 * @param {object} props - Component props.
 * @param {string} props.message - Explanation shown to the operator.
 * @param {React.ReactNode} [props.action] - Optional call-to-action element.
 * @returns {React.ReactElement} The empty state.
 */
export function EmptyState({
  message,
  action,
}: {
  message: string;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        py: 8,
        px: 2,
        textAlign: 'center',
      }}
    >
      <InboxOutlinedIcon
        aria-hidden="true"
        sx={{ fontSize: 44, color: 'text.secondary', opacity: 0.6 }}
      />
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
        {message}
      </Typography>
      {action}
    </Box>
  );
}
