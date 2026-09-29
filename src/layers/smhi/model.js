export const SMHI_OVERLAY_SOURCE_ID = 'smhi-observations';
export const SMHI_OVERLAY_COHORT_LIMIT = 256;
export const SMHI_OVERLAY_COLLISION_CAPACITY = 64;
/** SMHI publishes hourly; an observation this old means the feed has stalled. */
export const SMHI_STALE_AFTER_MS = 3 * 60 * 60 * 1000;

const TEMPERATURE_BANDS = Object.freeze([
  [-20, '#b39ddb'],
  [-10, '#5c9dff'],
  [0, '#4dd0e1'],
  [10, '#66bb6a'],
  [20, '#ffee58'],
  [30, '#ffa726'],
  [Infinity, '#ef5350'],
]);

/**
 * Color an air temperature (°C) by band. Returns a CSS color so the model
 * stays free of Cesium types.
 * @param {number} celsius
 * @returns {string}
 */
export function temperatureColor(celsius) {
  const value = Number.isFinite(celsius) ? celsius : 0;
  for (const [upper, color] of TEMPERATURE_BANDS) {
    if (value <= upper) return color;
  }
  return TEMPERATURE_BANDS.at(-1)[1];
}

/** Format one reading for its ambient label, e.g. `-3.4°`. */
export function formatTemperature(celsius) {
  return `${Number(celsius).toFixed(1)}°`;
}

/**
 * Build the source-owned presentation for one station's ambient label.
 * @param {object} input
 * @param {string} input.id SMHI station key.
 * @param {*} input.position Ground anchor shared with the station point.
 * @param {number} input.value Air temperature in °C.
 * @param {string} input.accent Band color.
 * @returns {object}
 */
export function createSmhiOverlayEntry({ id, position, value, accent }) {
  return {
    id: String(id),
    position,
    variant: 'label',
    title: formatTemperature(value),
    accent,
    // Extremes win label collisions; ties fall back to stable identity.
    priority: Math.round(Math.abs(value) * 100),
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 10,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Whether the newest observation in a snapshot is too old to present as live. */
export function isSmhiSnapshotStale(rows, now = Date.now()) {
  let newest = null;
  for (const row of rows || []) {
    const observedAt = row?.observedAt;
    if (Number.isFinite(observedAt) && (newest === null || observedAt > newest))
      newest = observedAt;
  }
  return newest !== null && now - newest > SMHI_STALE_AFTER_MS;
}

export { normalizeSmhiObservationSnapshot } from './records.js';
