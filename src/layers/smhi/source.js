import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { requestWithDeadline } from '../../sources/requestDeadline.js';
import {
  SMHI_AIR_TEMPERATURE_PARAMETER,
  normalizeSmhiObservationSnapshot,
} from './records.js';

const API_ROOT =
  'https://opendata-download-metobs.smhi.se/api/version/latest/parameter';
/** The all-station latest-hour body is ~60 KB; cap well above that. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** A stalled request must fail visibly instead of loading forever. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Request and validate the latest hour of SMHI station observations. Keyless
 * and CORS-enabled (CC BY 4.0), so the browser fetches SMHI directly.
 */
export function createSmhiObservationSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  parameter = SMHI_AIR_TEMPERATURE_PARAMETER,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  const url = `${API_ROOT}/${encodeURIComponent(parameter)}/station-set/all/period/latest-hour/data.json`;
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const payload = await requestWithDeadline(
        async (requestSignal) => {
          const response = await fetchImpl(url, { signal: requestSignal });
          if (!response.ok) throw new Error(`SMHI HTTP ${response.status}`);
          return readResponseJsonCapped(
            response,
            MAX_BODY_BYTES,
            requestSignal,
          );
        },
        { signal, timeoutMs },
      );
      signal?.throwIfAborted();
      const rows = normalizeSmhiObservationSnapshot(payload, parameter);
      if (!rows) throw new Error('Malformed SMHI response');
      return rows;
    },
  };
}
