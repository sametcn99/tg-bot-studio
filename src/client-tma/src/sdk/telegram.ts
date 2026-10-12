/**
 * Typed wrapper around the official Telegram WebApp SDK injected by
 * `telegram-web-app.js`. Exposes the raw initData for HMAC validation and
 * synchronizes theme parameters onto CSS custom properties.
 * @module sdk/telegram
 */

/**
 * Subset of the Telegram WebApp surface used by the Mini App shell.
 * @interface TelegramWebApp
 * @property {string} initData - Raw signed initData query string.
 * @property {object} initDataUnsafe - Parsed payload with `user`.
 * @property {'light'|'dark'} colorScheme - Active Telegram color scheme.
 * @property {Record<string, string>} themeParams - Active theme colors.
 */
interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string; username?: string } };
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  ready(): void;
  expand(): void;
  HapticFeedback?: { impactOccurred(style: 'light' | 'medium' | 'heavy'): void };
  openLink(url: string): void;
  openTelegramLink(url: string): void;
  showAlert?(message: string): void;
}

/** Global WebApp instance published by the Telegram script. */
export const webApp = (window as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;

/**
 * Initializes the WebApp SDK: signals readiness, expands to full height, and
 * applies theme parameters to CSS variables.
 * @returns {void}
 */
export function initTelegram(): void {
  webApp?.ready();
  webApp?.expand();
  applyTheme();
}

/**
 * Maps Telegram theme parameters onto `--tg-*` CSS custom properties.
 * @returns {void}
 */
export function applyTheme(): void {
  if (!webApp) return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(webApp.themeParams)) {
    const cssKey = `--tg-${key.replace(/_/g, '-').toLowerCase()}`;
    root.style.setProperty(cssKey, value);
  }
}

/**
 * Indicates whether the shell runs inside a real Telegram client.
 * @returns {boolean} True when initData is available.
 */
export function isInsideTelegram(): boolean {
  return Boolean(webApp && webApp.initData.length > 0);
}

/**
 * Triggers a haptic impact feedback pulse when supported.
 * @param {'light'|'medium'|'heavy'} [style='light'] - Feedback intensity.
 * @returns {void}
 */
export function haptic(style: 'light' | 'medium' | 'heavy' = 'light'): void {
  webApp?.HapticFeedback?.impactOccurred(style);
}

/**
 * Opens an external URL outside the Telegram webview.
 * @param {string} url - Target URL.
 * @returns {void}
 */
export function openLink(url: string): void {
  webApp?.openLink(url);
}
