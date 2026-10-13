import React, { useEffect, useState } from 'react';
import { tmaFetch } from './api';
import { isInsideTelegram } from './sdk/telegram';
import Ecommerce from './templates/Ecommerce';
import Loyalty from './templates/Loyalty';
import Forms from './templates/Forms';
import Spin from './templates/Spin';
import Webview from './templates/Webview';

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
 * @param {Record<string, unknown>} theme - Theme overrides from the config.
 * @returns {void}
 */
function applyTheme(theme: Record<string, unknown>): void {
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
  const slug = slugFromPath();

  useEffect(() => {
    if (!slug) {
      setError('No Mini App slug found in the URL.');
      return;
    }
    tmaFetch<TmaAppConfig>(`/api/tma/${slug}`)
      .then(setConfig)
      .catch((err: Error) => setError(err.message));
  }, [slug]);

  useEffect(() => {
    if (config?.theme) applyTheme(config.theme);
  }, [config]);

  if (error) {
    return <div className="state-message">{error}</div>;
  }
  if (!config) {
    return <div className="state-message">Loading Mini App...</div>;
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
            Open this app inside Telegram to enable personalized features and secure data access.
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
    default:
      return <div className="state-message">Unknown template type.</div>;
  }
}
