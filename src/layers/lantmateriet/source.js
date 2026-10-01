import {
  LANTMATERIET_DATASETS,
  validateLantmaterietDataset,
} from './records.js';

// Built by scripts/build-lantmateriet.mjs from Lantmäteriet open data (CC0).
const DATASET_URLS = Object.freeze({
  power: new URL(
    '../../data/local_data/lantmateriet_topografi250/power.json',
    import.meta.url,
  ).href,
  rail: new URL(
    '../../data/local_data/lantmateriet_topografi250/rail.json',
    import.meta.url,
  ).href,
  roads: new URL(
    '../../data/local_data/lantmateriet_topografi250/roads.json',
    import.meta.url,
  ).href,
  military: new URL(
    '../../data/local_data/lantmateriet_topografi250/military.json',
    import.meta.url,
  ).href,
});

/**
 * Serve one bundled, validated Lantmäteriet line or area dataset.
 * @param {{ dataset: string, fetchImpl?: typeof fetch, url?: string }} options
 */
export function createLantmaterietLineSource({
  dataset,
  fetchImpl = (...args) => fetch(...args),
  url = DATASET_URLS[dataset],
} = {}) {
  if (!LANTMATERIET_DATASETS[dataset])
    throw new TypeError(`Unknown Lantmäteriet dataset ${dataset}`);
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(url, { signal, cache: 'force-cache' });
      if (!response.ok) {
        try {
          await response.body?.cancel();
        } catch {
          /* best effort */
        }
        throw new Error(
          `Lantmäteriet dataset unavailable (HTTP ${response.status})`,
        );
      }
      const json = await response.json();
      signal?.throwIfAborted();
      const valid = validateLantmaterietDataset(json, dataset);
      if (!valid) throw new Error('Malformed Lantmäteriet dataset');
      return valid;
    },
  };
}
