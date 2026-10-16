import { useEffect, useRef } from 'react';
import { apiFetch, getToken } from '../services/api';

/**
 * Subscribes to a bot-scoped Server-Sent Events stream and invokes the
 * callback on every change ping (the client then refetches). Handles
 * reconnection with backoff, pauses while the tab is hidden, and falls back
 * to reconnect attempts when the stream drops — the pages keep their own
 * slow polling as a backstop.
 *
 * Authentication: when an in-memory bearer token exists, a short-lived
 * single-use ticket is minted via `POST /api/auth/sse-ticket` and appended
 * as `?sse_ticket=` (EventSource cannot send headers). Otherwise the
 * session cookie rides along with the EventSource request.
 * @param {'support' | 'broadcasts'} topic - Stream topic.
 * @param {number | string | undefined} botId - Active bot id.
 * @param {() => void} onData - Refetch callback.
 * @returns {void}
 */
export function useLiveStream(
  topic: 'support' | 'broadcasts',
  botId: number | string | undefined,
  onData: () => void,
): void {
  const dataRef = useRef(onData);
  useEffect(() => {
    dataRef.current = onData;
  }, [onData]);

  useEffect(() => {
    if (!botId) return;
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let disposed = false;

    const scheduleReconnect = (): void => {
      if (reconnectTimer !== null) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 5000);
    };

    const openSource = (url: string): void => {
      if (disposed) return;
      source = new EventSource(url, { withCredentials: true });
      source.onmessage = () => dataRef.current();
      source.onerror = () => {
        source?.close();
        source = null;
        scheduleReconnect();
      };
    };

    const connect = (): void => {
      if (document.visibilityState !== 'visible') return;
      const token = getToken();
      const base = `/api/bots/${botId}/${topic}/stream`;
      if (token) {
        // Bearer session: mint a 30s single-use ticket for the EventSource
        // URL since streams cannot carry an Authorization header.
        void apiFetch<{ ticket: string }>('/api/auth/sse-ticket', { method: 'POST' })
          .then((result) => {
            openSource(`${base}?sse_ticket=${encodeURIComponent(result.ticket)}`);
          })
          .catch(() => scheduleReconnect());
      } else {
        // Cookie-authenticated: the HttpOnly session cookie is sent with the
        // same-origin EventSource request automatically.
        openSource(base);
      }
    };

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        connect();
      } else {
        source?.close();
        source = null;
      }
    };

    connect();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      source?.close();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [topic, botId]);
}
