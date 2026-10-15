import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../services/api';
import { localizedErrorMessage } from '../utils/errors';

/** Library asset row as returned by the API. */
export interface MediaAssetRow {
  id: number;
  name: string;
  source: string;
  value: string;
  kind: string;
  tags: string | null;
}

/** Media kinds the library accepts. */
const KINDS = [
  'photo',
  'video',
  'animation',
  'audio',
  'voice',
  'video_note',
  'document',
  'sticker',
];

/**
 * Reusable media library picker: lists saved assets, lets the operator add
 * a new URL/file_id asset inline, and hands the selected value back to the
 * calling form field.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {boolean} props.open - Dialog open state.
 * @param {() => void} props.onClose - Close callback.
 * @param {(value: string, kind: string) => void} props.onSelect - Pick callback.
 * @returns {React.ReactElement} The picker dialog.
 */
export default function MediaPicker({
  botId,
  open,
  onClose,
  onSelect,
}: {
  botId: number;
  open: boolean;
  onClose: () => void;
  onSelect: (value: string, kind: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [assets, setAssets] = useState<MediaAssetRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [source, setSource] = useState('url');
  const [value, setValue] = useState('');
  const [kind, setKind] = useState('photo');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAssets(null);
    setError(null);
    apiFetch<MediaAssetRow[]>(`/api/bots/${botId}/media`)
      .then(setAssets)
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }, [open, botId]);

  /**
   * Persists a new asset and refreshes the list.
   * @returns {void}
   */
  function createAsset(): void {
    setError(null);
    apiFetch<MediaAssetRow>(`/api/bots/${botId}/media`, {
      method: 'POST',
      body: JSON.stringify({ name, source, value, kind, tags: tags || undefined }),
    })
      .then((created) => {
        setAssets((current) => [created, ...(current ?? [])]);
        setName('');
        setValue('');
        setTags('');
        setAdding(false);
      })
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {t('mediaLibrary.pickerTitle')}
        <IconButton size="small" onClick={onClose} aria-label={t('actions.close')}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {error && (
          <Typography color="error" variant="body2" sx={{ mb: 1 }}>
            {error}
          </Typography>
        )}
        {!adding && (
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => setAdding(true)}
            sx={{ mb: 1.5 }}
          >
            {t('mediaLibrary.addAsset')}
          </Button>
        )}
        {adding && (
          <Stack spacing={1.5} sx={{ mb: 2 }}>
            <TextField
              size="small"
              label={t('mediaLibrary.name')}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Stack direction="row" spacing={1.5}>
              <TextField
                select
                size="small"
                sx={{ width: 140 }}
                label={t('mediaLibrary.source')}
                value={source}
                onChange={(event) => setSource(event.target.value)}
              >
                <MenuItem value="url">{t('mediaLibrary.sourceUrl')}</MenuItem>
                <MenuItem value="file_id">{t('mediaLibrary.sourceFileId')}</MenuItem>
              </TextField>
              <TextField
                select
                size="small"
                sx={{ width: 150 }}
                label={t('mediaLibrary.kind')}
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                {KINDS.map((entry) => (
                  <MenuItem key={entry} value={entry}>
                    {entry}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            <TextField
              size="small"
              label={source === 'url' ? t('mediaLibrary.url') : t('mediaLibrary.fileId')}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            <TextField
              size="small"
              label={t('mediaLibrary.tags')}
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              helperText={t('mediaLibrary.tagsHelp')}
            />
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                size="small"
                onClick={createAsset}
                disabled={!name.trim() || !value.trim()}
              >
                {t('actions.save')}
              </Button>
              <Button size="small" onClick={() => setAdding(false)}>
                {t('actions.cancel')}
              </Button>
            </Stack>
          </Stack>
        )}

        <Stack spacing={1}>
          {(assets ?? []).map((asset) => (
            <Box
              key={asset.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                px: 1.5,
                py: 1,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Typography variant="body2" fontWeight={600} noWrap>
                    {asset.name}
                  </Typography>
                  <Chip size="small" label={asset.kind} />
                </Stack>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ display: 'block' }}
                  title={asset.value}
                >
                  {asset.value}
                </Typography>
              </Box>
              <Button
                size="small"
                startIcon={<CheckIcon />}
                onClick={() => {
                  onSelect(asset.value, asset.kind);
                  onClose();
                }}
              >
                {t('mediaLibrary.select')}
              </Button>
            </Box>
          ))}
          {assets !== null && assets.length === 0 && !adding && (
            <Typography variant="body2" color="text.secondary">
              {t('common.empty')}
            </Typography>
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
