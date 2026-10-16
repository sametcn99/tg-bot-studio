import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Snackbar, Alert, type AlertColor } from '@mui/material';

/** One queued snackbar message. */
interface SnackbarItem {
  key: number;
  message: string;
  severity: AlertColor;
}

interface SnackbarContextType {
  showSnackbar: (message: string, severity?: AlertColor) => void;
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
  showInfo: (message: string) => void;
}

const SnackbarContext = createContext<SnackbarContextType | null>(null);

/** Maximum number of messages kept in the FIFO queue (including the visible one). */
const MAX_QUEUE = 3;

/**
 * Global snackbar provider with a small FIFO queue: rapid errors no longer
 * overwrite each other — the current message closes first, then the next one
 * shows (up to {@link MAX_QUEUE} kept at once, oldest dropped on overflow).
 * @param {object} props - Component props.
 * @param {ReactNode} props.children - Wrapped application tree.
 * @returns {React.ReactElement} The provider element.
 */
export function SnackbarProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [queue, setQueue] = useState<SnackbarItem[]>([]);
  const keyRef = useRef(0);

  const showSnackbar = useCallback((msg: string, sev: AlertColor = 'info') => {
    keyRef.current += 1;
    const item: SnackbarItem = { key: keyRef.current, message: msg, severity: sev };
    setQueue((current) => [...current, item].slice(-MAX_QUEUE));
  }, []);

  const showSuccess = useCallback((msg: string) => showSnackbar(msg, 'success'), [showSnackbar]);
  const showError = useCallback((msg: string) => showSnackbar(msg, 'error'), [showSnackbar]);
  const showInfo = useCallback((msg: string) => showSnackbar(msg, 'info'), [showSnackbar]);

  const handleClose = (_?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') return;
    // Dequeue the current message; the next one (if any) takes its place.
    setQueue((current) => current.slice(1));
  };

  const current = queue[0] ?? null;

  const value = useMemo(
    () => ({ showSnackbar, showSuccess, showError, showInfo }),
    [showSnackbar, showSuccess, showError, showInfo],
  );

  return (
    <SnackbarContext.Provider value={value}>
      {children}
      <Snackbar
        key={current?.key ?? 'empty'}
        open={current !== null}
        autoHideDuration={4000}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={handleClose}
          severity={current?.severity ?? 'info'}
          variant="filled"
          sx={{ width: '100%', boxShadow: 3 }}
        >
          {current?.message ?? ''}
        </Alert>
      </Snackbar>
    </SnackbarContext.Provider>
  );
}

export function useSnackbar(): SnackbarContextType {
  const ctx = useContext(SnackbarContext);
  if (!ctx) {
    throw new Error('useSnackbar must be used within a SnackbarProvider');
  }
  return ctx;
}
