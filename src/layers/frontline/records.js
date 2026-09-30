/**
 * DeepStateMap occupied-territory records, from the daily GeoJSON files in
 * the cyterat/deepstate-map-data mirror. Pure and portable.
 */

const MAX_VERTICES = 200_000;

/**
 * `YYYY-MM-DD` and `YYYYMMDD` for the UTC day `daysBack` days before `now`.
 * @param {number} now
 * @param {number} [daysBack]
 * @returns {{date: string, fileDate: string}}
 */
export function deepstateDay(now, daysBack = 0) {
  const date = new Date(now - daysBack * 24 * 60 * 60_000)
    .toISOString()
    .slice(0, 10);
  return { date, fileDate: date.replaceAll('-', '') };
}

function position(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [lon, lat] = value;
  if (
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    Math.abs(lon) > 180 ||
    Math.abs(lat) > 90
  )
    return null;
  return [lon, lat];
}

/** An open ring (closing vertex dropped), or null when malformed. */
function ring(value) {
  if (!Array.isArray(value) || value.length < 4) return null;
  const points = [];
  for (const entry of value) {
    const point = position(entry);
    if (!point) return null;
    points.push(point);
  }
  const [first] = points;
  const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) points.pop();
  return points.length >= 3 ? points : null;
}

/** `[outer, ...holes]`, or null when malformed. */
function polygon(value) {
  if (!Array.isArray(value) || value.length < 1) return null;
  const rings = value.map(ring);
  return rings.every(Boolean) ? rings : null;
}

/**
 * Normalize one daily DeepState GeoJSON file into polygons of open
 * `[lon, lat]` rings (`[outer, ...holes]`). Accepts a FeatureCollection,
 * Feature or bare geometry of Polygon or MultiPolygon type. Returns null
 * when anything is malformed, so a truncated file never replaces a good day.
 * @param {unknown} payload
 * @returns {Array<Array<Array<[number, number]>>>|null}
 */
export function normalizeDeepstateGeojson(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const geometries =
    payload.type === 'FeatureCollection'
      ? Array.isArray(payload.features)
        ? payload.features.map((feature) => feature?.geometry)
        : null
      : payload.type === 'Feature'
        ? [payload.geometry]
        : [payload];
  if (!geometries?.length) return null;
  const polygons = [];
  for (const geometry of geometries) {
    if (!geometry || !Array.isArray(geometry.coordinates)) return null;
    const parts =
      geometry.type === 'Polygon'
        ? [geometry.coordinates]
        : geometry.type === 'MultiPolygon'
          ? geometry.coordinates
          : null;
    if (!parts?.length) return null;
    for (const part of parts) {
      const rings = polygon(part);
      if (!rings) return null;
      polygons.push(rings);
    }
  }
  const vertices = polygons.reduce(
    (sum, rings) => sum + rings.reduce((n, r) => n + r.length, 0),
    0,
  );
  return vertices <= MAX_VERTICES ? polygons : null;
}
