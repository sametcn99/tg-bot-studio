import React, { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from '../components/ConfirmDialog';

/**
 * Unsaved-changes guard: while `when` is true, blocks in-app navigation via
 * the data-router blocker and tab close/reload via `beforeunload`, asking
 * for confirmation with the shared ConfirmDialog.
 *
 * Usage: call at the top of the component and render the returned element
 * next to the other dialogs: `const guard = useUnsavedGuard(dirty);` …
 * `{guard}`. Dialog-internal closes do not navigate, so they never trigger
 * the router blocker.
 * @param {boolean} when - True while there are unsaved changes.
 * @returns {React.ReactElement} The confirmation dialog element to render.
 */
export function useUnsavedGuard(when: boolean): React.ReactElement {
  const { t } = useTranslation();
  const blocker = useBlocker(when);

  useEffect(() => {
    if (!when) return;
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [when]);

  return (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      title={t('common.unsavedTitle')}
      message={t('common.unsaved')}
      onConfirm={() => {
        if (blocker.state === 'blocked') blocker.proceed();
      }}
      onCancel={() => {
        if (blocker.state === 'blocked') blocker.reset();
      }}
    />
  );
}
