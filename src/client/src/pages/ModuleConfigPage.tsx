import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import PageHeader from '../components/PageHeader';
import ModuleHelpDialog from '../components/ModuleHelpDialog';
import { ConnectionSelect } from '../components/ConnectionSelect';
import AiKnowledgeDocsManager from '../components/AiKnowledgeDocsManager';
import { LoadingState } from '../components/Feedback';
import { useSnackbar } from '../context/SnackbarContext';
import type { ConfigField, ModuleEntry } from '../registry/modules';

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
 * string list, password), the enable toggle, and the documentation dialog.
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
  botId: number;
  module: ModuleEntry;
  embedded?: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [state, setState] = useState<ModuleState | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);

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
      .catch((err: Error) => setError(err.message));
  }, [botId, module.key]);

  if (!state) {
    return (
      <Box>
        <PageHeader title={module.name} onDocs={() => setDocsOpen(true)} />
        <LoadingState label={t('common.loading')} />
        <ModuleHelpDialog module={docsOpen ? module : null} onClose={() => setDocsOpen(false)} />
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
        setError(err.message);
        showError(err.message);
      });
  }

  return (
    <Box>
      {!embedded ? (
        <PageHeader
          title={module.name}
          subtitle={module.description}
          onDocs={() => setDocsOpen(true)}
          actions={
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="caption" color="text.secondary">
                {state.isEnabled ? t('status.enabled') : t('status.disabled')}
              </Typography>
              <Switch
                checked={state.isEnabled}
                onChange={(event) =>
                  setState((current) =>
                    current ? { ...current, isEnabled: event.target.checked } : current,
                  )
                }
                inputProps={{ 'aria-label': `${module.name} ${t('status.enabled')}` }}
              />
            </Stack>
          }
        />
      ) : (
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          justifyContent="flex-end"
          sx={{ mb: 1.5 }}
        >
          <Typography variant="caption" color="text.secondary">
            {state.isEnabled ? t('status.enabled') : t('status.disabled')}
          </Typography>
          <Switch
            checked={state.isEnabled}
            onChange={(event) =>
              setState((current) =>
                current ? { ...current, isEnabled: event.target.checked } : current,
              )
            }
            inputProps={{ 'aria-label': `${module.name} ${t('status.enabled')}` }}
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
                field={field}
                value={state.config[field.key]}
                onChange={(value) => setConfig(field.key, value)}
              />
            ))}
            {(module.configFields ?? []).length === 0 && (
              <Typography variant="body2" color="text.secondary">
                This module has no configurable options.
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

      {module.key === 'ai-assistant' && <AiKnowledgeDocsManager botId={botId} />}

      <ModuleHelpDialog module={docsOpen ? module : null} onClose={() => setDocsOpen(false)} />
    </Box>
  );
}

/**
 * Renders a single configuration field widget with an optional help tooltip
 * implemented as an accessible icon button inside the label adornment.
 * @param {object} props - Component props.
 * @param {ConfigField} props.field - Field definition.
 * @param {unknown} props.value - Current value.
 * @param {(value: unknown) => void} props.onChange - Change callback.
 * @returns {React.ReactElement} The field widget.
 */
function ConfigFieldInput({
  field,
  value,
  onChange,
}: {
  field: ConfigField;
  value: unknown;
  onChange: (value: unknown) => void;
}): React.ReactElement {
  // Chat picks stay numeric when the id is numeric so numeric config keys
  // (support admin chat, VIP channel) keep their stored type.
  const onChatChange = (next: string): void => onChange(/^-?\d+$/.test(next) ? Number(next) : next);

  if (field.type === 'chatSelect') {
    return (
      <ConnectionSelect
        label={field.label}
        value={value === undefined || value === null ? '' : String(value)}
        onChange={onChatChange}
        types={field.connectionTypes}
        helperText={field.help}
      />
    );
  }

  const helpAdornment = field.help ? (
    <InputAdornment position="end">
      <Tooltip title={field.help}>
        <IconButton size="small" aria-label={`Help: ${field.label}`} edge="end">
          <InfoOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </InputAdornment>
  ) : undefined;

  const baseProps = {
    label: field.label,
    fullWidth: true,
    size: 'small' as const,
    InputProps: helpAdornment ? { endAdornment: helpAdornment } : undefined,
  };

  switch (field.type) {
    case 'switch':
      return (
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Typography variant="body2" id={`${field.key}-label`}>
              {field.label}
            </Typography>
            {field.help ? (
              <Tooltip title={field.help}>
                <IconButton size="small" aria-label={`Help: ${field.label}`}>
                  <InfoOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
          </Stack>
          <Switch
            checked={Boolean(value)}
            onChange={(event) => onChange(event.target.checked)}
            inputProps={{ 'aria-labelledby': `${field.key}-label` }}
          />
        </Stack>
      );
    case 'select':
      return (
        <TextField
          {...baseProps}
          select
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        >
          {(field.options ?? []).map((option) => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </TextField>
      );
    case 'number':
      return (
        <TextField
          {...baseProps}
          type="number"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      );
    case 'password':
      return (
        <TextField
          {...baseProps}
          type="password"
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'textarea':
      return (
        <TextField
          {...baseProps}
          multiline
          minRows={3}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'stringList':
      return (
        <TextField
          {...baseProps}
          multiline
          minRows={3}
          value={Array.isArray(value) ? value.join('\n') : ''}
          onChange={(event) =>
            onChange(
              event.target.value
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
            )
          }
          helperText="One entry per line"
        />
      );
    default:
      return (
        <TextField
          {...baseProps}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}
