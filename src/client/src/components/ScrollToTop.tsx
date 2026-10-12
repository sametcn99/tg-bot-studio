import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Restores scroll position to the top on every route change so deep links
 * and sidebar navigation always land at the page start.
 * @returns {null} Renders nothing.
 */
export default function ScrollToTop(): null {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);

  return null;
}
