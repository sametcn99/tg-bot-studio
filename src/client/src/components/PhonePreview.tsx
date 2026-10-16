import React from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

/**
 * Enterprise phone simulator embedding the given URL inside a device frame.
 * Used for live Mini App previews inside the dashboard.
 * @param {object} props - Component props.
 * @param {string} props.url - URL rendered inside the simulated device.
 * @param {string} [props.label] - Caption under the frame.
 * @returns {React.ReactElement} The phone preview.
 */
export default function PhonePreview({
  url,
  label,
}: {
  url: string;
  label?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
      <Box
        sx={{
          width: 280,
          height: 560,
          borderRadius: 4,
          border: '8px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          overflow: 'hidden',
          boxShadow: 1,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box
          sx={{
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderBottom: '1px solid',
            borderColor: 'divider',
            flexShrink: 0,
          }}
        >
          <Box sx={{ width: 60, height: 4, borderRadius: 2, bgcolor: 'divider' }} />
        </Box>
        {url ? (
          <Box
            component="iframe"
            src={url}
            title={t('miniApps.previewTitle')}
            sx={{ border: 0, flex: 1, width: '100%' }}
          />
        ) : (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              {t('miniApps.noPreviewUrl')}
            </Typography>
          </Box>
        )}
      </Box>
      {label ? (
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
      ) : null}
    </Box>
  );
}
