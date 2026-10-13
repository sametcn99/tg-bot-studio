import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import CloseIcon from '@mui/icons-material/Close';
import KeyIcon from '@mui/icons-material/Key';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import TuneIcon from '@mui/icons-material/Tune';
import CableIcon from '@mui/icons-material/Cable';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import { useBots } from '../context/BotContext';

/** localStorage flag set once the dismiss button is pressed. */
const DISMISS_KEY = 'onboarding_dismissed';
/** localStorage flag set by the simulator after the first successful message. */
const SIM_USED_KEY = 'onboarding_sim_used';

/** Marks the simulator step as done (called by BotSimulatorDrawer). */
export function markSimulatorUsed(): void {
  try {
    localStorage.setItem(SIM_USED_KEY, '1');
  } catch {
    /* private mode */
  }
}

/**
 * First-run checklist guiding a new operator from secure setup to a tested
 * bot: rotate the default master key, add a bot, enable modules, sync
 * connections, and send the first simulator message. Progress is derived
 * from live API state (plus one localStorage flag) and the card can be
 * dismissed.
 * @returns {React.ReactElement | null} The checklist card, or null when done/dismissed.
 */
export default function OnboardingChecklist(): React.ReactElement | null {
  const { t } = useTranslation();
  const { bots, activeBot } = useBots();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [defaultKey, setDefaultKey] = useState<boolean | null>(null);
  const [connectionsCount, setConnectionsCount] = useState<number | null>(null);
  const [simUsed, setSimUsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIM_USED_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    apiFetch<{ isDefaultMasterKey: boolean }>('/api/auth/security-status')
      .then((status) => setDefaultKey(status.isDefaultMasterKey))
      .catch(() => setDefaultKey(null));
  }, []);

  useEffect(() => {
    if (!activeBot) return;
    apiFetch<Array<unknown>>(`/api/bots/${activeBot.id}/connections`)
      .then((rows) => setConnectionsCount(rows.length))
      .catch(() => setConnectionsCount(null));
  }, [activeBot]);

  useEffect(() => {
    const onStorage = (): void =>
      setSimUsed(
        (() => {
          try {
            return localStorage.getItem(SIM_USED_KEY) === '1';
          } catch {
            return false;
          }
        })(),
      );
    window.addEventListener('storage', onStorage);
    const poll = window.setInterval(onStorage, 2000);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.clearInterval(poll);
    };
  }, []);

  if (dismissed) return null;

  const steps = [
    {
      key: 'keyRotate',
      icon: <KeyIcon fontSize="small" />,
      done: defaultKey === false,
      label: t('onboarding.stepKey'),
      action: defaultKey === false ? undefined : t('onboarding.actionRotate'),
      onAction: () => navigate('/security'),
    },
    {
      key: 'addBot',
      icon: <SmartToyIcon fontSize="small" />,
      done: bots.length > 0,
      label: t('onboarding.stepBot'),
      action: bots.length > 0 ? undefined : t('onboarding.actionAdd'),
      onAction: () => navigate('/'),
    },
    {
      key: 'enableModules',
      icon: <TuneIcon fontSize="small" />,
      done: bots.some((bot) => bot.activeModules > 0),
      label: t('onboarding.stepModules'),
      action: undefined,
      onAction: () => activeBot && navigate(`/bots/${activeBot.id}/modules`),
    },
    {
      key: 'syncConnections',
      icon: <CableIcon fontSize="small" />,
      done: (connectionsCount ?? 0) > 0,
      label: t('onboarding.stepConnections'),
      action: activeBot && (connectionsCount ?? 0) === 0 ? t('onboarding.actionSync') : undefined,
      onAction: () => activeBot && navigate(`/bots/${activeBot.id}/m/connections`),
    },
    {
      key: 'firstSimMessage',
      icon: <PlayArrowIcon fontSize="small" />,
      done: simUsed,
      label: t('onboarding.stepSimulator'),
      action: simUsed ? undefined : t('onboarding.actionTest'),
      onAction: () => activeBot && navigate(`/bots/${activeBot.id}`),
    },
  ];

  const doneCount = steps.filter((step) => step.done).length;
  if (doneCount === steps.length) return null;

  return (
    <Box
      component="section"
      aria-label={t('onboarding.title')}
      sx={{
        mb: 3,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        p: 2,
        bgcolor: 'background.paper',
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Typography variant="subtitle2" fontWeight={700} component="h2">
            {t('onboarding.title')}
          </Typography>
          <Chip size="small" label={`${doneCount}/${steps.length}`} />
        </Stack>
        <IconButton
          size="small"
          aria-label={t('onboarding.dismiss')}
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, '1');
            } catch {
              /* private mode */
            }
            setDismissed(true);
          }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
      <List dense>
        {steps.map((step) => (
          <ListItem
            key={step.key}
            disableGutters
            secondaryAction={
              step.action ? (
                <Button size="small" variant="outlined" onClick={step.onAction}>
                  {step.action}
                </Button>
              ) : undefined
            }
          >
            <ListItemIcon sx={{ minWidth: 34 }}>
              {step.done ? (
                <CheckCircleIcon fontSize="small" color="success" aria-hidden="true" />
              ) : (
                <RadioButtonUncheckedIcon fontSize="small" color="disabled" aria-hidden="true" />
              )}
            </ListItemIcon>
            <ListItemText
              primary={step.label}
              primaryTypographyProps={{
                variant: 'body2',
                sx: {
                  color: step.done ? 'text.disabled' : 'text.primary',
                  textDecoration: step.done ? 'line-through' : 'none',
                },
              }}
            />
          </ListItem>
        ))}
      </List>
    </Box>
  );
}
