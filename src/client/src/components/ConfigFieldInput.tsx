import React, { useState } from 'react';
import {
  Box,
  Button,
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
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteIcon from '@mui/icons-material/Delete';
import LinkIcon from '@mui/icons-material/Link';
import { useTranslation } from 'react-i18next';
import { ConnectionSelect, ConnectionMultiSelect } from './ConnectionSelect';
import MediaPicker from './MediaPicker';
import AiTranslateDialog from './AiTranslateDialog';
import VisualButtonBuilder from './VisualButtonBuilder';
import type { ConfigField } from '../registry/modules';

/**
 * Renders a single registry-declared configuration field widget (text,
 * number, switch, select, textarea, string list, password, chat picker,
 * multi chat picker, media picker) with an optional help tooltip. Shared by
 * the bot-level module config page and the per-chat override editors so both
 * surfaces always stay in sync.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id (media picker, AI translate).
 * @param {ConfigField} props.field - Field definition.
 * @param {unknown} props.value - Current value.
 * @param {(value: unknown) => void} props.onChange - Change callback.
 * @param {React.ReactElement} [props.action] - Optional trailing control
 * (per-chat editors put an "inherit bot default" button here).
 * @returns {React.ReactElement} The field widget.
 */
export function ConfigFieldInput({
  botId,
  field,
  value,
  onChange,
  action,
}: {
  botId: string;
  field: ConfigField;
  value: unknown;
  onChange: (value: unknown) => void;
  action?: React.ReactElement;
}): React.ReactElement {
  const { t } = useTranslation();
  // Chat picks stay numeric when the id is numeric so numeric config keys
  // (support admin chat, VIP channel) keep their stored type.
  const onChatChange = (next: string): void => {
    if (!next) {
      onChange(typeof value === 'number' ? 0 : '');
      return;
    }
    onChange(/^-?\d+$/.test(next) ? Number(next) : next);
  };

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

  if (field.type === 'chatSelect') {
    return (
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'center',
        }}
      >
        <Box sx={{ flexGrow: 1 }}>
          <ConnectionSelect
            label={field.label}
            value={value === undefined || value === null || value === 0 ? '' : String(value)}
            onChange={onChatChange}
            types={field.connectionTypes}
            helperText={field.help}
            botId={botId}
          />
        </Box>
        {action}
      </Stack>
    );
  }

  if (field.type === 'chatMultiSelect') {
    return (
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'center',
        }}
      >
        <Box sx={{ flexGrow: 1 }}>
          <ConnectionMultiSelect
            label={field.label}
            value={Array.isArray(value) ? value.map(String) : []}
            onChange={(next) => onChange(next)}
            types={field.connectionTypes}
            helperText={field.help}
            botId={botId}
          />
        </Box>
        {action}
      </Stack>
    );
  }

  if (field.type === 'mediaSelect') {
    return (
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'center',
        }}
      >
        <Box sx={{ flexGrow: 1 }}>
          <MediaSelectField
            botId={botId}
            label={field.label}
            value={String(value ?? '')}
            onChange={onChange}
          />
        </Box>
        {action}
      </Stack>
    );
  }

  if (field.type === 'mediaUpload') {
    return (
      <MediaUploadConfigField
        botId={botId}
        label={field.label}
        help={field.help}
        value={String(value ?? '')}
        onChange={onChange}
        action={action}
      />
    );
  }

  if (field.type === 'buttonBuilder') {
    return (
      <VisualButtonBuilder
        label={field.label}
        value={String(value ?? '')}
        onChange={(next) => onChange(next)}
        helperText={field.help}
      />
    );
  }

  if ((field.type === 'text' || field.type === 'textarea') && typeof value === 'string') {
    return (
      <TranslatableTextField
        botId={botId}
        field={field}
        value={value}
        helpAdornment={helpAdornment}
        onChange={onChange}
        action={action}
      />
    );
  }

  const baseProps = {
    label: field.label,
    fullWidth: true,
    size: 'small' as const,
    slotProps: helpAdornment ? { input: { endAdornment: helpAdornment } } : undefined,
  };

  switch (field.type) {
    case 'switch':
      return (
        <Stack
          direction="row"
          spacing={1}
          sx={{
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Stack
            direction="row"
            spacing={0.5}
            sx={{
              alignItems: 'center',
            }}
          >
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
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: 'center',
            }}
          >
            <Switch
              checked={Boolean(value)}
              onChange={(event) => onChange(event.target.checked)}
              slotProps={{
                input: { 'aria-labelledby': `${field.key}-label` },
              }}
            />
            {action}
          </Stack>
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
 * Media field with byte upload: a file picker stores the file inline as a
 * data: URL (sent by the server as raw bytes via a Telegram InputFile), with
 * instant preview, clear action, manual URL / file_id input, and the shared
 * media library picker. Mirrors the Commands & Auto-Responder upload widget.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id (media library picker).
 * @param {string} props.label - Field label.
 * @param {string} [props.help] - Helper text under the label.
 * @param {string} props.value - Current value: data: URL, http(s) URL, or file_id.
 * @param {(value: unknown) => void} props.onChange - Change callback.
 * @param {React.ReactElement} [props.action] - Optional trailing control.
 * @returns {React.ReactElement} The upload field.
 */
function MediaUploadConfigField({
  botId,
  label,
  help,
  value,
  onChange,
  action,
}: {
  botId: string;
  label: string;
  help?: string;
  value: string;
  onChange: (value: unknown) => void;
  action?: React.ReactElement;
}): React.ReactElement {
  const { t } = useTranslation();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [urlMode, setUrlMode] = useState(
    Boolean(value) && !value.startsWith('data:') && !/^(file_)?[A-Za-z0-9_-]{20,}$/.test(value),
  );

  const trimmed = value.trim();
  const isUploaded = trimmed.startsWith('data:');
  const mime = isUploaded ? (trimmed.slice(5, trimmed.indexOf(';')) || '').toLowerCase() : '';
  const isVideo = mime.startsWith('video/') || /\.(mp4|mov|webm)(\?|$)/i.test(trimmed);
  const fileName = isUploaded
    ? `${isVideo ? 'video' : mime === 'image/gif' ? 'animation' : 'photo'}.${mime.split('/')[1] ?? 'bin'}`
    : trimmed
      ? (trimmed.split('/').pop()?.split('?')[0] ?? '')
      : '';

  /**
   * Reads the picked file as a data: URL so its bytes travel inside the
   * config value and the runtime can send them without a public host.
   * @param {React.ChangeEvent<HTMLInputElement>} event - File input change.
   * @returns {void}
   */
  const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onChange(reader.result as string);
      setUrlMode(false);
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  return (
    <Box>
      <Box
        sx={{
          p: 1.5,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1.5,
          bgcolor: 'background.default',
        }}
      >
        <Stack spacing={1.5}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {label}
            </Typography>
            {trimmed && (
              <Button
                size="small"
                color="error"
                startIcon={<DeleteIcon />}
                onClick={() => onChange('')}
              >
                {t('actions.delete')}
              </Button>
            )}
          </Stack>

          {help && (
            <Typography variant="caption" color="text.secondary">
              {help}
            </Typography>
          )}

          {trimmed ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Box
                sx={{
                  maxHeight: 180,
                  borderRadius: 1,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: 'action.hover',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                {isVideo ? (
                  <Box
                    component="video"
                    src={trimmed}
                    controls
                    sx={{ maxHeight: 180, maxWidth: '100%' }}
                  />
                ) : (
                  <Box
                    component="img"
                    src={trimmed}
                    alt="Preview"
                    sx={{ maxHeight: 180, maxWidth: '100%', objectFit: 'contain' }}
                  />
                )}
              </Box>
              {fileName && (
                <Typography variant="caption" color="text.secondary" noWrap>
                  {fileName}
                </Typography>
              )}
            </Box>
          ) : null}

          <input
            type="file"
            ref={fileInputRef}
            accept="image/*,video/mp4,video/webm"
            style={{ display: 'none' }}
            onChange={handleFileSelected}
          />

          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<CloudUploadIcon />}
              onClick={() => fileInputRef.current?.click()}
            >
              {trimmed ? t('actions.edit') : t('actions.upload')}
            </Button>
            <Button
              size="small"
              variant="text"
              startIcon={<LinkIcon />}
              onClick={() => setUrlMode(!urlMode)}
            >
              {urlMode ? t('actions.close') : t('common.orEnterUrl')}
            </Button>
            <Button size="small" onClick={() => setPickerOpen(true)} sx={{ whiteSpace: 'nowrap' }}>
              {t('mediaLibrary.select')}
            </Button>
          </Stack>

          {urlMode && (
            <TextField
              label={t('mediaLibrary.url')}
              size="small"
              fullWidth
              value={trimmed.startsWith('data:') ? '' : trimmed}
              onChange={(event) => onChange(event.target.value)}
              placeholder="https://example.com/image.jpg or Telegram file_id"
            />
          )}
        </Stack>
      </Box>
      {action}
      <MediaPicker
        botId={botId}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(picked) => {
          onChange(picked);
          setUrlMode(false);
        }}
      />
    </Box>
  );
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
  botId: string;
  label: string;
  value: string;
  onChange: (value: unknown) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        alignItems: 'center',
      }}
    >
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
  action,
}: {
  botId: string;
  field: ConfigField;
  value: string;
  helpAdornment?: React.ReactElement;
  onChange: (value: unknown) => void;
  action?: React.ReactElement;
}): React.ReactElement {
  const { t } = useTranslation();
  const [translateOpen, setTranslateOpen] = useState(false);
  const multiline = field.type === 'textarea';
  return (
    <Box>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'center',
        }}
      >
        <Box sx={{ flexGrow: 1 }}>
          <TextField
            size="small"
            fullWidth
            label={field.label}
            multiline={multiline}
            minRows={multiline ? 3 : undefined}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            slotProps={{
              input: helpAdornment ? { endAdornment: helpAdornment } : undefined,
            }}
          />
        </Box>
        {action}
      </Stack>
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
