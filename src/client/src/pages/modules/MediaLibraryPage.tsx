import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../services/api';
import PageHeader from '../../components/PageHeader';
import { useModuleDocs } from '../../context/ModuleDocsContext';
import ConfirmDialog from '../../components/ConfirmDialog';
import MediaPicker from '../../components/MediaPicker';
import type { ModuleEntry } from '../../registry/modules';
import { localizedErrorMessage } from '../../utils/errors';
import { formatDateTime } from '../../utils/format';

/** Library asset row as returned by the API. */
interface MediaAsset {
  id: number;
  name: string;
  source: string;
  value: string;
  kind: string;
  tags: string | null;
  createdAt: string | null;
}

/**
 * Shared Media Library page: reusable URL and Telegram file_id assets picked
 * by every media-capable composer (welcome, broadcast, drip, flows, autoresponder).
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {ModuleEntry} props.module - Media library catalog entry.
 * @returns {React.ReactElement} The page.
 */
export default function MediaLibraryPage({
  botId,
  module,
}: {
  botId: number;
  module: ModuleEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  const { openDocs } = useModuleDocs();
  const [assets, setAssets] = useState<MediaAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId]);

  /**
   * Reloads the library.
   * @returns {void}
   */
  function reload(): void {
    apiFetch<MediaAsset[]>(`/api/bots/${botId}/media`)
      .then(setAssets)
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }

  /**
   * Removes an asset after confirmation.
   * @returns {void}
   */
  function confirmDelete(): void {
    if (deleteId === null) return;
    apiFetch(`/api/bots/${botId}/media/${deleteId}`, { method: 'DELETE' })
      .then(() => {
        setDeleteId(null);
        reload();
      })
      .catch((err: Error) => setError(localizedErrorMessage(err)));
  }

  return (
    <Box>
      <PageHeader
        title={module.name}
        subtitle={module.description}
        onDocs={() => openDocs(module)}
        actions={
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setPickerOpen(true)}
          >
            {t('mediaLibrary.addAsset')}
          </Button>
        }
      />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Card>
        <CardContent>
          <Stack spacing={1}>
            {(assets ?? []).map((asset) => (
              <Stack
                key={asset.id}
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                spacing={1}
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  px: 1.5,
                  py: 1,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Typography variant="body2" fontWeight={600}>
                      {asset.name}
                    </Typography>
                    <Chip size="small" label={asset.kind} />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={asset.source === 'url' ? 'URL' : 'file_id'}
                    />
                    {asset.tags
                      ? asset.tags
                          .split(',')
                          .filter(Boolean)
                          .map((tag) => <Chip key={tag} size="small" label={tag.trim()} />)
                      : null}
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
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="caption" color="text.secondary">
                    {formatDateTime(asset.createdAt)}
                  </Typography>
                  <IconButton size="small" color="error" onClick={() => setDeleteId(asset.id)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Stack>
            ))}
            {assets !== null && assets.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                {t('mediaLibrary.empty')}
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>

      <MediaPicker
        botId={botId}
        open={pickerOpen}
        onClose={() => {
          setPickerOpen(false);
          reload();
        }}
        onSelect={() => undefined}
      />
      <ConfirmDialog
        open={deleteId !== null}
        title={t('mediaLibrary.deleteTitle')}
        message={t('mediaLibrary.deleteMessage')}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </Box>
  );
}
