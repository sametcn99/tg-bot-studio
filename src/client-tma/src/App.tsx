import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { tmaFetch } from './api';
import { applyTheme as applyTelegramTheme, isInsideTelegram, onThemeChanged } from './sdk/telegram';
import { createT } from './i18n';
import Ecommerce from './templates/Ecommerce';
import Loyalty from './templates/Loyalty';
import Forms from './templates/Forms';
import Spin from './templates/Spin';
import Webview from './templates/Webview';
import Leaderboard from './templates/Leaderboard';
import Support from './templates/Support';

/**
 * Public Mini App runtime configuration served by `/api/tma/:slug`.
 * @interface TmaAppConfig
 * @property {string} templateType - One of the five template keys.
 * @property {string} title - In-app display title.
 * @property {string} [description] - Optional subtitle.
 * @property {Record<string, unknown>} config - Template-specific configuration.
 * @property {Record<string, unknown>} theme - Theme overrides.
 */
export interface TmaAppConfig {
  slug: string;
  templateType: string;
  title: string;
  description?: string;
  config: Record<string, unknown>;
  theme: Record<string, unknown>;
}

/**
 * Extracts the Mini App slug from the current URL (`/tma/<slug>/...`).
 * @returns {string} Slug segment or an empty string.
 */
function slugFromPath(): string {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const slugIndex = parts.findIndex((part) => part === 'tma');
  return slugIndex >= 0 ? (parts[slugIndex + 1] ?? '') : '';
}

/**
 * Applies studio-defined theme overrides (themeJson) as CSS custom
 * properties so brand colors configured in the dashboard recolor the app.
 * Must run after {@link applyTelegramTheme} so overrides win over defaults.
 * @param {Record<string, unknown>} theme - Theme overrides from the config.
 * @returns {void}
 */
function applyStudioTheme(theme: Record<string, unknown>): void {
  const root = document.documentElement.style;
  const overrides: Record<string, string> = {
    primaryColor: '--tg-button-color',
    buttonColor: '--tg-button-color',
    backgroundColor: '--tg-bg-color',
    textColor: '--tg-text-color',
    linkColor: '--tg-link-color',
  };
  for (const [key, cssVar] of Object.entries(overrides)) {
    const value = theme[key];
    if (typeof value === 'string' && value.trim()) {
      root.setProperty(cssVar, value.trim());
    }
  }
}

/**
 * Root component of the Mini App shell. Resolves the slug, loads the app
 * configuration, and renders the matching template.
 * @returns {React.ReactElement} The Mini App shell.
 */
export default function App(): React.ReactElement {
  const [config, setConfig] = useState<TmaAppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const slug = slugFromPath();

  // Stable default translator: the fetch effect runs before any owner
  // overrides exist, so English defaults are always the right choice there.
  const defaultT = useMemo(() => createT(), []);
  const t = useMemo(() => createT(config?.config), [config]);

  useEffect(() => {
    if (!slug) {
      setError(defaultT('app.slugMissing', 'No Mini App slug found in the URL.'));
      return;
    }
    let cancelled = false;
    setError(null);
    tmaFetch<TmaAppConfig>(`/api/tma/${slug}`)
      .then((loaded) => {
        if (!cancelled) setConfig(loaded);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(
            err.message ||
              defaultT('app.configLoadFailed', 'Failed to load the app configuration.'),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug, reloadTick, defaultT]);

  useEffect(() => {
    if (config?.theme) {
      applyTelegramTheme();
      applyStudioTheme(config.theme);
    }
  }, [config]);

  // Follow live Telegram dark/light switches: re-map theme params, then
  // re-layer the studio brand overrides on top.
  useEffect(() => {
    return onThemeChanged(() => {
      applyTelegramTheme();
      if (config?.theme) applyStudioTheme(config.theme);
    });
  }, [config]);

  /**
   * Re-runs the configuration fetch after a failure.
   * @returns {void}
   */
  const retry = useCallback(() => setReloadTick((tick) => tick + 1), []);

  if (error) {
    return (
      <main className="app-shell">
        <div className="error-card" role="alert">
          <div className="error-card-message">{error}</div>
          {slug ? (
            <button className="primary" onClick={retry}>
              {t('app.retry', 'Retry')}
            </button>
          ) : null}
        </div>
      </main>
    );
  }
  if (!config) {
    return (
      <div className="loading-state" role="status" aria-live="polite">
        <div className="spinner" />
        <div className="muted">{t('app.loading', 'Loading Mini App...')}</div>
      </div>
    );
  }

  const insideTelegram = isInsideTelegram();
  const logoUrl = typeof config.theme?.logoUrl === 'string' ? config.theme.logoUrl : '';

  return (
    <main className="app-shell">
      <header className="app-header">
        {logoUrl ? <img src={logoUrl} alt={config.title} className="app-logo" /> : null}
        <h1>{config.title}</h1>
        {config.description ? <p>{config.description}</p> : null}
      </header>
      {!insideTelegram && (
        <div className="card">
          <span className="muted">
            {t(
              'app.openInTelegram',
              'Open this app inside Telegram to enable personalized features and secure data access.',
            )}
          </span>
        </div>
      )}
      <TemplateRenderer config={config} />
    </main>
  );
}

/**
 * Dispatches the loaded configuration to the matching template component.
 * @param {object} props - Component props.
 * @param {TmaAppConfig} props.config - Loaded app configuration.
 * @returns {React.ReactElement | null} The rendered template.
 */
function TemplateRenderer({ config }: { config: TmaAppConfig }): React.ReactElement | null {
  switch (config.templateType) {
    case 'ecommerce':
      return <Ecommerce config={config} />;
    case 'loyalty':
      return <Loyalty config={config} />;
    case 'forms':
      return <Forms config={config} />;
    case 'spin':
      return <Spin config={config} />;
    case 'webview':
      return <Webview config={config} />;
    case 'leaderboard':
      return <Leaderboard config={config} />;
    case 'support':
      return <Support config={config} />;
    default:
      return (
        <div className="state-message">
          {createT(config.config)('app.unknownTemplate', 'Unknown template type.')}
        </div>
      );
  }
}
