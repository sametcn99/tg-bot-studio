import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import { localizedErrorMessage } from '../utils/errors';

interface DiagnosticCheck {
  key: string;
  title: string;
  status: 'pass' | 'warning' | 'error' | 'info';
  details: string;
}

interface DiagnosticReport {
  ok: boolean;
  botId: number;
  botInfo?: {
    username?: string;
    first_name?: string;
    can_join_groups?: boolean;
    can_read_all_group_messages?: boolean;
  };
  runtimeStatus: string;
  checks: DiagnosticCheck[];
  recommendations: string[];
}

interface BotDiagnosticsDialogProps {
  botId: number;
  open: boolean;
  onClose: () => void;
}

export default function BotDiagnosticsDialog({
  botId,
  open,
  onClose,
}: BotDiagnosticsDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCheck = useCallback(() => {
    if (!botId) return;
    setLoading(true);
    setError(null);
    apiFetch<DiagnosticReport>(`/api/bots/${botId}/diagnostics`)
      .then(setReport)
      .catch((err: Error) => setError(localizedErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [botId]);

  useEffect(() => {
    if (open) {
      runCheck();
    }
  }, [open, runCheck]);

  const renderStatusIcon = (status: DiagnosticCheck['status']) => {
    switch (status) {
      case 'pass':
        return <CheckCircleOutlineIcon color="success" fontSize="small" />;
      case 'warning':
        return <WarningAmberIcon color="warning" fontSize="small" />;
      case 'error':
        return <ErrorOutlineIcon color="error" fontSize="small" />;
      default:
        return <InfoOutlinedIcon color="info" fontSize="small" />;
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <HealthAndSafetyIcon color="primary" />
        {t('diagnostics.title')}
      </DialogTitle>
      <DialogContent dividers>
        {loading && (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <CircularProgress size={36} sx={{ mb: 2 }} />
            <Typography variant="body2" color="text.secondary">
              {t('diagnostics.checking')}
            </Typography>
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {report && !loading && (
          <Stack spacing={2.5}>
            {/* Summary card */}
            <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default', borderRadius: 2 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="subtitle1" fontWeight={700}>
                    {report.botInfo?.first_name ?? t('diagnostics.botFallback', { id: botId })}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    @{report.botInfo?.username ?? 'bot'} • {t('diagnostics.runtime')}:{' '}
                    {report.runtimeStatus}
                  </Typography>
                </Box>
                <Chip
                  label={
                    report.checks.some((c) => c.status === 'error')
                      ? t('diagnostics.issuesFound')
                      : t('diagnostics.healthy')
                  }
                  color={report.checks.some((c) => c.status === 'error') ? 'error' : 'success'}
                  size="small"
                />
              </Stack>
            </Paper>

            {/* Checklist */}
            <Stack spacing={1.5}>
              <Typography variant="subtitle2" fontWeight={600}>
                {t('diagnostics.inspections')}
              </Typography>
              {report.checks.map((chk) => (
                <Paper key={chk.key} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                  <Stack direction="row" spacing={1.5} alignItems="flex-start">
                    <Box sx={{ mt: 0.25 }}>{renderStatusIcon(chk.status)}</Box>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" fontWeight={600}>
                        {chk.title}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block', mt: 0.25 }}
                      >
                        {chk.details}
                      </Typography>
                    </Box>
                  </Stack>
                </Paper>
              ))}
            </Stack>

            {/* Recommendations */}
            {report.recommendations.length > 0 && (
              <Box>
                <Divider sx={{ my: 1.5 }} />
                <Typography
                  variant="subtitle2"
                  color="warning.main"
                  fontWeight={600}
                  sx={{ mb: 1 }}
                >
                  {t('diagnostics.advice')}
                </Typography>
                <Stack spacing={1}>
                  {report.recommendations.map((rec, i) => (
                    <Alert key={i} severity="warning" sx={{ py: 0.5, px: 1.5 }}>
                      <Typography variant="body2">{rec}</Typography>
                    </Alert>
                  ))}
                </Stack>
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button startIcon={<RefreshIcon />} onClick={runCheck} disabled={loading}>
          {t('actions.refresh')}
        </Button>
        <Button variant="contained" onClick={onClose}>
          {t('actions.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
