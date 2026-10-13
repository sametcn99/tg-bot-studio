import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

/**
 * Maps a runtime status to a semantic color (green active, amber
 * synchronizing, crimson failed, gray inactive/off).
 * @param {string} status - Runtime status string.
 * @returns {string} CSS color.
 */
function colorFor(status: string): string {
  switch (status) {
    case 'active':
      return '#16a34a';
    case 'starting':
      return '#d97706';
    case 'retrying':
      return '#eab308';
    case 'failed':
      return '#dc2626';
    default:
      return '#94a3b8';
  }
}

/**
 * Compact status indicator: colored dot plus capitalized label. The dot is
 * decorative; the label text carries the meaning for screen readers.
 * @param {object} props - Component props.
 * @param {string} props.status - Runtime status string.
 * @returns {React.ReactElement} The indicator.
 */
export default function StatusDot({ status }: { status: string }): React.ReactElement {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      <Box
        aria-hidden="true"
        sx={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          bgcolor: colorFor(status),
          flexShrink: 0,
        }}
      />
      <Typography component="span" variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}
