import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { requestWithDeadline } from '../../sources/requestDeadline.js';
import { deepstateDay, normalizeDeepstateGeojson } from './records.js';

const DATA_ROOT =
  'https://raw.githubusercontent.com/cyterat/deepstate-map-data/main/data';
/** A day's file is about 80 KB; cap well above that. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;
/** A stalled request must fail visibly instead of loading forever. */
const REQUEST_TIMEOUT_MS = 30_000;
/** The mirror publishes around 03:00 UTC; look back past a missed day. */
const MAX_DAYS_BACK = 3;

/**
 * Request the newest daily DeepStateMap occupied-territory file from the
 * GitHub mirror. Keyless, and GitHub raw files send CORS `*`, so the browser
 * fetches directly. Today's UTC file is tried first; before it is published
 * (or on a missed day) the source falls back one day at a time.
 */
export function createFrontlineSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  timeoutMs = REQUEST_TIMEOUT_MS,
  maxDaysBack = MAX_DAYS_BACK,
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const startedAt = now();
      for (let daysBack = 0; daysBack <= maxDaysBack; daysBack++) {
        const { date, fileDate } = deepstateDay(startedAt, daysBack);
        const url = `${DATA_ROOT}/deepstatemap_data_${fileDate}.geojson`;
        const payload = await requestWithDeadline(
          async (requestSignal) => {
            const response = await fetchImpl(url, { signal: requestSignal });
            if (response.status === 404) {
              void response.body?.cancel().catch(() => {});
              return null;
            }
            if (!response.ok)
              throw new Error(`DeepState mirror HTTP ${response.status}`);
            return readResponseJsonCapped(
              response,
              MAX_BODY_BYTES,
              requestSignal,
            );
          },
          { signal, timeoutMs },
        );
        signal?.throwIfAborted();
        if (payload === null) continue;
        const polygons = normalizeDeepstateGeojson(payload);
        if (!polygons) throw new Error('Malformed DeepState file');
        return { date, polygons };
      }
      throw new Error(`No DeepState file in the last ${maxDaysBack + 1} days`);
    },
  };
}
