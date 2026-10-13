import { useEffect, useRef } from 'react';
import { getToken } from '../services/api';

/**
 * Subscribes to a bot-scoped Server-Sent Events stream and invokes the
 * callback on every change ping (the client then refetches). Handles
 * reconnection with backoff, pauses while the tab is hidden, and falls back
 * to reconnect attempts when the stream drops — the pages keep their own
 * slow polling as a backstop.
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

    const scheduleReconnect = (): void => {
      if (reconnectTimer !== null) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 5000);
    };

    const connect = (): void => {
      if (document.visibilityState !== 'visible') return;
      const token = getToken();
      source = new EventSource(
        `/api/bots/${botId}/${topic}/stream?access_token=${encodeURIComponent(token ?? '')}`,
      );
      source.onmessage = () => dataRef.current();
      source.onerror = () => {
        source?.close();
        source = null;
        scheduleReconnect();
      };
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
      source?.close();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [topic, botId]);
}
