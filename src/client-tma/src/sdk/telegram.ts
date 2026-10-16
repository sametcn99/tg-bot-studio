/**
 * Typed wrapper around the official Telegram WebApp SDK injected by
 * `telegram-web-app.js`. Exposes the raw initData for HMAC validation,
 * synchronizes theme parameters onto CSS custom properties, and provides
 * safe bindings for the BackButton, the closing confirmation, and WebApp
 * events. Every helper degrades to a no-op outside Telegram.
 * @module sdk/telegram
 */

/**
 * BackButton surface (Bot API 6.1+).
 * @interface TelegramBackButton
 */
interface TelegramBackButton {
  isVisible: boolean;
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

/**
 * WebApp events consumed by the shell.
 * `themeParamsChanged` is accepted as an alias of the official
 * `themeChanged` event so both spellings work.
 */
export type TelegramWebAppEvent =
  'themeChanged' | 'themeParamsChanged' | 'viewportChanged' | 'backButtonClicked';

/** Event handler shape used by `WebApp.onEvent` / `WebApp.offEvent`. */
type WebAppEventHandler = (payload?: unknown) => void;

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
  BackButton?: TelegramBackButton;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  onEvent?(event: string, handler: WebAppEventHandler): void;
  offEvent?(event: string, handler: WebAppEventHandler): void;
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

/**
 * Shows or hides the Telegram BackButton. No-op outside Telegram.
 * @param {boolean} visible - Whether the button should be visible.
 * @returns {void}
 */
export function setBackButtonVisible(visible: boolean): void {
  if (!webApp?.BackButton) return;
  if (visible) webApp.BackButton.show();
  else webApp.BackButton.hide();
}

/**
 * Subscribes to BackButton presses.
 * @param {() => void} handler - Invoked when the user presses BackButton.
 * @returns {() => void} Cleanup that unsubscribes the handler.
 */
export function onBackButtonClick(handler: () => void): () => void {
  const backButton = webApp?.BackButton;
  if (!backButton) return () => undefined;
  backButton.onClick(handler);
  return () => backButton.offClick(handler);
}

/**
 * Enables or disables the "close confirmation" dialog shown when the user
 * tries to close the Mini App with unsaved state (e.g. a non-empty cart).
 * @param {boolean} enabled - True to ask for confirmation before closing.
 * @returns {void}
 */
export function setClosingConfirmation(enabled: boolean): void {
  if (!webApp) return;
  if (enabled) webApp.enableClosingConfirmation?.();
  else webApp.disableClosingConfirmation?.();
}

/**
 * Subscribes to a Telegram WebApp event.
 * @param {TelegramWebAppEvent} event - Event name (`themeParamsChanged` is
 *   accepted as an alias of the official `themeChanged` event).
 * @param {() => void} handler - Event callback.
 * @returns {() => void} Cleanup that unsubscribes the handler.
 */
export function onEvent(event: TelegramWebAppEvent, handler: () => void): () => void {
  if (!webApp?.onEvent || !webApp.offEvent) return () => undefined;
  webApp.onEvent(event, handler);
  return () => webApp.offEvent?.(event, handler);
}

/**
 * Subscribes to theme changes so live dark/light switches can be followed.
 * Registers the handler for both the official `themeChanged` event and the
 * `themeParamsChanged` alias.
 * @param {() => void} handler - Invoked when Telegram theme params change.
 * @returns {() => void} Cleanup that unsubscribes the handler.
 */
export function onThemeChanged(handler: () => void): () => void {
  const offThemeChanged = onEvent('themeChanged', handler);
  const offAlias = onEvent('themeParamsChanged', handler);
  return () => {
    offThemeChanged();
    offAlias();
  };
}
