import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import { useSnackbar } from '../context/SnackbarContext';
import { localizedErrorMessage } from '../utils/errors';

/** The 14 bot languages with display labels. */
const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ru', label: 'Русский' },
  { code: 'es', label: 'Español' },
  { code: 'az', label: 'Azərbaycan' },
  { code: 'ar', label: 'العربية' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
  { code: 'uk', label: 'Українська' },
  { code: 'fa', label: 'فارسی' },
  { code: 'id', label: 'Indonesia' },
  { code: 'uz', label: 'Oʻzbek' },
];

/**
 * AI translation dialog: translates one studio text into any subset of the
 * 14 supported bot languages and applies the picked translation to the
 * calling field.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {boolean} props.open - Dialog open state.
 * @param {string} props.text - Source text to translate.
 * @param {() => void} props.onClose - Close callback.
 * @param {(text: string) => void} props.onApply - Applies a translation.
 * @returns {React.ReactElement} The dialog.
 */
export default function AiTranslateDialog({
  botId,
  open,
  text,
  onClose,
  onApply,
}: {
  botId: string;
  open: boolean;
  text: string;
  onClose: () => void;
  onApply: (text: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [selected, setSelected] = useState<string[]>(LANGUAGES.map((language) => language.code));
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setResults({});
      setApplied(null);
    }
  }, [open, text]);

  const canTranslate = useMemo(
    () => text.trim().length > 0 && selected.length > 0 && !busy,
    [text, selected, busy],
  );

  /**
   * Calls the translation endpoint.
   * @returns {Promise<void>} Resolves after results are stored.
   */
  async function translate(): Promise<void> {
    setBusy(true);
    setResults({});
    try {
      const response = await apiFetch<{
        translations: Record<string, Record<string, string>>;
      }>(`/api/bots/${botId}/ai-assistant/translate`, {
        method: 'POST',
        body: JSON.stringify({ texts: { source: text }, targetLanguages: selected }),
      });
      setResults(response.translations?.source ?? {});
    } catch (err) {
      showError(localizedErrorMessage(err as Error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('translate.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Box>
            <Typography
              variant="caption"
              sx={{
                color: 'text.secondary',
              }}
            >
              {t('translate.source')}
            </Typography>
            <Box
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                p: 1.25,
                maxHeight: 140,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {text || t('translate.emptySource')}
            </Box>
          </Box>

          <Box>
            <Typography
              variant="caption"
              sx={{
                color: 'text.secondary',
                display: 'block',
                mb: 0.5,
              }}
            >
              {t('translate.targetLanguages')}
            </Typography>
            <ToggleButtonGroup
              size="small"
              value={selected}
              onChange={(_, value: string[]) => setSelected(value.length > 0 ? value : selected)}
              sx={{ flexWrap: 'wrap', gap: 0.5 }}
            >
              {LANGUAGES.map((language) => (
                <ToggleButton
                  key={language.code}
                  value={language.code}
                  sx={{ px: 1, py: 0.25, textTransform: 'none' }}
                >
                  {language.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>

          {busy && (
            <Stack
              direction="row"
              spacing={1}
              sx={{
                alignItems: 'center',
              }}
            >
              <CircularProgress size={18} />
              <Typography
                variant="body2"
                sx={{
                  color: 'text.secondary',
                }}
              >
                {t('translate.working')}
              </Typography>
            </Stack>
          )}

          {Object.keys(results).length > 0 && (
            <Stack spacing={1}>
              {LANGUAGES.filter((language) => results[language.code]).map((language) => (
                <Box
                  key={language.code}
                  sx={{
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    p: 1.25,
                  }}
                >
                  <Stack
                    direction="row"
                    sx={{
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      mb: 0.5,
                    }}
                  >
                    <Chip size="small" label={language.label} />
                    <Stack direction="row" spacing={0.5}>
                      <Button
                        size="small"
                        startIcon={<ContentCopyIcon />}
                        onClick={() => {
                          void navigator.clipboard.writeText(results[language.code]);
                          showSuccess(t('translate.copied'));
                        }}
                      >
                        {t('translate.copy')}
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={applied === language.code ? <CheckIcon /> : undefined}
                        onClick={() => {
                          onApply(results[language.code]);
                          setApplied(language.code);
                        }}
                      >
                        {t('translate.apply')}
                      </Button>
                    </Stack>
                  </Stack>
                  <Box sx={{ whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>
                    {results[language.code]}
                  </Box>
                </Box>
              ))}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.close')}</Button>
        <Button variant="contained" onClick={() => void translate()} disabled={!canTranslate}>
          {t('translate.run')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
