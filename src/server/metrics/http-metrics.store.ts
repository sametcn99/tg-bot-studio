/**
 * Process-local store for HTTP latency observations. A plain module singleton
 * keeps the hand-rolled Prometheus rendering dependency-free (no prom-client)
 * while giving the interceptor and the renderer a shared surface.
 */

/** Latency bucket upper bounds in milliseconds (Prometheus convention). */
export const HTTP_BUCKETS_MS = [10, 50, 100, 250, 500, 1_000, 2_500, 5_000] as const;

export interface HttpRouteStats {
  /** `method route` label pair (path params collapsed to `:param`). */
  route: string;
  method: string;
  count: number;
  errors: number;
  /** Cumulative duration in ms. */
  sumMs: number;
  /** Observation counts per bucket index (+1 final `+Inf` bucket). */
  buckets: number[];
}

const MAX_DISTINCT_ROUTES = 500;
const store = new Map<string, HttpRouteStats>();

export const httpMetricsStore = {
  /**
   * Records one finished request.
   * @param {string} method - HTTP method.
   * @param {string} route - Route path pattern (`bots/:botId/users`).
   * @param {number} durationMs - Handler duration.
   * @param {boolean} isError - Whether the response status >= 400.
   * @returns {void}
   */
  observe(method: string, route: string, durationMs: number, isError: boolean): void {
    let key = `${method} ${route}`;
    let stats = store.get(key);
    if (!stats) {
      if (store.size >= MAX_DISTINCT_ROUTES) {
        key = 'OTHER';
        stats = store.get(key);
      }
      if (!stats) {
        stats = {
          route: key === 'OTHER' ? 'other' : route,
          method: key === 'OTHER' ? 'ALL' : method,
          count: 0,
          errors: 0,
          sumMs: 0,
          buckets: new Array<number>(HTTP_BUCKETS_MS.length + 1).fill(0),
        };
        store.set(key, stats);
      }
    }
    stats.count++;
    if (isError) stats.errors++;
    stats.sumMs += durationMs;
    let bucketIndex: number = HTTP_BUCKETS_MS.length;
    for (let i = 0; i < HTTP_BUCKETS_MS.length; i++) {
      if (durationMs <= HTTP_BUCKETS_MS[i]) {
        bucketIndex = i;
        break;
      }
    }
    stats.buckets[bucketIndex]++;
  },

  /**
   * Snapshot of all observed routes.
   * @returns {HttpRouteStats[]} Collected stats.
   */
  snapshot(): HttpRouteStats[] {
    return [...store.values()];
  },
};
