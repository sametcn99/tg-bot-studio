import React, { useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import LinkIcon from '@mui/icons-material/Link';
import LibraryIcon from '@mui/icons-material/PhotoLibraryOutlined';
import { useTranslation } from 'react-i18next';
import MediaPicker from './MediaPicker';

/** Uploaded-media side fields used by CRUD forms that store bytes apart. */
export interface MediaUploadMeta {
  data: string | null;
  mime: string | null;
  fileName: string | null;
}

/**
 * Shared media field with byte upload: a drag-and-drop drop zone, inline
 * preview, clear action, optional URL / file_id input, and — when a botId is
 * given — the shared media library picker. Uploaded files travel inline as
 * data: URLs (sent by the server as raw Telegram InputFile bytes).
 * @param {object} props - Component props.
 * @param {string} props.label - Field label.
 * @param {string} [props.help] - Helper text under the label.
 * @param {string} props.value - Current value: data: URL, http(s) URL, or file_id.
 * @param {(value: string) => void} props.onChange - Value change callback.
 * @param {string} [props.botId] - Active bot id; enables the media library picker.
 * @param {MediaUploadMeta} [props.meta] - CRUD-form side fields (data/mime/fileName).
 * @param {(meta: MediaUploadMeta) => void} [props.onMetaChange] - Side-field updates.
 * @returns {React.ReactElement} The media field.
 */
export default function MediaUploadField({
  label,
  help,
  value,
  onChange,
  botId,
  meta,
  onMetaChange,
}: {
  label: string;
  help?: string;
  value: string;
  onChange: (value: string) => void;
  botId?: string;
  meta?: MediaUploadMeta;
  onMetaChange?: (meta: MediaUploadMeta) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [urlMode, setUrlMode] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const uploadedData = meta?.data ?? (value.startsWith('data:') ? value : null);
  const urlValue = uploadedData ? '' : value.trim();
  const displaySrc = uploadedData ?? urlValue;
  const mime = (
    meta?.mime ??
    (uploadedData?.startsWith('data:') ? uploadedData.slice(5, uploadedData.indexOf(';')) : '') ??
    ''
  ).toLowerCase();
  const isVideo = mime.startsWith('video/') || /\.(mp4|mov|webm)(\?|$)/i.test(displaySrc);
  const fileName =
    meta?.fileName ||
    (urlValue ? urlValue.split('/').pop()?.split('?')[0] || '' : '') ||
    (uploadedData
      ? `${isVideo ? 'video' : mime === 'image/gif' ? 'animation' : 'photo'}.${mime.split('/')[1]?.split('+')[0] ?? 'bin'}`
      : '');

  /**
   * Reads the picked file as a data: URL so its bytes travel inside the
   * value and runtimes can send them without a public host.
   * @param {File | undefined} file - Picked or dropped file.
   * @returns {void}
   */
  function acceptFile(file: File | undefined): void {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      onMetaChange?.({
        data: dataUrl,
        mime: file.type || 'image/jpeg',
        fileName: file.name,
      });
      onChange(dataUrl);
      setUrlMode(false);
    };
    reader.readAsDataURL(file);
  }

  /**
   * Clears the current media (both the value and CRUD side fields).
   * @returns {void}
   */
  function clear(): void {
    onMetaChange?.({ data: null, mime: null, fileName: null });
    onChange('');
    setUrlMode(false);
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack spacing={1.25}>
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
        >
          <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600 }}>
            {label}
          </Typography>
          {displaySrc && (
            <Tooltip title={t('actions.delete')}>
              <IconButton
                size="small"
                color="error"
                onClick={clear}
                aria-label={t('actions.delete')}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>

        {help && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {help}
          </Typography>
        )}

        {displaySrc ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Box
              sx={{
                maxHeight: 200,
                borderRadius: 1.5,
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'action.hover',
              }}
            >
              {isVideo ? (
                <Box
                  component="video"
                  src={displaySrc}
                  controls
                  sx={{ maxHeight: 200, maxWidth: '100%' }}
                />
              ) : (
                <Box
                  component="img"
                  src={displaySrc}
                  alt="Preview"
                  sx={{ maxHeight: 200, maxWidth: '100%', objectFit: 'contain' }}
                />
              )}
            </Box>
            {fileName && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
                {fileName}
              </Typography>
            )}
          </Box>
        ) : null}

        <input
          type="file"
          ref={fileInputRef}
          accept="image/*,video/mp4,video/webm"
          style={{ display: 'none' }}
          onChange={(event) => {
            acceptFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />

        <Box
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            acceptFile(event.dataTransfer.files?.[0]);
          }}
          sx={{
            py: displaySrc ? 1.25 : 2.5,
            px: 1.5,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0.5,
            border: '1.5px dashed',
            borderColor: dragOver ? 'primary.main' : 'divider',
            bgcolor: dragOver ? 'action.hover' : 'transparent',
            borderRadius: 1.5,
            cursor: 'pointer',
            textAlign: 'center',
            transition: 'border-color 120ms ease, background-color 120ms ease',
          }}
        >
          <CloudUploadIcon sx={{ color: dragOver ? 'primary.main' : 'action.active' }} />
          <Typography variant="body2">
            {displaySrc ? t('mediaLibrary.dragReplace') : t('mediaLibrary.dropHere')}
          </Typography>
        </Box>

        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}
        >
          <Button
            size="small"
            variant="text"
            startIcon={<LinkIcon />}
            onClick={() => setUrlMode(!urlMode)}
          >
            {t('common.orEnterUrl')}
          </Button>
          {botId && (
            <Button
              size="small"
              variant="text"
              startIcon={<LibraryIcon />}
              onClick={() => setPickerOpen(true)}
            >
              {t('mediaLibrary.select')}
            </Button>
          )}
        </Stack>

        {urlMode && (
          <TextField
            size="small"
            fullWidth
            label={t('mediaLibrary.url')}
            value={urlValue}
            onChange={(event) => {
              const url = event.target.value;
              onMetaChange?.({ data: null, mime: null, fileName: null });
              onChange(url);
            }}
            placeholder="https://example.com/image.jpg"
          />
        )}

        {botId && (
          <MediaPicker
            botId={botId}
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            onSelect={(picked) => {
              onMetaChange?.({ data: null, mime: null, fileName: null });
              onChange(picked);
              setUrlMode(false);
            }}
          />
        )}
      </Stack>
    </Paper>
  );
}
