/** DOM event name used to ask the global simulator drawer to open / send a message. */
export const SIMULATOR_EVENT = 'studio:simulate';

/**
 * Asks the global Bot Simulator drawer to open (if closed).
 * If text is provided, also sends the given text as a simulated user message.
 * Safe to call when no drawer is mounted — the event simply has no listener.
 * @param {string} [text] - Optional message text to send in the sandbox.
 * @returns {void}
 */
export function openSimulator(text?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SIMULATOR_EVENT, { detail: { text } }));
}

/**
 * Backward-compatible helper to open the simulator and send an initial command.
 * @param {string} text - Message text to send in the sandbox.
 * @returns {void}
 */
export function openSimulatorWith(text: string): void {
  openSimulator(text);
}

/**
 * Subscribes to simulator requests. Used by BotSimulatorDrawer.
 * @param {(text?: string) => void} handler - Called when simulator is requested.
 * @returns {() => void} Unsubscribe function.
 */
export function onSimulatorRequest(handler: (text?: string) => void): () => void {
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<{ text?: string }>).detail;
    handler(detail?.text);
  };
  window.addEventListener(SIMULATOR_EVENT, listener);
  return () => window.removeEventListener(SIMULATOR_EVENT, listener);
}
