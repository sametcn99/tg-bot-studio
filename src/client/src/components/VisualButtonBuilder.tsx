import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  IconButton,
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
import { useTranslation } from 'react-i18next';

export interface TelegramButtonItem {
  text: string;
  url: string;
}

interface VisualButtonBuilderProps {
  value: string;
  onChange: (jsonValue: string) => void;
  label?: string;
  helperText?: string;
}

/**
 * Visual Inline Buttons Builder with real-time Telegram preview
 * and bidirectional sync between visual cards and raw JSON.
 */
export default function VisualButtonBuilder({
  value,
  onChange,
  label,
  helperText,
}: VisualButtonBuilderProps): React.ReactElement {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'visual' | 'json'>('visual');
  const [buttons, setButtons] = useState<TelegramButtonItem[]>([]);
  const [jsonText, setJsonText] = useState(value || '');
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Parse external value into structured list on change
  useEffect(() => {
    setJsonText(value || '');
    if (!value || !value.trim()) {
      setButtons([]);
      setJsonError(null);
      return;
    }
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        // Flat array of buttons: [{ text, url }]
        const flat: TelegramButtonItem[] = parsed.map((item: Record<string, unknown>) => ({
          text: String(item.text ?? item.title ?? 'Button'),
          url: String(item.url ?? 'https://'),
        }));
        setButtons(flat);
        setJsonError(null);
      }
    } catch {
      // Keep raw string in jsonText if malformed
      setJsonError('Invalid JSON format');
    }
  }, [value]);

  const updateButtons = (next: TelegramButtonItem[]) => {
    setButtons(next);
    const jsonStr = next.length > 0 ? JSON.stringify(next, null, 2) : '';
    setJsonText(jsonStr);
    setJsonError(null);
    onChange(jsonStr);
  };

  const addButton = () => {
    updateButtons([...buttons, { text: 'Click Here', url: 'https://' }]);
  };

  const removeButton = (index: number) => {
    updateButtons(buttons.filter((_, idx) => idx !== index));
  };

  const updateField = (index: number, field: 'text' | 'url', val: string) => {
    const next = [...buttons];
    next[index] = { ...next[index], [field]: val };
    updateButtons(next);
  };

  const handleJsonBlur = (val: string) => {
    setJsonText(val);
    if (!val.trim()) {
      setButtons([]);
      setJsonError(null);
      onChange('');
      return;
    }
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) {
        const flat: TelegramButtonItem[] = parsed.map((item: Record<string, unknown>) => ({
          text: String(item.text ?? 'Button'),
          url: String(item.url ?? 'https://'),
        }));
        setButtons(flat);
        setJsonError(null);
        onChange(val);
      } else {
        setJsonError('Buttons must be a JSON array of objects');
      }
    } catch {
      setJsonError('Invalid JSON');
    }
  };

  const addPreset = (text: string, url: string) => {
    updateButtons([...buttons, { text, url }]);
  };

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2, bgcolor: 'background.paper' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2" fontWeight={600}>
          {label ?? t('buttons.builderTitle')}
        </Typography>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ minHeight: 32, '& .MuiTab-root': { minHeight: 32, py: 0.5, px: 1.5, fontSize: '0.75rem' } }}
        >
          <Tab icon={<ViewModuleIcon sx={{ fontSize: 16 }} />} iconPosition="start" label={t('buttons.visualMode')} value="visual" />
          <Tab icon={<CodeIcon sx={{ fontSize: 16 }} />} iconPosition="start" label={t('buttons.jsonMode')} value="json" />
        </Tabs>
      </Stack>

      {tab === 'visual' ? (
        <Stack spacing={2}>
          {/* Preset Suggestions */}
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', mr: 0.5 }}>
              Presets:
            </Typography>
            <Chip size="small" label="🌐 Website" variant="outlined" onClick={() => addPreset('Visit Website', 'https://example.com')} />
            <Chip size="small" label="📢 Channel" variant="outlined" onClick={() => addPreset('Join Channel', 'https://t.me/example')} />
            <Chip size="small" label="💬 Support" variant="outlined" onClick={() => addPreset('Contact Support', 'https://t.me/support_bot')} />
          </Stack>

          {/* List of buttons */}
          {buttons.map((btn, idx) => (
            <Paper
              key={idx}
              variant="outlined"
              sx={{
                p: 1.5,
                bgcolor: 'background.default',
                borderRadius: 1.5,
                display: 'flex',
                gap: 1.5,
                alignItems: 'center',
              }}
            >
              <TextField
                label={t('buttons.text')}
                size="small"
                value={btn.text}
                onChange={(e) => updateField(idx, 'text', e.target.value)}
                sx={{ flex: 1 }}
              />
              <TextField
                label={t('buttons.url')}
                size="small"
                value={btn.url}
                onChange={(e) => updateField(idx, 'url', e.target.value)}
                sx={{ flex: 2 }}
                placeholder="https://..."
              />
              <Tooltip title={t('actions.delete')}>
                <IconButton size="small" color="error" onClick={() => removeButton(idx)} aria-label="Delete button">
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Paper>
          ))}

          <Button
            variant="outlined"
            size="small"
            startIcon={<AddIcon />}
            onClick={addButton}
            sx={{ alignSelf: 'flex-start' }}
          >
            {t('buttons.addButton')}
          </Button>

          {/* Telegram-style Preview of buttons */}
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
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontWeight: 600 }}>
                {t('buttons.preview')}
              </Typography>
              <Stack spacing={0.75}>
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
                    }}
                  >
                    {btn.text || 'Button'}
                    <OpenInNewIcon sx={{ fontSize: 13, opacity: 0.8 }} />
                  </Box>
                ))}
              </Stack>
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
            helperText={jsonError ?? helperText ?? '[{"text":"Open","url":"https://..."}]'}
          />
        </Stack>
      )}
    </Box>
  );
}
