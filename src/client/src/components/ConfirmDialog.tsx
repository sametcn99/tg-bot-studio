import React from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

/** Unique ids for dialog accessibility wiring. */
const TITLE_ID = 'confirm-dialog-title';
const DESCRIPTION_ID = 'confirm-dialog-description';

/**
 * Confirmation dialog for destructive actions, fully described by
 * `aria-labelledby` / `aria-describedby`.
 * @param {object} props - Component props.
 * @param {boolean} props.open - Visibility.
 * @param {string} props.title - Dialog title.
 * @param {string} props.message - Explanatory body text.
 * @param {() => void} props.onConfirm - Invoked when the user confirms.
 * @param {() => void} props.onCancel - Invoked when the user dismisses.
 * @returns {React.ReactElement} The dialog.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth="xs"
      fullWidth
      aria-labelledby={TITLE_ID}
      aria-describedby={DESCRIPTION_ID}
    >
      <DialogTitle id={TITLE_ID}>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText id={DESCRIPTION_ID}>{message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} autoFocus>
          {t('actions.cancel')}
        </Button>
        <Button color="error" variant="contained" onClick={onConfirm}>
          {t('actions.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
