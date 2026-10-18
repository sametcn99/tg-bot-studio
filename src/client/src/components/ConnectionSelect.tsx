import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Chip,
  InputAdornment,
  IconButton,
  Link,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useTranslation } from 'react-i18next';
import { useBots } from '../context/BotContext';
import { useConnections, connectionsRoute } from '../context/ConnectionsContext';

/** Sentinel menu value switching the picker into free-form id entry. */
const MANUAL_VALUE = '__manual__';

/**
 * Info alert pointing users at the Connections module when a target picker
 * has nothing to offer yet.
 * @param {object} props - Component props.
 * @param {string} [props.typeLabel] - Optional connection type label for a filtered empty state.
 * @param {boolean} [props.compact] - Removes the bottom margin for inline (dialog) usage.
 * @returns {React.ReactElement} The alert.
 */
export function NoConnectionsNotice({
  typeLabel,
  compact,
}: {
  typeLabel?: string;
  compact?: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeBot } = useBots();

  return (
    <Alert
      severity="info"
      sx={compact ? undefined : { mb: 2 }}
      action={
        <Button
          color="inherit"
          size="small"
          onClick={() => activeBot && navigate(connectionsRoute(activeBot.id))}
        >
          {t('connections.manage')}
        </Button>
      }
    >
      {typeLabel ? t('connections.noneOfType', { type: typeLabel }) : t('connections.noneYet')}
    </Alert>
  );
}

/**
 * Shared option list builder: connections filtered by type, with any current
 * values that are not connected appended as manual options so legacy ids
 * stay visible.
 * @param {import('../context/ConnectionsContext').ChatConnection[]} connections - Full list.
 * @param {string[] | undefined} types - Optional type filter.
 * @param {string[]} currentValues - Currently selected chat ids.
 * @returns {Array<{value: string; label: string}>} Menu options.
 */
function buildOptions(
  connections: Array<{ chat_id?: string; chatId?: string; title: string; type: string }>,
  types: string[] | undefined,
  currentValues: string[],
): Array<{ value: string; label: string }> {
  const pool = types?.length ? connections.filter((row) => types.includes(row.type)) : connections;
  const options = pool.map((row) => {
    const id = String(row.chat_id ?? row.chatId ?? '');
    return {
      value: id,
      label: `${row.title} · ${id}`,
    };
  });
  for (const value of currentValues) {
    if (value && !options.some((option) => option.value === value)) {
      options.unshift({ value, label: `${value} (manual)` });
    }
  }
  return options;
}

/**
 * Computes whether the filtered connection pool is empty (post-loading).
 * @param {boolean} loading - Connections loading flag.
 * @param {import('../context/ConnectionsContext').ChatConnection[]} connections - Full list.
 * @param {string[] | undefined} types - Optional type filter.
 * @returns {boolean} True when no usable connection matches.
 */
function isPoolEmpty(
  loading: boolean,
  connections: Array<{ type: string }>,
  types: string[] | undefined,
): boolean {
  if (loading) return false;
  return (
    (types?.length ? connections.filter((row) => types.includes(row.type)) : connections).length ===
    0
  );
}

/**
 * Optional help tooltip rendered as an end adornment.
 * @param {string | undefined} helperText - Tooltip content.
 * @param {string} ariaLabel - Localized accessible label for the help button.
 * @returns {React.ReactElement | undefined} The adornment.
 */
function helpAdornmentFor(
  helperText: string | undefined,
  ariaLabel: string,
): React.ReactElement | undefined {
  return helperText ? (
    <InputAdornment position="end">
      <Tooltip title={helperText}>
        <IconButton size="small" aria-label={ariaLabel} edge="end">
          <InfoOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </InputAdornment>
  ) : undefined;
}

/**
 * Target-chat picker backed by the Connections module: renders a dropdown of
 * connected groups/channels, falls back to a manual id field plus a redirect
 * notice when nothing suitable is connected.
 * @param {object} props - Component props.
 * @param {string} props.label - Field label.
 * @param {string} props.value - Current chat id value.
 * @param {(value: string) => void} props.onChange - Emits the picked or typed chat id.
 * @param {string[]} [props.types] - Connection type filter (channel/group/supergroup).
 * @param {string} [props.helperText] - Helper text under the field.
 * @param {boolean} [props.disabled] - Disables the picker.
 * @returns {React.ReactElement} The picker.
 */
export function ConnectionSelect({
  label,
  value,
  onChange,
  types,
  helperText,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  types?: string[];
  helperText?: string;
  disabled?: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { connections, loading } = useConnections();
  const [manual, setManual] = useState(false);

  const currentValue = String(value ?? '');
  const options = useMemo(
    () => buildOptions(connections, types, currentValue ? [currentValue] : []),
    [connections, types, currentValue],
  );
  const poolEmpty = isPoolEmpty(loading, connections, types);
  const adornment = helpAdornmentFor(helperText, t('common.help'));

  if (poolEmpty || manual) {
    return (
      <Stack spacing={1}>
        {poolEmpty && <NoConnectionsNotice compact typeLabel={typesToLabel(types)} />}
        <TextField
          label={label}
          size="small"
          fullWidth
          disabled={disabled}
          placeholder="-1001234567890 or @username"
          value={currentValue}
          onChange={(event) => onChange(event.target.value.trim())}
          helperText={
            manual
              ? `${helperText ? `${helperText} ` : ''}${t('connections.manualEntry')}`.trim()
              : helperText
          }
          slotProps={adornment ? { input: { endAdornment: adornment } } : undefined}
        />
        {manual && !poolEmpty && (
          <Link
            component="button"
            type="button"
            variant="body2"
            onClick={() => setManual(false)}
            sx={{ alignSelf: 'flex-start' }}
          >
            {t('connections.backToSelect')}
          </Link>
        )}
      </Stack>
    );
  }

  return (
    <TextField
      select
      label={label}
      size="small"
      fullWidth
      disabled={disabled}
      value={options.some((option) => option.value === currentValue) ? currentValue : ''}
      onChange={(event) => {
        if (event.target.value === MANUAL_VALUE) {
          setManual(true);
          onChange('');
        } else {
          onChange(event.target.value);
        }
      }}
      slotProps={adornment ? { input: { endAdornment: adornment } } : undefined}
    >
      {loading ? (
        <MenuItem disabled>{t('common.loading')}</MenuItem>
      ) : (
        <>
          {options.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
          <MenuItem value={MANUAL_VALUE} divider>
            {t('connections.manualOption')}
          </MenuItem>
        </>
      )}
    </TextField>
  );
}

/**
 * Multi-select variant of the target-chat picker storing an array of chat
 * ids (giveaway required channels). Falls back to a comma-separated manual
 * field plus a redirect notice when nothing is connected.
 * @param {object} props - Component props.
 * @param {string} props.label - Field label.
 * @param {string[]} props.value - Currently selected chat ids.
 * @param {(value: string[]) => void} props.onChange - Emits the picked chat ids.
 * @param {string[]} [props.types] - Connection type filter.
 * @param {string} [props.helperText] - Helper text under the field.
 * @returns {React.ReactElement} The picker.
 */
export function ConnectionMultiSelect({
  label,
  value,
  onChange,
  types,
  helperText,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  types?: string[];
  helperText?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { connections, loading } = useConnections();
  const currentValue = useMemo(() => (Array.isArray(value) ? value.map(String) : []), [value]);

  const options = useMemo(
    () => buildOptions(connections, types, currentValue),
    [connections, types, currentValue],
  );
  const optionByValue = new Map(options.map((option) => [option.value, option]));
  const poolEmpty = isPoolEmpty(loading, connections, types);

  if (poolEmpty) {
    return (
      <Stack spacing={1}>
        <NoConnectionsNotice compact typeLabel={typesToLabel(types)} />
        <TextField
          label={label}
          size="small"
          fullWidth
          placeholder="-1001234567890, @channel (comma separated)"
          value={currentValue.join(', ')}
          onChange={(event) =>
            onChange(
              event.target.value
                .split(',')
                .map((entry) => entry.trim())
                .filter(Boolean),
            )
          }
          helperText={helperText}
        />
      </Stack>
    );
  }

  return (
    <TextField
      select
      label={label}
      size="small"
      fullWidth
      value={currentValue}
      onChange={(event) => onChange((event.target.value as unknown as string[]).map(String))}
      helperText={helperText}
      slotProps={{
        select: {
          multiple: true,
          renderValue: (selected) => (
            <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {(selected as string[]).map((chatId) => (
                <Chip
                  key={chatId}
                  size="small"
                  label={optionByValue.get(chatId)?.label ?? chatId}
                />
              ))}
            </Stack>
          ),
        },
      }}
    >
      {loading ? (
        <MenuItem disabled>{t('common.loading')}</MenuItem>
      ) : (
        options.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))
      )}
    </TextField>
  );
}

/**
 * Humanizes a connection type filter for empty-state messages.
 * @param {string[] | undefined} types - Filtered types.
 * @returns {string | undefined} Label such as `channel`.
 */
function typesToLabel(types: string[] | undefined): string | undefined {
  return types?.length ? types.join(' / ') : undefined;
}
