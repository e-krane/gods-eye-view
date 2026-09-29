import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { requestWithDeadline } from '../../sources/requestDeadline.js';
import { validateTrafikverketIncidentRows } from './records.js';

/** The proxy publishes compact rows; a national snapshot is well under this. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;
/** Covers the proxy's own 30 s upstream deadline plus serialization. */
const REQUEST_TIMEOUT_MS = 45_000;

/**
 * Request road incidents through the same-origin Trafikverket proxy, which
 * holds the API key server-side. Resolves `{ keyRequired: true }` when no key
 * is configured so the layer can show "Needs Trafikverket" instead of a fault.
 */
export function createTrafikverketIncidentSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiUrl = '/api/trafikverket/incidents',
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
      if (status === 503 && payload?.error === 'no_key')
        return { keyRequired: true };
      if (payload?.error === 'auth_failed')
        throw new Error('Trafikverket rejected the API key');
      if (status < 200 || status > 299)
        throw new Error(`Trafikverket HTTP ${status}`);
      const rows = validateTrafikverketIncidentRows(payload?.rows);
      if (!rows) throw new Error('Malformed Trafikverket snapshot');
      return {
        rows,
        stale: payload.stale === true,
        fetchedAt: Number.isFinite(payload.fetchedAt)
          ? payload.fetchedAt
          : null,
      };
    },
  };
}
