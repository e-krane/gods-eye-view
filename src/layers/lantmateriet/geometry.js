/**
 * Pure geometry helpers for the Lantmäteriet static line layers. The build
 * script (`scripts/build-lantmateriet.mjs`) uses them to turn Topografi 250
 * GeoPackage rows into compact bundled datasets; the browser only decodes.
 * No Node, browser or Cesium globals.
 */

// GRS80, the ellipsoid of SWEREF 99. SWEREF 99 TM is a transverse Mercator
// projection on longitude 15° E with scale 0.9996 and 500 km false easting.
const A = 6378137;
const F = 1 / 298.257222101;
const LON0 = 15;
const K0 = 0.9996;
const FALSE_EASTING = 500000;

const E2 = F * (2 - F);
const N = F / (2 - F);
const A_ROOF = (A / (1 + N)) * (1 + N ** 2 / 4 + N ** 4 / 64);
const DEG = Math.PI / 180;

// Gauss–Krüger series coefficients, as published by Lantmäteriet.
const INVERSE_DELTA = [
  N / 2 - (2 * N ** 2) / 3 + (37 * N ** 3) / 96 - N ** 4 / 360,
  N ** 2 / 48 + N ** 3 / 15 - (437 * N ** 4) / 1440,
  (17 * N ** 3) / 480 - (37 * N ** 4) / 840,
  (4397 * N ** 4) / 161280,
];
const INVERSE_A = E2 + E2 ** 2 + E2 ** 3 + E2 ** 4;
const INVERSE_B = -(7 * E2 ** 2 + 17 * E2 ** 3 + 30 * E2 ** 4) / 6;
const INVERSE_C = (224 * E2 ** 3 + 889 * E2 ** 4) / 120;
const INVERSE_D = -(4279 * E2 ** 4) / 1260;

const FORWARD_BETA = [
  N / 2 - (2 * N ** 2) / 3 + (5 * N ** 3) / 16 + (41 * N ** 4) / 180,
  (13 * N ** 2) / 48 - (3 * N ** 3) / 5 + (557 * N ** 4) / 1440,
  (61 * N ** 3) / 240 - (103 * N ** 4) / 140,
  (49561 * N ** 4) / 161280,
];
const FORWARD_A = E2;
const FORWARD_B = (5 * E2 ** 2 - E2 ** 3) / 6;
const FORWARD_C = (104 * E2 ** 3 - 45 * E2 ** 4) / 120;
const FORWARD_D = (1237 * E2 ** 4) / 1260;

/**
 * SWEREF 99 TM (EPSG:3006) easting/northing in metres to WGS84 degrees.
 * SWEREF 99 and WGS84 agree to well under a metre, so no datum shift.
 * @returns {[number, number]} `[lon, lat]`
 */
export function sweref99tmToWgs84(easting, northing) {
  const xi = northing / (K0 * A_ROOF);
  const eta = (easting - FALSE_EASTING) / (K0 * A_ROOF);
  let xiPrime = xi;
  let etaPrime = eta;
  for (let j = 1; j <= 4; j++) {
    const d = INVERSE_DELTA[j - 1];
    xiPrime -= d * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaPrime -= d * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const phiStar = Math.asin(Math.sin(xiPrime) / Math.cosh(etaPrime));
  const deltaLambda = Math.atan(Math.sinh(etaPrime) / Math.cos(xiPrime));
  const s2 = Math.sin(phiStar) ** 2;
  const lat =
    phiStar +
    Math.sin(phiStar) *
      Math.cos(phiStar) *
      (INVERSE_A + INVERSE_B * s2 + INVERSE_C * s2 ** 2 + INVERSE_D * s2 ** 3);
  return [LON0 + deltaLambda / DEG, lat / DEG];
}

/**
 * WGS84 degrees to SWEREF 99 TM metres; the inverse of `sweref99tmToWgs84`.
 * @returns {[number, number]} `[easting, northing]`
 */
export function wgs84ToSweref99tm(lon, lat) {
  const phi = lat * DEG;
  const deltaLambda = (lon - LON0) * DEG;
  const s2 = Math.sin(phi) ** 2;
  const phiStar =
    phi -
    Math.sin(phi) *
      Math.cos(phi) *
      (FORWARD_A + FORWARD_B * s2 + FORWARD_C * s2 ** 2 + FORWARD_D * s2 ** 3);
  const xiPrime = Math.atan(Math.tan(phiStar) / Math.cos(deltaLambda));
  const etaPrime = Math.atanh(Math.cos(phiStar) * Math.sin(deltaLambda));
  let x = xiPrime;
  let y = etaPrime;
  for (let j = 1; j <= 4; j++) {
    const b = FORWARD_BETA[j - 1];
    x += b * Math.sin(2 * j * xiPrime) * Math.cosh(2 * j * etaPrime);
    y += b * Math.cos(2 * j * xiPrime) * Math.sinh(2 * j * etaPrime);
  }
  return [K0 * A_ROOF * y + FALSE_EASTING, K0 * A_ROOF * x];
}

const ENVELOPE_BYTES = [0, 32, 48, 48, 64];

function readGpkg(blob) {
  const out = { lines: [], polygons: [] };
  if (!(blob instanceof Uint8Array) || blob.length < 8) return out;
  if (blob[0] !== 0x47 || blob[1] !== 0x50) return out; // "GP"
  const flags = blob[3];
  if (flags & 0x10) return out; // empty geometry
  const envelope = ENVELOPE_BYTES[(flags >> 1) & 0x07];
  if (envelope === undefined) return out;
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  try {
    readWkb(view, 8 + envelope, out);
  } catch {
    return { lines: [], polygons: [] };
  }
  return out;
}

/**
 * Lines from one GeoPackage geometry blob (a GPKG header followed by WKB).
 * LineStrings and MultiLineStrings are read, in 2D, 3D, M or ZM, ISO or EWKB
 * flavour; any other geometry yields no lines.
 * @param {Uint8Array} blob
 * @returns {Array<Array<[number, number]>>}
 */
export function parseGpkgLines(blob) {
  return readGpkg(blob).lines;
}

/**
 * Polygons from one GeoPackage geometry blob: each polygon is its outer ring
 * followed by any holes. Polygons and MultiPolygons are read; any other
 * geometry yields none.
 * @param {Uint8Array} blob
 * @returns {Array<Array<Array<[number, number]>>>}
 */
export function parseGpkgPolygons(blob) {
  return readGpkg(blob).polygons;
}

function readPoints(view, offset, little, dims) {
  const count = view.getUint32(offset, little);
  offset += 4;
  const points = new Array(count);
  for (let i = 0; i < count; i++) {
    points[i] = [
      view.getFloat64(offset, little),
      view.getFloat64(offset + 8, little),
    ];
    offset += 8 * dims;
  }
  return [points, offset];
}

function readWkb(view, offset, out) {
  const little = view.getUint8(offset) === 1;
  let type = view.getUint32(offset + 1, little);
  let dims = 2;
  // EWKB carries Z/M as high bits; ISO adds 1000/2000/3000 to the type.
  if (type & 0x80000000) dims++;
  if (type & 0x40000000) dims++;
  if (type & 0x20000000) offset += 4; // EWKB SRID
  type &= 0x0fffffff;
  const iso = Math.floor(type / 1000);
  if (iso === 1 || iso === 2) dims = 3;
  else if (iso === 3) dims = 4;
  type %= 1000;
  offset += 5;
  if (type === 2) {
    const [line, next] = readPoints(view, offset, little, dims);
    if (line.length >= 2) out.lines.push(line);
    return next;
  }
  if (type === 3) {
    const ringCount = view.getUint32(offset, little);
    offset += 4;
    const rings = [];
    for (let i = 0; i < ringCount; i++) {
      const [ring, next] = readPoints(view, offset, little, dims);
      offset = next;
      if (ring.length >= 4) rings.push(ring);
    }
    if (rings.length) out.polygons.push(rings);
    return offset;
  }
  if (type === 5 || type === 6) {
    const parts = view.getUint32(offset, little);
    offset += 4;
    for (let i = 0; i < parts; i++) offset = readWkb(view, offset, out);
    return offset;
  }
  throw new Error(`Unsupported WKB type ${type}`);
}

const nodeKey = ([x, y]) => `${Math.round(x)},${Math.round(y)}`;

/**
 * Join line segments that meet end to end into longer lines. Topografi
 * networks are split at every junction; merging through simple (degree two)
 * nodes leaves far fewer, longer lines to draw. Lines only merge with others
 * in the same group, so give each class (and label) its own call.
 * Coordinates are metres; endpoints within half a metre count as shared.
 * @param {Array<Array<[number, number]>>} lines
 * @returns {Array<Array<[number, number]>>}
 */
export function mergeLines(lines) {
  const ends = new Map();
  const addEnd = (key, index) => {
    const list = ends.get(key);
    if (list) list.push(index);
    else ends.set(key, [index]);
  };
  lines.forEach((line, index) => {
    addEnd(nodeKey(line[0]), index);
    addEnd(nodeKey(line.at(-1)), index);
  });
  const used = new Uint8Array(lines.length);
  const merged = [];
  // A node is a chain boundary unless exactly two line ends meet there.
  const passThrough = (key) => ends.get(key).length === 2;
  const other = (key, index) =>
    ends.get(key).find((i) => i !== index && !used[i]);

  const walk = (start) => {
    used[start] = 1;
    let chain = lines[start].slice();
    // Extend forward from the end, then backward from the start.
    for (const forward of [true, false]) {
      for (;;) {
        const tip = forward ? chain.at(-1) : chain[0];
        const key = nodeKey(tip);
        if (!passThrough(key)) break;
        const next = other(key, -1);
        if (next === undefined) break;
        used[next] = 1;
        let segment = lines[next];
        const startsHere = nodeKey(segment[0]) === key;
        if (forward) {
          if (!startsHere) segment = segment.slice().reverse();
          chain = chain.concat(segment.slice(1));
        } else {
          if (startsHere) segment = segment.slice().reverse();
          chain = segment.slice(0, -1).concat(chain);
        }
      }
    }
    merged.push(chain);
  };
  // Start chains at boundary nodes first so open paths are walked whole.
  lines.forEach((line, index) => {
    if (used[index]) return;
    if (!passThrough(nodeKey(line[0])) || !passThrough(nodeKey(line.at(-1))))
      walk(index);
  });
  // Whatever remains forms closed loops.
  lines.forEach((_, index) => {
    if (!used[index]) walk(index);
  });
  return merged;
}

/**
 * Douglas–Peucker simplification of an open line, in its own units.
 * Always keeps both endpoints.
 * @param {Array<[number, number]>} points
 * @param {number} tolerance
 * @returns {Array<[number, number]>}
 */
export function simplifyLine(points, tolerance) {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const limit = tolerance * tolerance;
  while (stack.length) {
    const [first, last] = stack.pop();
    let worst = -1;
    let worstDistance = limit;
    for (let i = first + 1; i < last; i++) {
      const distance = segmentDistanceSquared(
        points[i],
        points[first],
        points[last],
      );
      if (distance > worstDistance) {
        worst = i;
        worstDistance = distance;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function segmentDistanceSquared([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  let t = lengthSquared ? ((px - ax) * dx + (py - ay) * dy) / lengthSquared : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx - px;
  const y = ay + t * dy - py;
  return x * x + y * y;
}

/** Degrees are stored as integers of this many units (≈1 m at Swedish latitudes). */
export const COORDINATE_SCALE = 1e5;

/**
 * Encode `[lon, lat]` points as one flat integer array: the first point in
 * 1e-5 degree units, every later point as the difference from the previous
 * one. Consecutive duplicates after rounding are dropped.
 * @param {Array<[number, number]>} points
 * @returns {number[]}
 */
export function encodeLine(points) {
  const out = [];
  let lastX = 0;
  let lastY = 0;
  for (const [lon, lat] of points) {
    const x = Math.round(lon * COORDINATE_SCALE);
    const y = Math.round(lat * COORDINATE_SCALE);
    if (out.length && x === lastX && y === lastY) continue;
    out.push(x - lastX, y - lastY);
    lastX = x;
    lastY = y;
  }
  return out;
}

const EARTH_RADIUS_KM = 6371.0088;

/**
 * Length in kilometres of a flat `[lon, lat, …]` degree line (haversine).
 * @param {number[]} flat
 */
export function lineLengthKm(flat) {
  let km = 0;
  for (let i = 2; i < flat.length; i += 2) {
    const lat1 = flat[i - 1] * DEG;
    const lat2 = flat[i + 1] * DEG;
    const h =
      Math.sin((lat2 - lat1) / 2) ** 2 +
      Math.cos(lat1) *
        Math.cos(lat2) *
        Math.sin(((flat[i] - flat[i - 2]) * DEG) / 2) ** 2;
    km += 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  return km;
}

/**
 * Area in km² of a polygon given as flat `[lon, lat, …]` degree rings (the
 * outer ring first, then holes). Uses a local equirectangular projection,
 * accurate to well under a percent for areas the size of a firing range.
 * @param {number[][]} rings
 */
export function polygonAreaKm2(rings) {
  let total = 0;
  rings.forEach((flat, index) => {
    if (flat.length < 6) return;
    const kmPerLon =
      ((Math.PI * EARTH_RADIUS_KM) / 180) * Math.cos(flat[1] * DEG);
    const kmPerLat = (Math.PI * EARTH_RADIUS_KM) / 180;
    let twice = 0;
    for (let i = 0; i < flat.length; i += 2) {
      const j = (i + 2) % flat.length;
      twice +=
        flat[i] * kmPerLon * (flat[j + 1] * kmPerLat) -
        flat[j] * kmPerLon * (flat[i + 1] * kmPerLat);
    }
    const area = Math.abs(twice) / 2;
    total += index === 0 ? area : -area;
  });
  return Math.max(0, total);
}

/**
 * Decode `encodeLine` output back to flat `[lon, lat, lon, lat, …]` degrees.
 * @param {number[]} encoded
 * @returns {number[]}
 */
export function decodeLine(encoded) {
  const out = new Array(encoded.length);
  let x = 0;
  let y = 0;
  for (let i = 0; i < encoded.length; i += 2) {
    x += encoded[i];
    y += encoded[i + 1];
    out[i] = x / COORDINATE_SCALE;
    out[i + 1] = y / COORDINATE_SCALE;
  }
  return out;
}
