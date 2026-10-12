import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initTelegram } from './sdk/telegram';
import './styles.css';

/**
 * Boots the Mini App shell: initializes the Telegram WebApp SDK (theme
 * sync, readiness signal) and mounts the React root.
 * @returns {void}
 */
function bootstrap(): void {
  initTelegram();
  const container = document.getElementById('root');
  if (!container) return;
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

bootstrap();
