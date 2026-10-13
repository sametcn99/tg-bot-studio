import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import ShoppingBagIcon from '@mui/icons-material/ShoppingBag';
import GroupsIcon from '@mui/icons-material/Groups';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';

interface BotPresetsDialogProps {
  botId: number;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function BotPresetsDialog({
  botId,
  open,
  onClose,
  onSuccess,
}: BotPresetsDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const [applying, setApplying] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const presets = [
    {
      key: 'ecommerce',
      title: t('presets.ecommerceTitle'),
      desc: t('presets.ecommerceDesc'),
      icon: <ShoppingBagIcon sx={{ fontSize: 32, color: 'primary.main' }} />,
      modules: ['start-menu', 'mini-apps', 'support', 'paid-media'],
    },
    {
      key: 'community',
      title: t('presets.communityTitle'),
      desc: t('presets.communityDesc'),
      icon: <GroupsIcon sx={{ fontSize: 32, color: 'success.main' }} />,
      modules: ['welcome', 'captcha', 'moderation', 'message-score', 'giveaways'],
    },
    {
      key: 'support',
      title: t('presets.supportTitle'),
      desc: t('presets.supportDesc'),
      icon: <SupportAgentIcon sx={{ fontSize: 32, color: 'info.main' }} />,
      modules: ['support', 'ai-assistant', 'autoresponder'],
    },
    {
      key: 'growth',
      title: t('presets.growthTitle'),
      desc: t('presets.growthDesc'),
      icon: <RocketLaunchIcon sx={{ fontSize: 32, color: 'warning.main' }} />,
      modules: ['referrals', 'broadcast', 'drip', 'quizzes'],
    },
  ];

  const handleApply = async (presetKey: string) => {
    setApplying(presetKey);
    setError(null);
    setSuccessMsg(null);
    try {
      await apiFetch(`/api/bots/${botId}/presets/${presetKey}`, {
        method: 'POST',
      });
      setSuccessMsg(`Preset bundle activated successfully! Modules hot-reloaded.`);
      onSuccess();
      setTimeout(() => {
        onClose();
        setSuccessMsg(null);
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Typography variant="h6" fontWeight={700}>
          {t('presets.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('presets.subtitle')}
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        {successMsg && (
          <Alert severity="success" icon={<CheckCircleIcon />} sx={{ mb: 2 }}>
            {successMsg}
          </Alert>
        )}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Grid container spacing={2}>
          {presets.map((preset) => (
            <Grid size={{ xs: 12, sm: 6 }} key={preset.key}>
              <Card
                variant="outlined"
                sx={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  borderRadius: 2,
                  transition: 'all 0.2s',
                  '&:hover': { borderColor: 'primary.main', boxShadow: 2 },
                }}
              >
                <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
                    {preset.icon}
                    <Box>
                      <Typography variant="subtitle1" fontWeight={700}>
                        {preset.title}
                      </Typography>
                    </Box>
                  </Stack>

                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2, flexGrow: 1 }}>
                    {preset.desc}
                  </Typography>

                  <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.75, display: 'block' }}>
                    Included Modules:
                  </Typography>
                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
                    {preset.modules.map((m) => (
                      <Chip key={m} label={m} size="small" variant="outlined" />
                    ))}
                  </Stack>

                  <Button
                    variant="contained"
                    fullWidth
                    onClick={() => void handleApply(preset.key)}
                    disabled={Boolean(applying)}
                  >
                    {applying === preset.key ? <CircularProgress size={20} color="inherit" /> : t('presets.apply')}
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>{t('actions.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
