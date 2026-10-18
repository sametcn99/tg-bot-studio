import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ApplyIcon from '@mui/icons-material/CheckCircleOutlined';
import DownloadIcon from '@mui/icons-material/FileDownload';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { useTranslation } from 'react-i18next';
import { apiFetch, apiDownload } from '../services/api';
import { useSnackbar } from '../context/SnackbarContext';
import ConfirmDialog from './ConfirmDialog';
import { localizedErrorMessage } from '../utils/errors';
import { formatDateTime } from '../utils/format';

/** Template gallery row. */
interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  sourceBotName: string | null;
  createdAt: string | null;
  moduleCount: number;
  autoresponderCount: number;
  dripCount: number;
  miniAppCount: number;
}

/**
 * Template gallery dialog: saved full-bot configuration bundles with a
 * one-click apply to the active bot.
 * @param {object} props - Component props.
 * @param {number} props.botId - Target bot id for applies.
 * @param {boolean} props.open - Dialog open state.
 * @param {() => void} props.onClose - Close callback.
 * @param {() => void} props.onApplied - Called after a successful apply.
 * @returns {React.ReactElement} The dialog.
 */
export default function TemplateGalleryDialog({
  botId,
  open,
  onClose,
  onApplied,
}: {
  botId: string;
  open: boolean;
  onClose: () => void;
  onApplied?: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRows(null);
    setError(null);
    apiFetch<TemplateRow[]>('/api/templates')
      .then(setRows)
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }, [open]);

  /**
   * Applies a template to the bot after confirmation.
   * @returns {void}
   */
  function confirmApply(): void {
    if (applyingId === null) return;
    apiFetch<{ importedModules?: number }>(`/api/bots/${botId}/templates/${applyingId}/apply`, {
      method: 'POST',
    })
      .then((result) => {
        showSuccess(t('templates.applied', { count: result.importedModules ?? 0 }));
        setApplyingId(null);
        onApplied?.();
      })
      .catch((err: Error) => showError(localizedErrorMessage(err)));
  }

  /**
   * Downloads the raw bundle of a template.
   */
  function download(row: TemplateRow): void {
    apiDownload(`/api/templates/${row.id}/bundle`, `template_${row.name}.json`);
  }

  /**
   * Deletes a template after confirmation.
   * @returns {void}
   */
  function confirmDelete(): void {
    if (deleteId === null) return;
    apiFetch(`/api/templates/${deleteId}`, { method: 'DELETE' })
      .then(() => {
        setDeleteId(null);
        setRows((current) => (current ?? []).filter((row) => row.id !== deleteId));
      })
      .catch((err: Error) => showError(localizedErrorMessage(err)));
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {t('templates.galleryTitle')}
        <IconButton size="small" onClick={onClose} aria-label={t('actions.close')}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={1.5}>
          {(rows ?? []).map((row) => (
            <Box
              key={row.id}
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                p: 1.5,
              }}
            >
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 0.5,
                    }}
                  >
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 600,
                      }}
                    >
                      {row.name}
                    </Typography>
                    <Chip
                      size="small"
                      label={t('templates.moduleCount', { count: row.moduleCount })}
                    />
                    {row.autoresponderCount > 0 && (
                      <Chip size="small" variant="outlined" label={`↩ ${row.autoresponderCount}`} />
                    )}
                    {row.dripCount > 0 && (
                      <Chip size="small" variant="outlined" label={`💧 ${row.dripCount}`} />
                    )}
                    {row.miniAppCount > 0 && (
                      <Chip size="small" variant="outlined" label={`📱 ${row.miniAppCount}`} />
                    )}
                  </Stack>
                  {row.description && (
                    <Typography
                      variant="caption"
                      sx={{
                        color: 'text.secondary',
                        display: 'block',
                      }}
                    >
                      {row.description}
                    </Typography>
                  )}
                  <Typography
                    variant="caption"
                    sx={{
                      color: 'text.secondary',
                    }}
                  >
                    {row.sourceBotName ? `${row.sourceBotName} · ` : ''}
                    {formatDateTime(row.createdAt)}
                  </Typography>
                </Box>
                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{
                    alignItems: 'center',
                  }}
                >
                  <IconButton
                    size="small"
                    onClick={() => download(row)}
                    aria-label={t('bots.export')}
                  >
                    <DownloadIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" color="error" onClick={() => setDeleteId(row.id)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<ApplyIcon />}
                    onClick={() => setApplyingId(row.id)}
                  >
                    {t('templates.apply')}
                  </Button>
                </Stack>
              </Stack>
            </Box>
          ))}
          {rows !== null && rows.length === 0 && (
            <Typography
              variant="body2"
              sx={{
                color: 'text.secondary',
              }}
            >
              {t('templates.empty')}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.close')}</Button>
      </DialogActions>

      <ConfirmDialog
        open={applyingId !== null}
        title={t('templates.applyTitle')}
        message={t('templates.applyMessage')}
        onConfirm={confirmApply}
        onCancel={() => setApplyingId(null)}
      />
      <ConfirmDialog
        open={deleteId !== null}
        title={t('templates.deleteTitle')}
        message={t('templates.deleteMessage')}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </Dialog>
  );
}

/**
 * Save-as-template dialog: names the current bot's export bundle and stores
 * it in the gallery.
 * @param {object} props - Component props.
 * @param {number} props.botId - Source bot id.
 * @param {string} props.botName - Source bot display name.
 * @param {boolean} props.open - Dialog open state.
 * @param {() => void} props.onClose - Close callback.
 * @returns {React.ReactElement} The dialog.
 */
export function SaveTemplateDialog({
  botId,
  botName,
  open,
  onClose,
}: {
  botId: string;
  botName: string;
  open: boolean;
  onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  /**
   * Fetches the export bundle and stores it as a template.
   * @returns {void}
   */
  function save(): void {
    setBusy(true);
    apiFetch<Record<string, unknown>>(`/api/bots/${botId}/export`)
      .then((bundle) =>
        apiFetch('/api/templates', {
          method: 'POST',
          body: JSON.stringify({
            name: name.trim() || `${botName} template`,
            description: description.trim() || undefined,
            bundle,
            sourceBotName: botName,
          }),
        }),
      )
      .then(() => {
        showSuccess(t('templates.saved'));
        onClose();
      })
      .catch((err: Error) => showError(localizedErrorMessage(err)))
      .finally(() => setBusy(false));
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('templates.saveTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography
            variant="body2"
            sx={{
              color: 'text.secondary',
            }}
          >
            {t('templates.saveHint')}
          </Typography>
          <TextField
            size="small"
            label={t('templates.name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            fullWidth
          />
          <TextField
            size="small"
            label={t('templates.description')}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            multiline
            minRows={2}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.cancel')}</Button>
        <Button variant="contained" onClick={save} disabled={busy}>
          {t('templates.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
