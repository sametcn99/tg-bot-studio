import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { useTranslation } from 'react-i18next';

/**
 * Error boundary properties.
 * @interface ErrorBoundaryProps
 * @property {React.ReactNode} children - Protected tree.
 */
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

/**
 * Error boundary state.
 * @interface ErrorBoundaryState
 * @property {string | null} error - Message of the caught render error.
 */
interface ErrorBoundaryState {
  error: string | null;
}

/**
 * Localized recovery panel rendered by the boundary (function component so
 * the i18n hook can be used).
 * @param {object} props - Component props.
 * @param {string} props.message - Raw error message.
 * @returns {React.ReactElement} The error panel.
 */
function ErrorFallback({ message }: { message: string }): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Box
      role="alert"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        p: 3,
        textAlign: 'center',
      }}
    >
      <ErrorOutlineIcon color="error" sx={{ fontSize: 48 }} aria-hidden="true" />
      <Typography variant="h6" fontWeight={700}>
        {t('common.errorTitle')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480 }}>
        {message}
      </Typography>
      <Button variant="contained" onClick={() => window.location.assign('/')}>
        {t('common.errorReturnDashboard')}
      </Button>
    </Box>
  );
}

/**
 * Top-level React error boundary. Catches render crashes and shows a
 * recoverable error panel instead of a blank white page.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  /**
   * Derives display state from a thrown render error.
   * @param {unknown} error - Error thrown during rendering.
   * @returns {ErrorBoundaryState} State holding the message.
   * @static
   */
  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  /**
   * Logs caught render errors for diagnostics.
   * @param {unknown} error - Error thrown during rendering.
   * @returns {void}
   */
  componentDidCatch(error: unknown): void {
    console.error('Dashboard render error:', error);
  }

  /**
   * Renders the protected tree or the recovery panel.
   * @returns {React.ReactElement} Children or the error panel.
   */
  render(): React.ReactElement {
    if (this.state.error) {
      return <ErrorFallback message={this.state.error} />;
    }
    return this.props.children as React.ReactElement;
  }
}
