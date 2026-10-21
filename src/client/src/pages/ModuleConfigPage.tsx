import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Paper,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
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

/** Structural value equality for dirty-state tracking. */
function sameConfig(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The module's enable toggle with a clear status chip — shared by the
 * embedded and standalone page headers.
 */
function EnabledToggle({
  enabled,
  onChange,
  label,
}: {
  enabled: boolean;
  onChange: (next: boolean) => void;
  label: string;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        alignItems: 'center',
      }}
    >
      <Chip
        size="small"
        color={enabled ? 'success' : 'default'}
        variant={enabled ? 'filled' : 'outlined'}
        label={enabled ? t('status.enabled') : t('status.disabled')}
      />
      <Switch
        checked={enabled}
        onChange={(event) => onChange(event.target.checked)}
        slotProps={{
          input: { 'aria-label': `${label} ${t('status.enabled')}` },
        }}
      />
    </Stack>
  );
}

/**
 * Generic configuration page rendered for `config`-type modules. Switch
 * fields render as a compact settings list, editor widgets below it, and a
 * sticky-feeling action bar tracks unsaved changes with explicit
 * save/discard. Chat-scoped modules show the per-chat master-detail editor
 * instead of bot-level fields. Documentation dialog stays in the header.
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
  const [baseline, setBaseline] = useState<Record<string, unknown>>({});
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
        setBaseline(found?.config ?? {});
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

  const fields = module.configFields ?? [];
  const switchFields = fields.filter((field) => field.type === 'switch');
  const contentFields = fields.filter((field) => field.type !== 'switch');
  const dirty = !sameConfig(state.config, baseline);

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
    setStatus(null);
  }

  /**
   * Toggles the module enabled state for this bot and hot-reloads.
   * @param {boolean} enabled - Target state.
   * @returns {void}
   */
  function handleToggle(enabled: boolean): void {
    if (!state) return;
    const previous = state.isEnabled;
    setState((current) => (current ? { ...current, isEnabled: enabled } : current));
    apiFetch(`/api/bots/${botId}/modules/${module.key}`, {
      method: 'PUT',
      body: JSON.stringify({ isEnabled: enabled, config: state.config }),
    })
      .then(() => {
        showSuccess(enabled ? t('status.enabled') : t('status.disabled'));
      })
      .catch((err: Error) => {
        setState((current) => (current ? { ...current, isEnabled: previous } : current));
        showError(localizedErrorMessage(err));
      });
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
        setBaseline({ ...snapshot.config });
        const msg = t('modules.configSaved') || 'Module configuration saved';
        setStatus(msg);
        showSuccess(msg);
      })
      .catch((err: Error) => {
        setError(localizedErrorMessage(err));
        showError(localizedErrorMessage(err));
      });
  }

  /**
   * Reverts unsaved edits back to the last saved configuration.
   * @returns {void}
   */
  function discard(): void {
    setState((current) => (current ? { ...current, config: { ...baseline } } : current));
    setStatus(null);
  }

  const actionBar = (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 1,
      }}
    >
      {dirty && <Chip size="small" color="warning" label={t('modules.unsavedChanges')} />}
      <Button variant="contained" onClick={save} disabled={!dirty}>
        {t('actions.save')}
      </Button>
      {dirty && (
        <Button variant="text" onClick={discard}>
          {t('actions.discard')}
        </Button>
      )}
    </Stack>
  );

  return (
    <Box>
      {embedded ? (
        <Stack
          direction="row"
          spacing={1.5}
          sx={{
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: 1.5,
            flexWrap: 'wrap',
            gap: 1,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700 }}>
              {module.name}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
              {module.description}
            </Typography>
          </Box>
          <EnabledToggle enabled={state.isEnabled} onChange={handleToggle} label={module.name} />
        </Stack>
      ) : (
        <PageHeader
          title={module.name}
          subtitle={module.description}
          onDocs={() => openDocs(module)}
          actions={
            <EnabledToggle enabled={state.isEnabled} onChange={handleToggle} label={module.name} />
          }
        />
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

      {module.chatScoped ? (
        <>
          <Alert severity="info" sx={{ mb: 2 }}>
            {t('modules.chatScopedNote')}
          </Alert>
          <ChatModuleConfigsSection botId={botId} module={module} />
        </>
      ) : (
        <Card>
          <CardContent>
            <Stack spacing={2.5}>
              {switchFields.length > 0 && (
                <Paper variant="outlined" sx={{ px: 2, py: 0.5 }}>
                  {switchFields.map((field, index) => (
                    <React.Fragment key={field.key}>
                      {index > 0 && <Divider />}
                      <ConfigFieldInput
                        botId={botId}
                        field={field}
                        value={state.config[field.key]}
                        onChange={(value) => setConfig(field.key, value)}
                      />
                    </React.Fragment>
                  ))}
                </Paper>
              )}

              {contentFields.length > 0 && (
                <Stack spacing={2.5}>
                  {contentFields.map((field) => (
                    <ConfigFieldInput
                      key={field.key}
                      botId={botId}
                      field={field}
                      value={state.config[field.key]}
                      onChange={(value) => setConfig(field.key, value)}
                    />
                  ))}
                </Stack>
              )}

              {fields.length === 0 && (
                <Typography
                  variant="body2"
                  sx={{
                    color: 'text.secondary',
                  }}
                >
                  {t('modules.noOptions')}
                </Typography>
              )}

              <Divider />

              {actionBar}
            </Stack>
          </CardContent>
        </Card>
      )}

      {module.key === 'ai-assistant' && <AiKnowledgeDocsManager botId={botId} />}
      {module.key === 'federation' && <FederationManager botId={botId} />}
      {module.key === 'moderation' && <BlockedUsersManager botId={botId} />}
      {module.key === 'file-search' && <BackfillSection botId={botId} />}
      {module.key === 'file-search' && <FileIndexSection botId={botId} />}
    </Box>
  );
}
