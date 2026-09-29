/**
 * Trafikverket Situation (schema 1.5) records. Pure and portable: the server
 * proxy normalizes the upstream response with these functions, and the
 * browser source re-validates the compact rows it receives.
 */

/**
 * Message types this layer shows, keyed by Trafikverket's Swedish
 * `Deviation.MessageType`. Roadworks ("Vägarbete") and ferries ("Färjor")
 * are deliberately excluded: they are planned or scheduled, not incidents.
 */
export const TRAFIKVERKET_INCIDENT_TYPES = Object.freeze({
  Olycka: 'accident',
  Hinder: 'obstacle',
  'Viktig trafikinformation': 'important',
  Restriktion: 'restriction',
  Trafikmeddelande: 'notice',
});

const INCIDENT_CATEGORIES = new Set(Object.values(TRAFIKVERKET_INCIDENT_TYPES));
/** Trafikverket impact codes: 1 none, 2 small, 4 large, 5 very large. */
const SEVERITY_CODES = new Set([1, 2, 4, 5]);
const MAX_TEXT = 500;

function text(value, max = MAX_TEXT) {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function time(value) {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function validLonLat(lon, lat) {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    Math.abs(lon) <= 180 &&
    Math.abs(lat) <= 90
  );
}

/**
 * Parse the first coordinate of a WGS84 WKT POINT or LINESTRING, e.g.
 * `POINT (18.0686 59.3293)` or `LINESTRING (18.1 59.3, 18.2 59.4)`.
 * @param {unknown} wkt
 * @returns {[number, number]|null} `[lon, lat]`
 */
export function parseWktFirstCoordinate(wkt) {
  if (typeof wkt !== 'string') return null;
  const match = wkt.match(
    /^\s*(?:POINT|LINESTRING)\s*(?:Z\s*)?\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/i,
  );
  if (!match) return null;
  const lon = Number(match[1]);
  const lat = Number(match[2]);
  return validLonLat(lon, lat) ? [lon, lat] : null;
}

/**
 * Normalize one upstream `RESPONSE` body into active incident rows.
 * Returns null when the envelope is malformed; individual deviations without
 * an id, a known incident type or a usable position are skipped, because one
 * incomplete record in a national feed must not hide every other incident.
 * @param {object} payload Parsed `/v2/data.json` body.
 * @param {{ now?: number }} [options]
 * @returns {Array<object>|null}
 */
export function normalizeTrafikverketSituations(
  payload,
  { now = Date.now() } = {},
) {
  const result = payload?.RESPONSE?.RESULT?.[0];
  if (!result || typeof result !== 'object' || result.ERROR) return null;
  const situations = result.Situation ?? [];
  if (!Array.isArray(situations)) return null;
  const rows = [];
  const ids = new Set();
  for (const situation of situations) {
    if (!situation || typeof situation !== 'object') return null;
    if (situation.Deleted === true) continue;
    const deviations = situation.Deviation ?? [];
    if (!Array.isArray(deviations)) return null;
    for (const deviation of deviations) {
      if (!deviation || typeof deviation !== 'object') continue;
      const id = text(deviation.Id, 128);
      const category = TRAFIKVERKET_INCIDENT_TYPES[deviation.MessageType];
      if (!id || !category || ids.has(id)) continue;
      const position =
        parseWktFirstCoordinate(deviation.Geometry?.Point?.WGS84) ??
        parseWktFirstCoordinate(deviation.Geometry?.Line?.WGS84);
      if (!position) continue;
      const startTime = time(deviation.StartTime);
      const endTime = time(deviation.EndTime);
      const openEnded = deviation.ValidUntilFurtherNotice === true;
      if (startTime !== null && startTime > now) continue;
      if (endTime !== null && endTime < now && !openEnded) continue;
      ids.add(id);
      const severity = Number(deviation.SeverityCode);
      rows.push({
        id,
        category,
        messageType: deviation.MessageType,
        lon: position[0],
        lat: position[1],
        header: text(deviation.Header, 160),
        message: text(deviation.Message),
        messageCode: text(deviation.MessageCode, 120),
        roadNumber: text(deviation.RoadNumber, 40),
        location: text(deviation.LocationDescriptor, 240),
        severity: SEVERITY_CODES.has(severity) ? severity : null,
        severityText: text(deviation.SeverityText, 80),
        startTime,
        endTime,
        openEnded,
      });
    }
  }
  return rows;
}

/**
 * Validate the compact rows the proxy publishes before they can replace the
 * displayed snapshot. Returns null when any row is malformed.
 * @param {unknown} rows
 * @returns {Array<object>|null}
 */
export function validateTrafikverketIncidentRows(rows) {
  if (!Array.isArray(rows)) return null;
  const ids = new Set();
  for (const row of rows) {
    if (
      !row ||
      typeof row.id !== 'string' ||
      !row.id ||
      ids.has(row.id) ||
      !INCIDENT_CATEGORIES.has(row.category) ||
      !validLonLat(row.lon, row.lat) ||
      (row.severity != null && !SEVERITY_CODES.has(row.severity))
    )
      return null;
    ids.add(row.id);
  }
  return rows;
}
