/** DOM event name used to ask the global simulator drawer to send a message. */
export const SIMULATOR_EVENT = 'studio:simulate';

/**
 * Asks the global Bot Simulator drawer to open (if closed) and send the
 * given text as the simulated user message. Safe to call when no drawer is
 * mounted — the event simply has no listener.
 * @param {string} text - Message text to send in the sandbox.
 * @returns {void}
 */
export function openSimulatorWith(text: string): void {
  if (typeof window === 'undefined' || !text) return;
  window.dispatchEvent(new CustomEvent(SIMULATOR_EVENT, { detail: { text } }));
}

/**
 * Subscribes to simulator requests. Used by BotSimulatorDrawer.
 * @param {(text: string) => void} handler - Called with the requested text.
 * @returns {() => void} Unsubscribe function.
 */
export function onSimulatorRequest(handler: (text: string) => void): () => void {
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<{ text?: string }>).detail;
    if (detail?.text) handler(detail.text);
  };
  window.addEventListener(SIMULATOR_EVENT, listener);
  return () => window.removeEventListener(SIMULATOR_EVENT, listener);
}
