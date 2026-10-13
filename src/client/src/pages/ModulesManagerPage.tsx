import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Grid,
  Link,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import PageHeader from '../components/PageHeader';
import ModuleHelpDialog from '../components/ModuleHelpDialog';
import { LoadingState } from '../components/Feedback';
import { MODULES, type ModuleEntry } from '../registry/modules';

/**
 * Effective module state returned by `GET /api/bots/:id/modules`.
 * @interface ModuleState
 * @property {string} key - Module registry key.
 * @property {boolean} isEnabled - Runtime toggle state.
 * @property {Record<string, unknown>} config - Effective configuration.
 */
interface ModuleState {
  key: string;
  name: string;
  category: string;
  description: string;
  isEnabled: boolean;
  config: Record<string, unknown>;
}

/**
 * Feature Toggles Center: enterprise switchboard grouped by category.
 * Toggling persists immediately and hot-reloads the bot runtime.
 * @returns {React.ReactElement} The switchboard page.
 */
export default function ModulesManagerPage(): React.ReactElement {
  const { t } = useTranslation();
  const { botId } = useParams<{ botId: string }>();
  const navigate = useNavigate();
  const [states, setStates] = useState<ModuleState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docsModule, setDocsModule] = useState<ModuleEntry | null>(null);

  useEffect(() => {
    apiFetch<ModuleState[]>(`/api/bots/${botId}/modules`)
      .then(setStates)
      .catch((err: Error) => setError(err.message));
  }, [botId]);

  const enabledCount = (states ?? []).filter((state) => state.isEnabled).length;

  /**
   * Toggles a module and updates the local state optimistically.
   * @param {ModuleState} state - Module being toggled.
   * @param {boolean} enabled - Desired state.
   * @returns {void}
   */
  function toggle(state: ModuleState, enabled: boolean): void {
    setStates((current) =>
      (current ?? []).map((entry) =>
        entry.key === state.key ? { ...entry, isEnabled: enabled } : entry,
      ),
    );
    apiFetch(`/api/bots/${botId}/modules/${state.key}`, {
      method: 'PUT',
      body: JSON.stringify({ isEnabled: enabled, config: state.config }),
    }).catch(() => {
      setStates((current) =>
        (current ?? []).map((entry) =>
          entry.key === state.key ? { ...entry, isEnabled: !enabled } : entry,
        ),
      );
      setError(t('modules.toggleFailed'));
    });
  }

  const categories = [...new Set((states ?? []).map((state) => state.category))];

  return (
    <Box>
      <PageHeader
        title={t('modules.managerTitle')}
        subtitle={t('modules.enabled', { count: enabledCount, total: MODULES.length })}
      />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {states === null ? (
        <LoadingState label={t('common.loading')} />
      ) : (
        categories.map((category) => (
          <Box key={category} sx={{ mb: 3 }} component="section" aria-label={category}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }} component="h3">
              {category}
            </Typography>
            <Grid container spacing={2}>
              {(states ?? [])
                .filter((state) => state.category === category)
                .map((state) => {
                  const entry = MODULES.find((module) => module.key === state.key);
                  return (
                    <Grid size={{ xs: 12, md: 6, lg: 4 }} key={state.key}>
                      <Card sx={{ height: '100%' }}>
                        <CardContent>
                          <Stack spacing={1} sx={{ height: '100%' }}>
                            <Stack
                              direction="row"
                              justifyContent="space-between"
                              alignItems="flex-start"
                              spacing={1}
                            >
                              <Typography variant="subtitle2" component="h4">
                                {state.name}
                              </Typography>
                              <Switch
                                size="small"
                                checked={state.isEnabled}
                                onChange={(event) => toggle(state, event.target.checked)}
                                inputProps={{
                                  'aria-label': `${state.name} ${t('status.enabled')}`,
                                }}
                              />
                            </Stack>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ flexGrow: 1 }}
                            >
                              {state.description}
                            </Typography>
                            <Stack direction="row" spacing={2}>
                              <Link
                                component="button"
                                type="button"
                                variant="caption"
                                fontWeight={600}
                                onClick={() => setDocsModule(entry ?? null)}
                              >
                                Docs
                              </Link>
                              <Link
                                component="button"
                                type="button"
                                variant="caption"
                                fontWeight={600}
                                onClick={() => navigate(`/bots/${botId}/m/${state.key}`)}
                              >
                                Configure
                              </Link>
                            </Stack>
                          </Stack>
                        </CardContent>
                      </Card>
                    </Grid>
                  );
                })}
            </Grid>
          </Box>
        ))
      )}

      <ModuleHelpDialog module={docsModule} onClose={() => setDocsModule(null)} />
    </Box>
  );
}
