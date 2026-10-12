import React from 'react';
import { openLink } from '../sdk/telegram';
import type { TmaAppConfig } from '../App';

/**
 * External Webview Wrapper template. Embeds an external web application
 * inside Telegram with theme synchronization. Sites that forbid framing
 * (X-Frame-Options / CSP) fall back to an open-in-browser action.
 * @param {object} props - Component props.
 * @param {TmaAppConfig} props.config - Loaded app configuration.
 * @returns {React.ReactElement} The webview frame.
 */
export default function Webview({ config }: { config: TmaAppConfig }): React.ReactElement {
  const url = String(config.config.url ?? '');

  if (!url) {
    return <div className="state-message">No external URL configured.</div>;
  }

  return (
    <>
      <div className="iframe-frame">
        <iframe
          src={url}
          title={config.title}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
      <button className="secondary" onClick={() => openLink(url)}>
        Open in browser
      </button>
    </>
  );
}
