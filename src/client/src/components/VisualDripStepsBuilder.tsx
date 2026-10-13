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
import TimelineIcon from '@mui/icons-material/Timeline';
import CodeIcon from '@mui/icons-material/Code';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { useTranslation } from 'react-i18next';

export interface DripStepItem {
  delayMinutes: number;
  text: string;
}

interface VisualDripStepsBuilderProps {
  value: string;
  onChange: (jsonValue: string) => void;
  label?: string;
  helperText?: string;
}

/**
 * Visual Drip Sequence Timeline Builder with delay duration presets and step cards.
 */
export default function VisualDripStepsBuilder({
  value,
  onChange,
  label,
  helperText,
}: VisualDripStepsBuilderProps): React.ReactElement {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'visual' | 'json'>('visual');
  const [steps, setSteps] = useState<DripStepItem[]>([]);
  const [jsonText, setJsonText] = useState(value || '');
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    setJsonText(value || '');
    if (!value || !value.trim()) {
      setSteps([]);
      setJsonError(null);
      return;
    }
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        const items: DripStepItem[] = parsed.map((item: Record<string, unknown>) => ({
          delayMinutes: Number(item.delayMinutes ?? 60),
          text: String(item.text ?? ''),
        }));
        setSteps(items);
        setJsonError(null);
      }
    } catch {
      setJsonError('Invalid JSON format');
    }
  }, [value]);

  const updateSteps = (next: DripStepItem[]) => {
    setSteps(next);
    const jsonStr = next.length > 0 ? JSON.stringify(next, null, 2) : '';
    setJsonText(jsonStr);
    setJsonError(null);
    onChange(jsonStr);
  };

  const addStep = (delayMinutes = 60, text = 'Hello {first_name}!') => {
    updateSteps([...steps, { delayMinutes, text }]);
  };

  const removeStep = (index: number) => {
    updateSteps(steps.filter((_, idx) => idx !== index));
  };

  const updateField = (index: number, field: keyof DripStepItem, val: unknown) => {
    const next = [...steps];
    next[index] = { ...next[index], [field]: val };
    updateSteps(next);
  };

  const formatDelay = (minutes: number): string => {
    if (minutes < 60) return `${minutes} min`;
    if (minutes < 1440) return `${Math.round(minutes / 60)} hour(s)`;
    return `${Math.round(minutes / 1440)} day(s)`;
  };

  const handleJsonBlur = (val: string) => {
    setJsonText(val);
    if (!val.trim()) {
      setSteps([]);
      setJsonError(null);
      onChange('');
      return;
    }
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) {
        const items: DripStepItem[] = parsed.map((item: Record<string, unknown>) => ({
          delayMinutes: Number(item.delayMinutes ?? 60),
          text: String(item.text ?? ''),
        }));
        setSteps(items);
        setJsonError(null);
        onChange(val);
      } else {
        setJsonError('Steps must be an array of objects with delayMinutes and text');
      }
    } catch {
      setJsonError('Invalid JSON');
    }
  };

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2, bgcolor: 'background.paper' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2" fontWeight={600}>
          {label ?? 'Drip Sequence Steps'}
        </Typography>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ minHeight: 32, '& .MuiTab-root': { minHeight: 32, py: 0.5, px: 1.5, fontSize: '0.75rem' } }}
        >
          <Tab icon={<TimelineIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="Visual Timeline" value="visual" />
          <Tab icon={<CodeIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="JSON" value="json" />
        </Tabs>
      </Stack>

      {tab === 'visual' ? (
        <Stack spacing={2}>
          {steps.map((step, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && (
                <Stack alignItems="center" spacing={0.5} sx={{ my: -1 }}>
                  <ArrowDownwardIcon sx={{ color: 'primary.main', fontSize: 18 }} />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`Wait ${formatDelay(step.delayMinutes)} after step ${idx}`}
                    sx={{ fontSize: '0.75rem' }}
                  />
                </Stack>
              )}
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  bgcolor: 'background.default',
                  borderRadius: 2,
                  borderLeft: '4px solid',
                  borderLeftColor: 'primary.main',
                }}
              >
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
                  <Typography variant="subtitle2" fontWeight={700}>
                    Step {idx + 1}
                  </Typography>
                  <Tooltip title={t('actions.delete')}>
                    <IconButton size="small" color="error" onClick={() => removeStep(idx)} aria-label="Delete step">
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>

                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <TextField
                      label="Delay (minutes after previous step)"
                      type="number"
                      size="small"
                      value={step.delayMinutes}
                      onChange={(e) => updateField(idx, 'delayMinutes', Number(e.target.value))}
                      sx={{ width: 220 }}
                    />
                    <Stack direction="row" spacing={0.5}>
                      <Chip size="small" label="15m" onClick={() => updateField(idx, 'delayMinutes', 15)} />
                      <Chip size="small" label="1h" onClick={() => updateField(idx, 'delayMinutes', 60)} />
                      <Chip size="small" label="24h" onClick={() => updateField(idx, 'delayMinutes', 1440)} />
                      <Chip size="small" label="3d" onClick={() => updateField(idx, 'delayMinutes', 4320)} />
                    </Stack>
                  </Stack>

                  <TextField
                    label="Message text"
                    size="small"
                    multiline
                    minRows={3}
                    fullWidth
                    value={step.text}
                    onChange={(e) => updateField(idx, 'text', e.target.value)}
                    helperText="Placeholders: {first_name}, {mention}, {date}, {time}"
                  />
                </Stack>
              </Paper>
            </React.Fragment>
          ))}

          <Button
            variant="outlined"
            size="small"
            startIcon={<AddIcon />}
            onClick={() => addStep(steps.length === 0 ? 0 : 1440)}
            sx={{ alignSelf: 'flex-start' }}
          >
            Add Next Step
          </Button>
        </Stack>
      ) : (
        <Stack spacing={1}>
          <TextField
            multiline
            minRows={5}
            size="small"
            fullWidth
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            onBlur={(e) => handleJsonBlur(e.target.value)}
            error={Boolean(jsonError)}
            helperText={jsonError ?? helperText ?? '[{"delayMinutes":60,"text":"Welcome {first_name}"}]'}
          />
        </Stack>
      )}
    </Box>
  );
}
