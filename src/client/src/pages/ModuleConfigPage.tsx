import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Stack, Switch, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import PageHeader from '../components/PageHeader';
import AiKnowledgeDocsManager from '../components/AiKnowledgeDocsManager';
import FederationManager from '../components/FederationManager';
import BlockedUsersManager from '../components/BlockedUsersManager';
import FileIndexSection from '../components/FileIndexSection';
import BackfillSection from '../components/BackfillSection';
import { LoadingState } from '../components/Feedback';
import { ConfigFieldInput } from '../components/ConfigFieldInput';
import { ChatModuleConfigsSection } from '../components/ChatModuleConfigsSection';
import { useSnackbar } from '../context/SnackbarContext';
import { useModuleDocs } from '../context/ModuleDocsContext';
import type { ModuleEntry } from '../registry/modules';
import { localizedErrorMessage } from '../utils/errors';

/**
 * Effective module state from the modules API.
 * @interface ModuleState
 * @property {string} key - Module registry key.
 * @property {boolean} isEnabled - Runtime toggle state.
 * @property {Record<string, unknown>} config - Effective configuration.
 */
interface ModuleState {
  key: string;
  isEnabled: boolean;
  config: Record<string, unknown>;
}

/**
 * Generic configuration page rendered for `config`-type modules. Renders
 * registry-declared fields (text, number, switch, select, textarea,
 * string list, password), the enable toggle, the documentation dialog, and
 * — for chat-scoped modules — the per-group/per-channel override editor.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {ModuleEntry} props.module - Module catalog entry.
 * @param {boolean} [props.embedded] - If true, omits outer PageHeader.
 * @returns {React.ReactElement} The configuration page.
 */
export default function ModuleConfigPage({
  botId,
  module,
  embedded = false,
}: {
  botId: string;
  module: ModuleEntry;
  embedded?: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const { openDocs } = useModuleDocs();
  const [state, setState] = useState<ModuleState | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Array<{ key: string; isEnabled: boolean; config: Record<string, unknown> }>>(
      `/api/bots/${botId}/modules`,
    )
      .then((modules) => {
        const found = modules.find((entry) => entry.key === module.key);
        setState({
          key: module.key,
          isEnabled: found?.isEnabled ?? false,
          config: found?.config ?? {},
        });
      })
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }, [botId, module.key]);

  if (!state) {
    return (
      <Box>
        <PageHeader title={module.name} onDocs={() => openDocs(module)} />
        <LoadingState label={t('common.loading')} />
      </Box>
    );
  }

  /**
   * Updates one config value locally.
   * @param {string} key - Config key.
   * @param {unknown} value - New value.
   * @returns {void}
   */
  function setConfig(key: string, value: unknown): void {
    setState((current) =>
      current ? { ...current, config: { ...current.config, [key]: value } } : current,
    );
  }

  /**
   * Persists the module state and hot-reloads the bot.
   * @returns {void}
   */
  function save(): void {
    const snapshot = state;
    if (!snapshot) return;
    setStatus(null);
    setError(null);
    apiFetch(`/api/bots/${botId}/modules/${module.key}`, {
      method: 'PUT',
      body: JSON.stringify({ isEnabled: snapshot.isEnabled, config: snapshot.config }),
    })
      .then(() => {
        const msg = t('modules.configSaved') || 'Module configuration saved';
        setStatus(msg);
        showSuccess(msg);
      })
      .catch((err: Error) => {
        setError(localizedErrorMessage(err));
        showError(localizedErrorMessage(err));
      });
  }

  return (
    <Box>
      {!embedded ? (
        <PageHeader
          title={module.name}
          subtitle={module.description}
          onDocs={() => openDocs(module)}
          actions={
            <Stack
              direction="row"
              spacing={1}
              sx={{
                alignItems: 'center',
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  color: 'text.secondary',
                }}
              >
                {state.isEnabled ? t('status.enabled') : t('status.disabled')}
              </Typography>
              <Switch
                checked={state.isEnabled}
                onChange={(event) =>
                  setState((current) =>
                    current ? { ...current, isEnabled: event.target.checked } : current,
                  )
                }
                slotProps={{
                  input: { 'aria-label': `${module.name} ${t('status.enabled')}` },
                }}
              />
            </Stack>
          }
        />
      ) : (
        <Stack
          direction="row"
          spacing={1}
          sx={{
            alignItems: 'center',
            justifyContent: 'flex-end',
            mb: 1.5,
          }}
        >
          <Typography
            variant="caption"
            sx={{
              color: 'text.secondary',
            }}
          >
            {state.isEnabled ? t('status.enabled') : t('status.disabled')}
          </Typography>
          <Switch
            checked={state.isEnabled}
            onChange={(event) =>
              setState((current) =>
                current ? { ...current, isEnabled: event.target.checked } : current,
              )
            }
            slotProps={{
              input: { 'aria-label': `${module.name} ${t('status.enabled')}` },
            }}
          />
        </Stack>
      )}

      {status && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {status}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Card>
        <CardContent>
          <Stack spacing={2.5}>
            {(module.configFields ?? []).map((field) => (
              <ConfigFieldInput
                key={field.key}
                botId={botId}
                field={field}
                value={state.config[field.key]}
                onChange={(value) => setConfig(field.key, value)}
              />
            ))}
            {(module.configFields ?? []).length === 0 && (
              <Typography
                variant="body2"
                sx={{
                  color: 'text.secondary',
                }}
              >
                {t('modules.noOptions')}
              </Typography>
            )}
            {module.chatScoped && (
              <Typography
                variant="body2"
                sx={{
                  color: 'text.secondary',
                }}
              >
                {t('modules.chatScopedNote')}
              </Typography>
            )}
            <Box>
              <Button variant="contained" onClick={save}>
                {t('actions.save')}
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {module.chatScoped && <ChatModuleConfigsSection botId={botId} module={module} />}

      {module.key === 'ai-assistant' && <AiKnowledgeDocsManager botId={botId} />}
      {module.key === 'federation' && <FederationManager botId={botId} />}
      {module.key === 'moderation' && <BlockedUsersManager botId={botId} />}
      {module.key === 'file-search' && <BackfillSection botId={botId} />}
      {module.key === 'file-search' && <FileIndexSection botId={botId} />}
    </Box>
  );
}
