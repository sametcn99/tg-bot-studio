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
import { useTranslation } from 'react-i18next';
import { ConnectionSelect, ConnectionMultiSelect } from './ConnectionSelect';
import MediaPicker from './MediaPicker';
import MediaUploadField from './MediaUploadField';
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
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ flexGrow: 1 }}>
          <MediaUploadField
            botId={botId}
            label={field.label}
            help={field.help}
            value={String(value ?? '')}
            onChange={(next) => onChange(next)}
          />
        </Box>
        {action}
      </Stack>
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
