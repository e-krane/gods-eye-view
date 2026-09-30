/**
 * GPSJam daily GNSS-interference records. Pure and portable: the server proxy
 * parses GPSJam's manifest and daily H3 CSV with these functions, and the
 * browser source re-validates the compact cells it receives. Hexagon
 * boundaries are computed in the proxy, so nothing here depends on h3-js.
 */

/**
 * GPSJam's published interference levels, by percentage of aircraft that
 * reported low navigation accuracy in a hexagon over one UTC day
 * (https://gpsjam.org/faq/): low 0-2 %, medium 2-10 %, high above 10 %.
 */
export const GNSS_LEVEL_THRESHOLDS = Object.freeze({ medium: 2, high: 10 });
export const GNSS_LEVELS = Object.freeze(['medium', 'high']);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HEX_PATTERN = /^[0-9a-f]{15}$/;
const MAX_BOUNDARY_VERTICES = 10;

/**
 * GPSJam's formula: `100 * (bad - 1) / (good + bad)`. Subtracting one bad
 * aircraft suppresses hexagons where a single aircraft reported low accuracy.
 * @param {number} good
 * @param {number} bad
 * @returns {number} Percentage, never below 0.
 */
export function gnssBadPercent(good, bad) {
  const total = good + bad;
  if (!(total > 0)) return 0;
  return Math.max(0, (100 * (bad - 1)) / total);
}

/**
 * @param {number} percent
 * @returns {'low'|'medium'|'high'}
 */
export function gnssLevel(percent) {
  if (percent > GNSS_LEVEL_THRESHOLDS.high) return 'high';
  if (percent > GNSS_LEVEL_THRESHOLDS.medium) return 'medium';
  return 'low';
}

function isDate(value) {
  return (
    typeof value === 'string' &&
    DATE_PATTERN.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  );
}

function csvLines(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  return lines.length ? lines : null;
}

/**
 * Parse `manifest.csv` (`date,suspect,num_bad_aircraft_hexes,source`).
 * Returns the days in date order, or null when the header or a row is
 * malformed. `suspect` marks a day GPSJam knows to be incomplete.
 * @param {unknown} text
 * @returns {Array<{date: string, suspect: boolean}>|null}
 */
export function parseGpsjamManifest(text) {
  const lines = csvLines(text);
  if (!lines) return null;
  const header = lines[0].split(',').map((cell) => cell.trim());
  const dateIndex = header.indexOf('date');
  const suspectIndex = header.indexOf('suspect');
  if (dateIndex < 0 || suspectIndex < 0) return null;
  const days = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const date = cells[dateIndex]?.trim();
    const suspect = cells[suspectIndex]?.trim();
    if (!isDate(date) || (suspect !== 'true' && suspect !== 'false'))
      return null;
    days.push({ date, suspect: suspect === 'true' });
  }
  if (!days.length) return null;
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Parse one day's `YYYY-MM-DD-h3_4.csv`
 * (`hex,count_good_aircraft,count_bad_aircraft`). Returns null when the
 * header or any row is malformed, so a truncated file never replaces a good
 * day.
 * @param {unknown} text
 * @returns {Array<{hex: string, good: number, bad: number}>|null}
 */
export function parseGpsjamCells(text) {
  const lines = csvLines(text);
  if (!lines) return null;
  const header = lines[0].split(',').map((cell) => cell.trim());
  const hexIndex = header.indexOf('hex');
  const goodIndex = header.indexOf('count_good_aircraft');
  const badIndex = header.indexOf('count_bad_aircraft');
  if (hexIndex < 0 || goodIndex < 0 || badIndex < 0) return null;
  const cells = [];
  for (const line of lines.slice(1)) {
    const row = line.split(',');
    const hex = row[hexIndex]?.trim().toLowerCase();
    const good = Number(row[goodIndex]);
    const bad = Number(row[badIndex]);
    if (
      !HEX_PATTERN.test(hex || '') ||
      !Number.isInteger(good) ||
      !Number.isInteger(bad) ||
      good < 0 ||
      bad < 0
    )
      return null;
    cells.push({ hex, good, bad });
  }
  return cells;
}

/**
 * Keep the hexagons GPSJam colours medium or high, with their level and
 * percentage. Low hexagons (usually 95 % or more of a day) are dropped.
 * @param {Array<{hex: string, good: number, bad: number}>} cells
 * @returns {Array<{hex: string, good: number, bad: number, percent: number, level: string}>}
 */
export function interferenceCells(cells) {
  const result = [];
  for (const cell of cells) {
    const percent = gnssBadPercent(cell.good, cell.bad);
    const level = gnssLevel(percent);
    if (level === 'low') continue;
    result.push({ ...cell, percent: Math.round(percent * 10) / 10, level });
  }
  return result;
}

function validBoundary(boundary) {
  if (
    !Array.isArray(boundary) ||
    boundary.length < 3 ||
    boundary.length > MAX_BOUNDARY_VERTICES
  )
    return false;
  return boundary.every(
    (vertex) =>
      Array.isArray(vertex) &&
      vertex.length === 2 &&
      Number.isFinite(vertex[0]) &&
      Number.isFinite(vertex[1]) &&
      // Longitudes may run past 180 so a hexagon crossing the antimeridian
      // stays one contiguous ring.
      Math.abs(vertex[0]) <= 360 &&
      Math.abs(vertex[1]) <= 90,
  );
}

/**
 * Validate the snapshot the proxy publishes before it can replace the
 * displayed one. Returns null when anything is malformed.
 * @param {unknown} payload
 * @returns {{date: string, suspect: boolean, cells: Array<object>}|null}
 */
export function validateGnssSnapshot(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const { date, suspect, cells } = payload;
  if (!isDate(date) || typeof suspect !== 'boolean' || !Array.isArray(cells))
    return null;
  const seen = new Set();
  for (const cell of cells) {
    if (
      !cell ||
      !HEX_PATTERN.test(cell.hex || '') ||
      seen.has(cell.hex) ||
      !GNSS_LEVELS.includes(cell.level) ||
      !Number.isInteger(cell.good) ||
      !Number.isInteger(cell.bad) ||
      cell.good < 0 ||
      cell.bad < 0 ||
      !Number.isFinite(cell.percent) ||
      cell.percent < 0 ||
      cell.percent > 100 ||
      !validBoundary(cell.boundary)
    )
      return null;
    seen.add(cell.hex);
  }
  return { date, suspect, cells };
}
