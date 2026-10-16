import React, { useState } from 'react';
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import { useSnackbar } from '../context/SnackbarContext';
import { localizedErrorMessage } from '../utils/errors';

/** Kinds whose result is a JSON document (array or object). */
const JSON_KINDS = new Set(['autoresponder', 'drip-steps', 'buttons']);

/**
 * Strips markdown fences and extracts the JSON payload from a raw model
 * reply. Returns the trimmed raw text for plain-text kinds.
 * @param {string} raw - Model output.
 * @param {string} kind - Generation kind.
 * @returns {string} Cleaned payload ready for a form field.
 */
export function cleanGenerated(raw: string, kind: string): string {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  if (!JSON_KINDS.has(kind)) return text;
  const start = text.search(/[[{]/);
  if (start === -1) return text;
  const openChar = text[start];
  const closeChar = openChar === '[' ? ']' : '}';
  const end = text.lastIndexOf(closeChar);
  if (end > start) return text.slice(start, end + 1);
  return text;
}

/**
 * "✨ Create with AI" helper: opens a brief dialog, calls the bot's AI
 * provider through the studio generate endpoint, and hands the cleaned
 * result to the caller for filling a form field. The operator always gets
 * to edit the generated content before saving.
 * @param {object} props - Component props.
 * @param {number | string} props.botId - Active bot id.
 * @param {string} props.kind - Generation kind (autoresponder, drip-steps, buttons, broadcast).
 * @param {(value: string) => void} props.onResult - Receives the cleaned payload.
 * @returns {React.ReactElement} The sparkle button + dialog.
 */
export default function AiGenerateButton({
  botId,
  kind,
  onResult,
}: {
  botId: number | string;
  kind: string;
  onResult: (value: string) => void;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { showError } = useSnackbar();
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);

  const generate = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await apiFetch<{ result: string }>(`/api/bots/${botId}/ai-assistant/generate`, {
        method: 'POST',
        body: JSON.stringify({
          kind,
          prompt: brief.trim(),
          locale: i18n.language?.startsWith('tr') ? 'tr' : 'en',
        }),
      });
      onResult(cleanGenerated(res.result, kind));
      setOpen(false);
      setBrief('');
    } catch (err: unknown) {
      showError(localizedErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Tooltip title={t('aiGenerate.button')}>
        <Button
          size="small"
          variant="outlined"
          color="secondary"
          startIcon={<AutoAwesomeIcon fontSize="small" />}
          onClick={() => setOpen(true)}
          sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
        >
          {t('aiGenerate.button')}
        </Button>
      </Tooltip>
      <Dialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        maxWidth="xs"
        fullWidth
        aria-labelledby="ai-generate-title"
      >
        <DialogTitle id="ai-generate-title">{t('aiGenerate.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography
              variant="body2"
              sx={{
                color: 'text.secondary',
              }}
            >
              {t('aiGenerate.hint')}
            </Typography>
            <TextField
              label={t('aiGenerate.briefLabel')}
              placeholder={t('aiGenerate.briefPlaceholder')}
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              fullWidth
              multiline
              minRows={3}
              autoFocus
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>
            {t('actions.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={() => void generate()}
            disabled={busy}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />}
          >
            {busy ? t('aiGenerate.generating') : t('aiGenerate.generate')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
