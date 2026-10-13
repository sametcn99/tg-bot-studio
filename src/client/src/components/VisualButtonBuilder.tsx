import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CodeIcon from '@mui/icons-material/Code';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import LanguageIcon from '@mui/icons-material/Language';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useTranslation } from 'react-i18next';

/** Telegram hard limit for inline keyboard buttons per message. */
const MAX_TOTAL_BUTTONS = 100;
/** Telegram hard limit for buttons in a single keyboard row. */
const MAX_TELEGRAM_PER_ROW = 8;
/** This studio's default preview layout: at most 3 buttons per row. */
const RECOMMENDED_PER_ROW = 3;
/** Telegram limit for callback_data payload size in bytes. */
const CALLBACK_DATA_MAX_BYTES = 64;
const URL_PATTERN = /^https?:\/\//i;
const HTTPS_PATTERN = /^https:\/\//i;

/** Supported Telegram inline button types in the visual builder. */
export type TelegramButtonType = 'url' | 'callback' | 'webapp' | 'copy';

/**
 * Editable card model for a single inline button. Besides the known fields of
 * every supported Telegram button shape it keeps unknown properties in `extra`
 * so JSON round-trips never silently drop data.
 *
 * @interface TelegramButtonCard
 * @property {TelegramButtonType} type - Active Telegram button type.
 * @property {string} text - Visible button label.
 * @property {string} url - Target URL for URL buttons and WebApp buttons.
 * @property {string} callbackData - Payload for Callback buttons.
 * @property {string} copyText - Payload text for Copy Text buttons.
 * @property {Record<string, unknown>} extra - Unknown properties, preserved verbatim.
 * @property {string} [extraRaw] - Raw extra JSON while it is being edited.
 */
export interface TelegramButtonCard {
  type: TelegramButtonType;
  text: string;
  url: string;
  callbackData: string;
  copyText: string;
  extra: Record<string, unknown>;
  extraRaw?: string;
}

/** Distinct preview icon per button type so non-URL buttons stand out. */
const TYPE_ICONS: Record<TelegramButtonType, React.ReactElement> = {
  url: <OpenInNewIcon sx={{ fontSize: 13, opacity: 0.85 }} />,
  callback: <TouchAppIcon sx={{ fontSize: 13, opacity: 0.85 }} />,
  webapp: <LanguageIcon sx={{ fontSize: 13, opacity: 0.85 }} />,
  copy: <ContentCopyIcon sx={{ fontSize: 13, opacity: 0.85 }} />,
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Maps one raw Telegram button object to an editable card. The active type is
 * detected from the payload shape; every other property is preserved in
 * `extra` instead of being dropped.
 *
 * @param raw - Raw button object from parsed JSON.
 * @returns Editable card model.
 */
const parseButtonCard = (raw: unknown): TelegramButtonCard => {
  const item = asRecord(raw);
  if (!item) {
    return { type: 'url', text: '', url: '', callbackData: '', copyText: '', extra: {} };
  }
  const rest: Record<string, unknown> = { ...item };
  const text = typeof rest.text === 'string' ? rest.text : String(rest.title ?? '');
  delete rest.text;
  delete rest.title;

  let type: TelegramButtonType = 'url';
  let url = '';
  let callbackData = '';
  let copyText = '';
  const webApp = asRecord(rest.web_app);
  const copyTextPayload = asRecord(rest.copy_text);
  if (webApp) {
    type = 'webapp';
    url = typeof webApp.url === 'string' ? webApp.url : '';
    delete rest.web_app;
  } else if (copyTextPayload) {
    type = 'copy';
    copyText = typeof copyTextPayload.text === 'string' ? copyTextPayload.text : '';
    delete rest.copy_text;
  } else if (typeof rest.callback_data === 'string') {
    type = 'callback';
    callbackData = rest.callback_data;
    delete rest.callback_data;
  } else if (rest.url !== undefined) {
    url = String(rest.url);
    delete rest.url;
  }
  return { type, text, url, callbackData, copyText, extra: rest };
};

type ParseResult =
  | { status: 'ok'; cards: TelegramButtonCard[]; rowSizes: number[] | null }
  | { status: 'invalid' }
  | { status: 'not-array' };

/**
 * Parses a buttons JSON payload into editable cards. Accepts both a flat
 * array of buttons and Telegram-style rows (an array of button arrays); rows
 * are flattened for editing while their sizes are kept for layout warnings.
 *
 * @param raw - Raw JSON string.
 * @returns Parsed cards with row metadata, or a failure status.
 */
const parseButtonsJson = (raw: string): ParseResult => {
  if (!raw || !raw.trim()) {
    return { status: 'ok', cards: [], rowSizes: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'invalid' };
  }
  if (!Array.isArray(parsed)) {
    return { status: 'not-array' };
  }
  const rowSizes: number[] = [];
  const cards: TelegramButtonCard[] = [];
  for (const entry of parsed) {
    if (Array.isArray(entry)) {
      rowSizes.push(entry.length);
      for (const item of entry) {
        cards.push(parseButtonCard(item));
      }
    } else {
      rowSizes.push(1);
      cards.push(parseButtonCard(entry));
    }
  }
  const hasButtonRows = rowSizes.some((size) => size > 1);
  return { status: 'ok', cards, rowSizes: hasButtonRows ? rowSizes : null };
};

/**
 * Resolves the extra properties of a card. While the raw JSON text of the
 * extras is being edited and temporarily invalid, the last valid extras are
 * emitted so the generated JSON never gets corrupted.
 *
 * @param card - Card model.
 * @returns Extra properties object (possibly empty).
 */
const resolveExtra = (card: TelegramButtonCard): Record<string, unknown> => {
  if (card.extraRaw === undefined) {
    return card.extra;
  }
  if (!card.extraRaw.trim()) {
    return {};
  }
  try {
    return asRecord(JSON.parse(card.extraRaw)) ?? {};
  } catch {
    return card.extra;
  }
};

/**
 * Serializes a card back into its Telegram button object shape, keeping the
 * canonical key order (text first) and appending preserved extras.
 *
 * @param card - Card model.
 * @returns Telegram button object.
 */
const buildButtonObject = (card: TelegramButtonCard): Record<string, unknown> => {
  const out: Record<string, unknown> = { text: card.text };
  if (card.type === 'url') {
    out.url = card.url;
  } else if (card.type === 'callback') {
    out.callback_data = card.callbackData;
  } else if (card.type === 'webapp') {
    out.web_app = { url: card.url };
  } else {
    out.copy_text = { text: card.copyText };
  }
  Object.assign(out, resolveExtra(card));
  return out;
};

/** UTF-8 byte length, as Telegram counts callback_data limits. */
const byteLength = (value: string): number => new TextEncoder().encode(value).length;

/** A validation finding rendered as helperText or a warning Alert. */
interface FieldIssue {
  key: string;
  params?: Record<string, string | number>;
}

/**
 * Light, non-blocking validation for a single card. Empty fields are
 * tolerated while typing; values Telegram would reject get an issue.
 *
 * @param card - Card model.
 * @returns First validation issue, or null when the card is acceptable.
 */
const validateCard = (card: TelegramButtonCard): FieldIssue | null => {
  if (card.type === 'url' && card.url.trim() && !URL_PATTERN.test(card.url.trim())) {
    return { key: 'visual.errUrlHttp' };
  }
  if (card.type === 'webapp' && card.url.trim() && !HTTPS_PATTERN.test(card.url.trim())) {
    return { key: 'visual.errWebAppHttps' };
  }
  if (card.type === 'callback') {
    const bytes = byteLength(card.callbackData);
    if (bytes < 1 || bytes > CALLBACK_DATA_MAX_BYTES) {
      return { key: 'visual.errCallbackDataLength', params: { bytes } };
    }
  }
  if (card.extraRaw !== undefined && card.extraRaw.trim()) {
    try {
      if (!asRecord(JSON.parse(card.extraRaw))) {
        return { key: 'visual.errExtraJson' };
      }
    } catch {
      return { key: 'visual.errExtraJson' };
    }
  }
  return null;
};

interface VisualButtonBuilderProps {
  value: string;
  onChange: (jsonValue: string) => void;
  label?: string;
  helperText?: string;
}

/**
 * Visual Inline Buttons Builder with real-time Telegram preview and
 * bidirectional sync between visual cards and raw JSON. Supports URL,
 * Callback, WebApp and Copy Text buttons and preserves unknown button
 * properties across visual <-> JSON round-trips.
 */
export default function VisualButtonBuilder({
  value,
  onChange,
  label,
  helperText,
}: VisualButtonBuilderProps): React.ReactElement {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'visual' | 'json'>('visual');
  const [buttons, setButtons] = useState<TelegramButtonCard[]>([]);
  const [rowSizes, setRowSizes] = useState<number[] | null>(null);
  const [jsonText, setJsonText] = useState(value || '');
  const [jsonError, setJsonError] = useState<string | null>(null);
  // Echo guard: skip re-parsing values this component emitted itself so
  // in-progress edits (e.g. invalid extra JSON) are never clobbered.
  const lastEmittedRef = useRef<string | null>(null);

  // Parse external value into structured list on change
  useEffect(() => {
    if (value === lastEmittedRef.current) {
      return;
    }
    lastEmittedRef.current = null;
    setJsonText(value || '');
    const result = parseButtonsJson(value || '');
    if (result.status !== 'ok') {
      setJsonError(
        t(result.status === 'invalid' ? 'visual.invalidJson' : 'visual.buttonsMustBeArray'),
      );
      return;
    }
    setButtons(result.cards);
    setRowSizes(result.rowSizes);
    setJsonError(null);
  }, [value, t]);

  const updateButtons = (next: TelegramButtonCard[]) => {
    setButtons(next);
    // Visual edits own the layout from here on: a flat list, one button per row.
    setRowSizes(null);
    const jsonStr = next.length > 0 ? JSON.stringify(next.map(buildButtonObject), null, 2) : '';
    lastEmittedRef.current = jsonStr;
    setJsonText(jsonStr);
    setJsonError(null);
    onChange(jsonStr);
  };

  const addButton = () => {
    updateButtons([
      ...buttons,
      {
        type: 'url',
        text: 'Click Here',
        url: 'https://',
        callbackData: '',
        copyText: '',
        extra: {},
      },
    ]);
  };

  const removeButton = (index: number) => {
    updateButtons(buttons.filter((_, idx) => idx !== index));
  };

  const patchCard = (index: number, patch: Partial<TelegramButtonCard>) => {
    const next = [...buttons];
    next[index] = { ...next[index], ...patch };
    updateButtons(next);
  };

  const handleJsonBlur = (val: string) => {
    setJsonText(val);
    if (!val.trim()) {
      lastEmittedRef.current = '';
      setButtons([]);
      setRowSizes(null);
      setJsonError(null);
      onChange('');
      return;
    }
    const result = parseButtonsJson(val);
    if (result.status !== 'ok') {
      setJsonError(
        t(result.status === 'invalid' ? 'visual.invalidJson' : 'visual.buttonsMustBeArray'),
      );
      return;
    }
    lastEmittedRef.current = val;
    setButtons(result.cards);
    setRowSizes(result.rowSizes);
    setJsonError(null);
    onChange(val);
  };

  const addPreset = (text: string, url: string) => {
    updateButtons([
      ...buttons,
      { type: 'url', text, url, callbackData: '', copyText: '', extra: {} },
    ]);
  };

  // Non-blocking limit warnings (total buttons and source row layout).
  const warnings = useMemo<FieldIssue[]>(() => {
    const list: FieldIssue[] = [];
    if (buttons.length > MAX_TOTAL_BUTTONS) {
      list.push({
        key: 'visual.warnMaxButtons',
        params: { count: buttons.length, max: MAX_TOTAL_BUTTONS },
      });
    }
    if (rowSizes) {
      const overRows = rowSizes
        .map((size, idx) => (size > RECOMMENDED_PER_ROW ? idx + 1 : 0))
        .filter(Boolean);
      if (overRows.length > 0) {
        list.push({
          key: 'visual.warnRowLimit',
          params: {
            rows: overRows.join(', '),
            recommended: RECOMMENDED_PER_ROW,
            max: MAX_TELEGRAM_PER_ROW,
          },
        });
      }
      list.push({ key: 'visual.rowsFlattened' });
    }
    return list;
  }, [buttons.length, rowSizes]);

  const hasExtraField = (card: TelegramButtonCard): boolean =>
    card.extraRaw !== undefined || Object.keys(card.extra).length > 0;

  const extraValue = (card: TelegramButtonCard): string => {
    if (card.extraRaw !== undefined) {
      return card.extraRaw;
    }
    return Object.keys(card.extra).length > 0 ? JSON.stringify(card.extra) : '';
  };

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        p: 2,
        bgcolor: 'background.paper',
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2" fontWeight={600}>
          {label ?? t('buttons.builderTitle')}
        </Typography>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{
            minHeight: 32,
            '& .MuiTab-root': { minHeight: 32, py: 0.5, px: 1.5, fontSize: '0.75rem' },
          }}
        >
          <Tab
            icon={<ViewModuleIcon sx={{ fontSize: 16 }} />}
            iconPosition="start"
            label={t('buttons.visualMode')}
            value="visual"
          />
          <Tab
            icon={<CodeIcon sx={{ fontSize: 16 }} />}
            iconPosition="start"
            label={t('buttons.jsonMode')}
            value="json"
          />
        </Tabs>
      </Stack>

      {tab === 'visual' ? (
        <Stack spacing={2}>
          {/* Layout & limit warnings (non-blocking) */}
          {warnings.map((issue) => (
            <Alert
              key={issue.key}
              severity={issue.key === 'visual.rowsFlattened' ? 'info' : 'warning'}
              sx={{ py: 0.5, '& .MuiAlert-message': { fontSize: '0.8125rem' } }}
            >
              {t(issue.key, issue.params)}
            </Alert>
          ))}

          {/* Preset Suggestions */}
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ alignSelf: 'center', mr: 0.5 }}
            >
              {t('visual.presetsLabel')}
            </Typography>
            <Chip
              size="small"
              label={t('visual.presetWebsite')}
              variant="outlined"
              onClick={() => addPreset('Visit Website', 'https://example.com')}
            />
            <Chip
              size="small"
              label={t('visual.presetChannel')}
              variant="outlined"
              onClick={() => addPreset('Join Channel', 'https://t.me/example')}
            />
            <Chip
              size="small"
              label={t('visual.presetSupport')}
              variant="outlined"
              onClick={() => addPreset('Contact Support', 'https://t.me/support_bot')}
            />
          </Stack>

          {/* List of buttons */}
          {buttons.map((btn, idx) => {
            const issue = validateCard(btn);
            const payloadIssue = issue && issue.key !== 'visual.errExtraJson' ? issue : null;
            return (
              <Paper
                key={idx}
                variant="outlined"
                sx={{ p: 1.5, bgcolor: 'background.default', borderRadius: 1.5 }}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="flex-start"
                  sx={{ flexWrap: 'wrap', rowGap: 1 }}
                >
                  <TextField
                    select
                    label={t('visual.buttonType')}
                    size="small"
                    value={btn.type}
                    onChange={(e) => patchCard(idx, { type: e.target.value as TelegramButtonType })}
                    sx={{ width: 150 }}
                  >
                    <MenuItem value="url">{t('visual.typeUrl')}</MenuItem>
                    <MenuItem value="callback">{t('visual.typeCallback')}</MenuItem>
                    <MenuItem value="webapp">{t('visual.typeWebApp')}</MenuItem>
                    <MenuItem value="copy">{t('visual.typeCopyText')}</MenuItem>
                  </TextField>
                  <TextField
                    label={t('buttons.text')}
                    size="small"
                    value={btn.text}
                    placeholder={t('visual.buttonFallback')}
                    onChange={(e) => patchCard(idx, { text: e.target.value })}
                    sx={{ flex: 1, minWidth: 160 }}
                  />
                  {btn.type === 'callback' ? (
                    <TextField
                      label={t('visual.callbackData')}
                      size="small"
                      value={btn.callbackData}
                      placeholder="menu:main"
                      error={Boolean(payloadIssue)}
                      helperText={
                        payloadIssue ? t(payloadIssue.key, payloadIssue.params) : undefined
                      }
                      onChange={(e) => patchCard(idx, { callbackData: e.target.value })}
                      sx={{ flex: 2, minWidth: 200 }}
                    />
                  ) : btn.type === 'copy' ? (
                    <TextField
                      label={t('visual.copyText')}
                      size="small"
                      value={btn.copyText}
                      onChange={(e) => patchCard(idx, { copyText: e.target.value })}
                      sx={{ flex: 2, minWidth: 200 }}
                    />
                  ) : (
                    <TextField
                      label={btn.type === 'webapp' ? t('visual.webAppUrl') : t('buttons.url')}
                      size="small"
                      value={btn.url}
                      placeholder="https://..."
                      error={Boolean(payloadIssue)}
                      helperText={
                        payloadIssue ? t(payloadIssue.key, payloadIssue.params) : undefined
                      }
                      onChange={(e) => patchCard(idx, { url: e.target.value })}
                      sx={{ flex: 2, minWidth: 200 }}
                    />
                  )}
                  <Tooltip title={t('actions.delete')}>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => removeButton(idx)}
                      aria-label={t('visual.deleteButtonAria')}
                      sx={{ mt: 0.5 }}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
                {/* Unknown button properties, preserved for lossless round-trips */}
                {hasExtraField(btn) && (
                  <TextField
                    label={`${t('visual.extraProps')} ${t('common.optional')}`}
                    size="small"
                    fullWidth
                    multiline
                    maxRows={4}
                    value={extraValue(btn)}
                    onChange={(e) => patchCard(idx, { extraRaw: e.target.value })}
                    error={issue?.key === 'visual.errExtraJson'}
                    helperText={
                      issue?.key === 'visual.errExtraJson' ? t('visual.errExtraJson') : undefined
                    }
                    sx={{
                      mt: 1.5,
                      '& .MuiOutlinedInput-input': { fontFamily: 'monospace', fontSize: '0.75rem' },
                    }}
                  />
                )}
              </Paper>
            );
          })}

          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddIcon />}
              onClick={addButton}
              sx={{ alignSelf: 'flex-start' }}
            >
              {t('buttons.addButton')}
            </Button>
            <Typography
              variant="caption"
              color={buttons.length > MAX_TOTAL_BUTTONS ? 'error' : 'text.secondary'}
            >
              {t('visual.buttonCount', { count: buttons.length, max: MAX_TOTAL_BUTTONS })}
            </Typography>
          </Stack>

          {/* Telegram-style Preview of buttons (3 per row, studio default) */}
          {buttons.length > 0 && (
            <Box
              sx={{
                mt: 1,
                p: 1.5,
                borderRadius: 2,
                bgcolor: (th) => (th.palette.mode === 'dark' ? '#18222d' : '#eef2f5'),
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mb: 1, fontWeight: 600 }}
              >
                {t('buttons.preview')}
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' },
                  gap: 0.75,
                }}
              >
                {buttons.map((btn, i) => (
                  <Box
                    key={i}
                    sx={{
                      p: 1,
                      textAlign: 'center',
                      borderRadius: 1,
                      bgcolor: (th) => (th.palette.mode === 'dark' ? '#2b5278' : '#2481cc'),
                      color: '#ffffff',
                      fontSize: '0.8125rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 0.5,
                      boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {btn.text || t('visual.buttonFallback')}
                    {TYPE_ICONS[btn.type]}
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </Stack>
      ) : (
        <Stack spacing={1}>
          <TextField
            multiline
            minRows={4}
            size="small"
            fullWidth
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            onBlur={(e) => handleJsonBlur(e.target.value)}
            error={Boolean(jsonError)}
            helperText={
              jsonError ??
              helperText ??
              '[{"text":"Open","url":"https://..."}, {"text":"Menu","callback_data":"menu:main"}]'
            }
          />
        </Stack>
      )}
    </Box>
  );
}
