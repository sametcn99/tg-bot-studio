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
import { ConnectionSelect } from '../components/ConnectionSelect';
import AiKnowledgeDocsManager from '../components/AiKnowledgeDocsManager';
import FederationManager from '../components/FederationManager';
import BlockedUsersManager from '../components/BlockedUsersManager';
import { LoadingState } from '../components/Feedback';
import MediaPicker from '../components/MediaPicker';
import AiTranslateDialog from '../components/AiTranslateDialog';
import { useSnackbar } from '../context/SnackbarContext';
import { useModuleDocs } from '../context/ModuleDocsContext';
import type { ConfigField, ModuleEntry } from '../registry/modules';
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
                botId={botId}
                field={field}
                value={state.config[field.key]}
                onChange={(value) => setConfig(field.key, value)}
              />
            ))}
            {(module.configFields ?? []).length === 0 && (
              <Typography variant="body2" color="text.secondary">
                {t('modules.noOptions')}
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
      {module.key === 'federation' && <FederationManager botId={botId} />}
      {module.key === 'moderation' && <BlockedUsersManager botId={botId} />}
    </Box>
  );
}

/**
 * Renders a single configuration field widget with an optional help tooltip
 * implemented as an accessible icon button inside the label adornment.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id (media picker, AI translate).
 * @param {ConfigField} props.field - Field definition.
 * @param {unknown} props.value - Current value.
 * @param {(value: unknown) => void} props.onChange - Change callback.
 * @returns {React.ReactElement} The field widget.
 */
function ConfigFieldInput({
  botId,
  field,
  value,
  onChange,
}: {
  botId: number;
  field: ConfigField;
  value: unknown;
  onChange: (value: unknown) => void;
}): React.ReactElement {
  const { t } = useTranslation();
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

  if (field.type === 'mediaSelect') {
    return (
      <MediaSelectField
        botId={botId}
        label={field.label}
        value={String(value ?? '')}
        onChange={onChange}
      />
    );
  }

  if ((field.type === 'text' || field.type === 'textarea') && typeof value === 'string') {
    return (
      <TranslatableTextField
        botId={botId}
        field={field}
        value={value}
        helpAdornment={
          field.help ? (
            <InputAdornment position="end">
              <Tooltip title={field.help}>
                <IconButton
                  size="small"
                  aria-label={t('common.helpFor', { field: field.label })}
                  edge="end"
                >
                  <InfoOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ) : undefined
        }
        onChange={onChange}
      />
    );
  }

  const helpAdornment = field.help ? (
    <InputAdornment position="end">
      <Tooltip title={field.help}>
        <IconButton
          size="small"
          aria-label={t('common.helpFor', { field: field.label })}
          edge="end"
        >
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
                <IconButton size="small" aria-label={t('common.helpFor', { field: field.label })}>
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
          helperText={t('modules.onePerLine')}
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

/**
 * Media library picker field: a read-only value input plus a button opening
 * the shared media library to pick a saved URL or Telegram file_id.
 */
function MediaSelectField({
  botId,
  label,
  value,
  onChange,
}: {
  botId: number;
  label: string;
  value: string;
  onChange: (value: unknown) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <TextField
        size="small"
        fullWidth
        label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <Button size="small" onClick={() => setPickerOpen(true)} sx={{ whiteSpace: 'nowrap' }}>
        {t('mediaLibrary.select')}
      </Button>
      <MediaPicker
        botId={botId}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(picked) => onChange(picked)}
      />
    </Stack>
  );
}

/**
 * Text/textarea field with a one-click AI translation helper: opens the
 * translation dialog, then applies the picked language version back to the
 * field.
 */
function TranslatableTextField({
  botId,
  field,
  value,
  helpAdornment,
  onChange,
}: {
  botId: number;
  field: ConfigField;
  value: string;
  helpAdornment?: React.ReactElement;
  onChange: (value: unknown) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [translateOpen, setTranslateOpen] = useState(false);
  const multiline = field.type === 'textarea';
  return (
    <Box>
      <TextField
        size="small"
        fullWidth
        label={field.label}
        multiline={multiline}
        minRows={multiline ? 3 : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        InputProps={helpAdornment ? { endAdornment: helpAdornment } : undefined}
      />
      <Box sx={{ mt: 0.5 }}>
        <Button size="small" disabled={!value.trim()} onClick={() => setTranslateOpen(true)}>
          {t('translate.openButton')}
        </Button>
      </Box>
      <AiTranslateDialog
        botId={botId}
        open={translateOpen}
        text={value}
        onClose={() => setTranslateOpen(false)}
        onApply={(text) => onChange(text)}
      />
    </Box>
  );
}
