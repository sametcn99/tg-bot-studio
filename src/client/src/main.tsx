import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import App from './App';
import './i18n';
import './styles.css';

/**
 * Mounts the React 19 Studio dashboard root.
 * @returns {void}
 */
function bootstrap(): void {
  const container = document.getElementById('root');
  if (!container) return;
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

bootstrap();
