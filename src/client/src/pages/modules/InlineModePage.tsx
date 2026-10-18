import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../services/api';
import PageHeader from '../../components/PageHeader';
import { useModuleDocs } from '../../context/ModuleDocsContext';
import { useSnackbar } from '../../context/SnackbarContext';
import type { ModuleEntry } from '../../registry/modules';
import { localizedErrorMessage } from '../../utils/errors';

/** One inline quick-answer suggestion. */
interface InlineSuggestion {
  title: string;
  description?: string;
  content: string;
}

/** Effective module state from the modules API. */
interface ModuleState {
  isEnabled: boolean;
  config: Record<string, unknown>;
}

/**
 * Inline Mode page: saves quick answers served for @bot queries in any chat
 * and optionally routes unmatched queries through the AI assistant.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {ModuleEntry} props.module - Inline mode catalog entry.
 * @returns {React.ReactElement} The page.
 */
export default function InlineModePage({
  botId,
  module,
}: {
  botId: string;
  module: ModuleEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  const { openDocs } = useModuleDocs();
  const { showSuccess, showError } = useSnackbar();
  const [state, setState] = useState<ModuleState | null>(null);
  const [suggestions, setSuggestions] = useState<InlineSuggestion[]>([]);
  const [enableAi, setEnableAi] = useState(false);
  const [cacheSeconds, setCacheSeconds] = useState(30);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Array<{ key: string; isEnabled: boolean; config: Record<string, unknown> }>>(
      `/api/bots/${botId}/modules`,
    )
      .then((modules) => {
        const found = modules.find((entry) => entry.key === module.key);
        if (!found) return;
        setState({ isEnabled: found.isEnabled, config: found.config });
        const raw = Array.isArray(found.config.suggestions) ? found.config.suggestions : [];
        setSuggestions(
          raw.map((entry) => {
            const item = entry as Record<string, unknown>;
            return {
              title: String(item.title ?? ''),
              description: item.description ? String(item.description) : undefined,
              content: String(item.content ?? ''),
            };
          }),
        );
        setEnableAi(found.config.enableAi === true);
        setCacheSeconds(Number(found.config.cacheSeconds ?? 30) || 30);
      })
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }, [botId, module.key]);

  /**
   * Updates one suggestion field locally.
   */
  function updateSuggestion(index: number, patch: Partial<InlineSuggestion>): void {
    setSuggestions((current) =>
      current.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  /**
   * Persists the module config and hot-reloads the bot.
   * @returns {void}
   */
  function save(): void {
    const cleaned = suggestions
      .map((item) => ({
        title: item.title.trim(),
        description: item.description?.trim() || undefined,
        content: item.content.trim(),
      }))
      .filter((item) => item.title && item.content);
    const payload = {
      isEnabled: state?.isEnabled ?? false,
      config: { suggestions: cleaned, enableAi, cacheSeconds },
    };
    apiFetch(`/api/bots/${botId}/modules/${module.key}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
      .then(() => showSuccess(t('modules.configSaved')))
      .catch((err: Error) => showError(localizedErrorMessage(err)));
  }

  if (!state) {
    return (
      <Box>
        <PageHeader title={module.name} onDocs={() => openDocs(module)} />
        {error && <Alert severity="error">{error}</Alert>}
      </Box>
    );
  }

  return (
    <Box>
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

      <Alert severity="info" icon={<InfoOutlinedIcon />} sx={{ mb: 2 }}>
        {t('inlineMode.botFatherHint')}
      </Alert>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack spacing={2}>
            <Stack
              direction="row"
              sx={{
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Typography variant="subtitle2" component="h3">
                {t('inlineMode.quickAnswers')}
              </Typography>
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={() =>
                  setSuggestions((current) => [
                    ...current,
                    { title: '', content: '', description: undefined },
                  ])
                }
              >
                {t('inlineMode.addAnswer')}
              </Button>
            </Stack>

            {suggestions.map((suggestion, index) => (
              <Stack
                key={index}
                spacing={1}
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  p: 1.5,
                  position: 'relative',
                }}
              >
                <IconButton
                  size="small"
                  color="error"
                  sx={{ position: 'absolute', top: 6, right: 6 }}
                  aria-label={t('actions.delete')}
                  onClick={() => setSuggestions((current) => current.filter((_, i) => i !== index))}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
                <TextField
                  size="small"
                  fullWidth
                  label={t('inlineMode.title')}
                  value={suggestion.title}
                  onChange={(event) => updateSuggestion(index, { title: event.target.value })}
                />
                <TextField
                  size="small"
                  fullWidth
                  label={t('inlineMode.description')}
                  value={suggestion.description ?? ''}
                  onChange={(event) => updateSuggestion(index, { description: event.target.value })}
                />
                <TextField
                  size="small"
                  fullWidth
                  multiline
                  minRows={2}
                  label={t('inlineMode.content')}
                  value={suggestion.content}
                  onChange={(event) => updateSuggestion(index, { content: event.target.value })}
                  helperText={t('inlineMode.contentHelp')}
                />
              </Stack>
            ))}
            {suggestions.length === 0 && (
              <Typography
                variant="body2"
                sx={{
                  color: 'text.secondary',
                }}
              >
                {t('inlineMode.noAnswers')}
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Stack
              direction="row"
              sx={{
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Box>
                <Typography variant="body2">{t('inlineMode.enableAi')}</Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: 'text.secondary',
                  }}
                >
                  {t('inlineMode.enableAiHelp')}
                </Typography>
              </Box>
              <Switch
                checked={enableAi}
                onChange={(event) => setEnableAi(event.target.checked)}
                slotProps={{
                  input: { 'aria-label': t('inlineMode.enableAi') },
                }}
              />
            </Stack>
            <TextField
              select
              size="small"
              sx={{ maxWidth: 220 }}
              label={t('inlineMode.cacheSeconds')}
              value={String(cacheSeconds)}
              onChange={(event) => setCacheSeconds(Number(event.target.value))}
            >
              {[1, 10, 30, 60, 120, 300].map((value) => (
                <MenuItem key={value} value={String(value)}>
                  {value}
                </MenuItem>
              ))}
            </TextField>
            <Box>
              <Button variant="contained" onClick={save}>
                {t('actions.save')}
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
