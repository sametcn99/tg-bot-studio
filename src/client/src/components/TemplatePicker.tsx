import React, { useMemo, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import { useTranslation } from 'react-i18next';
import {
  CONTENT_TEMPLATES,
  pickText,
  type ContentTemplate,
  type ContentTemplateKind,
  type ContentTemplateLang,
  type LocalText,
} from '../registry/templates';

/**
 * Checks whether a payload value is a bilingual `LocalText` pair.
 * @param {unknown} value - Payload value to inspect.
 * @returns {boolean} True when the value carries `en`/`tr` strings.
 */
function isLocalText(value: unknown): value is LocalText {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as LocalText).en === 'string' &&
    typeof (value as LocalText).tr === 'string'
  );
}

/**
 * Recursively resolves every `LocalText` leaf of a template payload to a
 * plain string for the active language, so callers receive field-ready
 * values (drip step arrays with plain texts, plain response strings, and
 * keyboard JSON untouched).
 * @param {unknown} value - Raw template payload.
 * @param {ContentTemplateLang} lang - Active language.
 * @returns {unknown} Payload with all bilingual strings resolved.
 */
function resolveTemplatePayload(value: unknown, lang: ContentTemplateLang): unknown {
  if (isLocalText(value)) return pickText(value, lang);
  if (Array.isArray(value)) return value.map((item) => resolveTemplatePayload(item, lang));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        resolveTemplatePayload(item, lang),
      ]),
    );
  }
  return value;
}

/**
 * "Use template" helper: opens a dialog listing curated content templates
 * matching the field kind and module, and hands a language-resolved payload
 * to the caller for seeding a form field. The operator can still edit
 * everything before saving.
 * @param {object} props - Component props.
 * @param {string} props.moduleKey - Module registry key to match templates for.
 * @param {ContentTemplateKind} props.kind - Template kind to list.
 * @param {(payload: unknown) => void} props.onPick - Receives the resolved payload.
 * @returns {React.ReactElement} The picker button + dialog.
 */
export default function TemplatePicker({
  moduleKey,
  kind,
  onPick,
}: {
  moduleKey: string;
  kind: ContentTemplateKind;
  onPick: (payload: unknown) => void;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const lang: ContentTemplateLang = i18n.language?.startsWith('tr') ? 'tr' : 'en';

  /** Templates matching the requested kind and module, narrowed by search. */
  const templates = useMemo(() => {
    const query = search.trim().toLowerCase();
    return CONTENT_TEMPLATES.filter(
      (template) =>
        template.kind === kind &&
        template.moduleKeys.includes(moduleKey) &&
        (!query ||
          pickText(template.name, lang).toLowerCase().includes(query) ||
          pickText(template.description, lang).toLowerCase().includes(query)),
    );
  }, [kind, moduleKey, search, lang]);

  /**
   * Hands the language-resolved payload to the caller and closes the dialog.
   * @param {ContentTemplate} template - Picked template.
   * @returns {void}
   */
  function pick(template: ContentTemplate): void {
    onPick(resolveTemplatePayload(template.payload, lang));
    setOpen(false);
    setSearch('');
  }

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<DashboardCustomizeIcon fontSize="small" />}
        onClick={() => setOpen(true)}
        sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
      >
        {t('templates.use')}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="xs"
        fullWidth
        aria-labelledby="template-picker-title"
      >
        <DialogTitle id="template-picker-title">{t('templates.title')}</DialogTitle>
        <DialogContent>
          <TextField
            label={t('common.search')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            size="small"
            fullWidth
            sx={{ mb: 1 }}
          />
          {templates.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              {t('templates.empty')}
            </Typography>
          ) : (
            <List disablePadding>
              {templates.map((template) => (
                <ListItemButton
                  key={template.id}
                  onClick={() => pick(template)}
                  sx={{ borderRadius: 1, mb: 0.5 }}
                >
                  <ListItemText
                    primary={pickText(template.name, lang)}
                    secondary={pickText(template.description, lang)}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{t('actions.close')}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
