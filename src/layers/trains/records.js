/**
 * Trafikverket TrainPosition (järnväg.trafikinfo, schema 1.1) records. Pure
 * and portable: the server proxy normalizes the upstream response with these
 * functions, and the browser source re-validates the compact rows it gets.
 */

/** Positions older than this are dropped; a train that stops reporting fades out. */
export const TRAIN_MAX_AGE_MS = 5 * 60_000;
const MAX_SPEED_KMH = 400;

function validLonLat(lon, lat) {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    Math.abs(lon) <= 180 &&
    Math.abs(lat) <= 90
  );
}

/**
 * `[lon, lat]` from a WGS84 WKT point such as `POINT (15.13 58.32)`.
 * @param {unknown} wkt
 * @returns {[number, number]|null}
 */
export function parseWktPoint(wkt) {
  if (typeof wkt !== 'string') return null;
  const match = wkt.match(
    /^\s*POINT\s*(?:Z\s*)?\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/i,
  );
  if (!match) return null;
  const lon = Number(match[1]);
  const lat = Number(match[2]);
  return validLonLat(lon, lat) ? [lon, lat] : null;
}

function trainNumber(value) {
  return typeof value === 'string' && /^[0-9A-Za-z]{1,12}$/.test(value.trim())
    ? value.trim()
    : null;
}

/**
 * Normalize one upstream `RESPONSE` body into current train positions.
 * Returns null when the envelope is malformed. Deleted, inactive, stale and
 * unlocated trains are skipped; if a train repeats, the newest report wins.
 * @param {object} payload Parsed `/v2/data.json` body.
 * @param {{ now?: number, maxAgeMs?: number }} [options]
 * @returns {Array<object>|null}
 */
export function normalizeTrafikverketTrainPositions(
  payload,
  { now = Date.now(), maxAgeMs = TRAIN_MAX_AGE_MS } = {},
) {
  const result = payload?.RESPONSE?.RESULT?.[0];
  if (!result || typeof result !== 'object' || result.ERROR) return null;
  const positions = result.TrainPosition ?? [];
  if (!Array.isArray(positions)) return null;
  const byId = new Map();
  for (const entry of positions) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.Deleted === true || entry.Status?.Active === false) continue;
    const operational = trainNumber(entry.Train?.OperationalTrainNumber);
    const day = String(entry.Train?.OperationalTrainDepartureDate ?? '').slice(
      0,
      10,
    );
    if (!operational || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const position = parseWktPoint(entry.Position?.WGS84);
    const timestamp = Date.parse(entry.TimeStamp);
    if (!position || !Number.isFinite(timestamp)) continue;
    if (now - timestamp > maxAgeMs) continue;
    const bearing = Number(entry.Bearing);
    const speed = Number(entry.Speed);
    const row = {
      id: `${operational}:${day}`,
      number: trainNumber(entry.Train?.AdvertisedTrainNumber) ?? operational,
      lon: position[0],
      lat: position[1],
      bearing:
        entry.Bearing != null && bearing >= 0 && bearing < 360
          ? Math.round(bearing)
          : null,
      speed:
        entry.Speed != null && speed >= 0 && speed <= MAX_SPEED_KMH
          ? Math.round(speed)
          : null,
      timestamp,
    };
    const previous = byId.get(row.id);
    if (!previous || previous.timestamp < row.timestamp) byId.set(row.id, row);
  }
  return [...byId.values()];
}

/**
 * Validate the compact rows the proxy publishes before they can replace the
 * displayed trains. Returns null when any row is malformed.
 * @param {unknown} rows
 * @returns {Array<object>|null}
 */
export function validateTrainPositionRows(rows) {
  if (!Array.isArray(rows)) return null;
  const ids = new Set();
  for (const row of rows) {
    if (
      !row ||
      typeof row.id !== 'string' ||
      !row.id ||
      ids.has(row.id) ||
      typeof row.number !== 'string' ||
      !validLonLat(row.lon, row.lat) ||
      !Number.isFinite(row.timestamp) ||
      (row.bearing != null &&
        !(
          Number.isInteger(row.bearing) &&
          row.bearing >= 0 &&
          row.bearing < 360
        )) ||
      (row.speed != null &&
        !(
          Number.isInteger(row.speed) &&
          row.speed >= 0 &&
          row.speed <= MAX_SPEED_KMH
        ))
    )
      return null;
    ids.add(row.id);
  }
  return rows;
}
