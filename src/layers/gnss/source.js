import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { requestWithDeadline } from '../../sources/requestDeadline.js';
import { validateGnssSnapshot } from './records.js';

/** About 1,000 hexagons a day with boundaries is roughly 150 KB. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;
/** Covers the proxy's own 30 s upstream deadlines plus hexagon conversion. */
const REQUEST_TIMEOUT_MS = 75_000;

/**
 * Request the latest GPSJam day through the same-origin proxy, which fetches
 * GPSJam (no CORS) and converts H3 cells to hexagon boundaries.
 */
export function createGnssInterferenceSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiUrl = '/api/gpsjam/latest',
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const { status, payload } = await requestWithDeadline(
        async (requestSignal) => {
          const response = await fetchImpl(apiUrl, {
            signal: requestSignal,
            cache: 'no-store',
          });
          let body = null;
          try {
            body = await readResponseJsonCapped(
              response,
              MAX_BODY_BYTES,
              requestSignal,
            );
          } catch (error) {
            if (error?.name === 'AbortError' || error?.name === 'TimeoutError')
              throw error;
            /* the status below remains authoritative */
          }
          return { status: response.status, payload: body };
        },
        { signal, timeoutMs },
      );
      signal?.throwIfAborted();
      if (status < 200 || status > 299)
        throw new Error(`GPSJam HTTP ${status}`);
      const snapshot = validateGnssSnapshot(payload);
      if (!snapshot) throw new Error('Malformed GPSJam snapshot');
      return {
        ...snapshot,
        stale: payload.stale === true,
        fetchedAt: Number.isFinite(payload.fetchedAt)
          ? payload.fetchedAt
          : null,
      };
    },
  };
}
