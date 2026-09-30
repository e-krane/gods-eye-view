/**
 * Baltic seabed-infrastructure incident records: the schema of the curated
 * dataset in `incidents.js` and its validation. Pure and portable.
 */

/**
 * How far an incident's cause has been established. Ordered from most to
 * least serious for the legend; every incident carries exactly one.
 */
export const SEABED_STATUSES = Object.freeze([
  'confirmed_sabotage',
  'suspected',
  'attributed',
  'unresolved',
  'ruled_accidental',
]);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

function isDate(value) {
  return (
    typeof value === 'string' &&
    DATE_PATTERN.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  );
}

const isText = (value, max) =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max;

function isSource(source) {
  if (!source || typeof source !== 'object') return false;
  let url;
  try {
    url = new URL(source.url);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    isText(source.title, 300) &&
    isText(source.publisher, 120) &&
    isDate(source.date)
  );
}

/**
 * True when one incident is complete: an id, a date, a known status, a
 * position with a stated uncertainty, a summary and at least one https
 * source.
 * @param {unknown} incident
 * @returns {boolean}
 */
export function isSeabedIncident(incident) {
  if (!incident || typeof incident !== 'object') return false;
  const {
    id,
    date,
    title,
    assets,
    vessel,
    status,
    statusAsOf,
    lon,
    lat,
    uncertaintyKm,
    locationBasis,
    summary,
    sources,
  } = incident;
  return (
    ID_PATTERN.test(id || '') &&
    isDate(date) &&
    isText(title, 60) &&
    Array.isArray(assets) &&
    assets.length > 0 &&
    assets.every((asset) => isText(asset, 160)) &&
    (vessel === null || isText(vessel, 120)) &&
    SEABED_STATUSES.includes(status) &&
    isDate(statusAsOf) &&
    statusAsOf >= date &&
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    // The Baltic Sea and its approaches.
    lon >= 9 &&
    lon <= 31 &&
    lat >= 53 &&
    lat <= 66 &&
    Number.isFinite(uncertaintyKm) &&
    uncertaintyKm > 0 &&
    uncertaintyKm <= 200 &&
    isText(locationBasis, 400) &&
    isText(summary, 400) &&
    Array.isArray(sources) &&
    sources.length > 0 &&
    sources.every(isSource)
  );
}

/**
 * Validate the whole dataset. Returns the incidents sorted newest first, or
 * null when any incident is malformed or an id repeats.
 * @param {unknown} incidents
 * @returns {Array<object>|null}
 */
export function validateSeabedIncidents(incidents) {
  if (!Array.isArray(incidents)) return null;
  const ids = new Set();
  for (const incident of incidents) {
    if (!isSeabedIncident(incident) || ids.has(incident.id)) return null;
    ids.add(incident.id);
  }
  return [...incidents].sort(
    (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
  );
}
