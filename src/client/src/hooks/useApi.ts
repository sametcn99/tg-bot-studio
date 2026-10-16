import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../services/api';
import { localizedErrorMessage } from '../utils/errors';

/** Result of {@link useApi}. */
export interface UseApiResult<T> {
  /** Response data, or null before the first success. */
  data: T | null;
  /** Localized error message of the last failed request, or null. */
  error: string | null;
  /** True while a request for the current parameters is in flight. */
  loading: boolean;
  /** Triggers a refetch of the current path. */
  reload: () => void;
}

/**
 * Small generic data-fetching hook built on `apiFetch`: fetches `path` while
 * it is non-null, guards against out-of-order responses with a sequence
 * counter, routes failures through the localized error util, and exposes a
 * `reload` handle for manual/SSE-driven refetches.
 * @template T - Expected response data shape.
 * @param {string | null} path - API path, or null to skip fetching.
 * @param {unknown[]} deps - Extra values that should retrigger the fetch.
 * @returns {UseApiResult<T>} Data, error, loading, and reload handle.
 */
export function useApi<T>(path: string | null, deps: unknown[] = []): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const [tick, setTick] = useState(0);
  const seqRef = useRef(0);

  const reload = useCallback((): void => {
    setTick((value) => value + 1);
  }, []);

  // Primitives serialized so callers can pass inline arrays safely.
  const depsKey = JSON.stringify(deps);

  useEffect(() => {
    if (path === null) {
      setLoading(false);
      return;
    }
    const sequence = ++seqRef.current;
    setLoading(true);
    apiFetch<T>(path)
      .then((result) => {
        if (seqRef.current !== sequence) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (seqRef.current !== sequence) return;
        setError(localizedErrorMessage(err));
      })
      .finally(() => {
        if (seqRef.current === sequence) setLoading(false);
      });
    return () => {
      // Invalidate in-flight responses when params change or on unmount.
      seqRef.current += 1;
    };
  }, [path, tick, depsKey]);

  return { data, error, loading, reload };
}
