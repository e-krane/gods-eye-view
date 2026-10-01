/**
 * Terrain relief (hillshade) from Lantmäteriet's Markhöjdmodell, for a few
 * chosen sites. Pure helpers shared by `scripts/build-lantmateriet-hillshade.mjs`
 * (which renders the tiles) and the browser layer (which validates the
 * manifest). No Node, browser or Cesium globals.
 */

export const RELIEF_MANIFEST_FORMAT = 'gev-relief-sites/1';

/**
 * The sites rendered. Boxes are WGS84 degrees. `maxZoom` 15 is about 2 m per
 * pixel in Sweden (built from the 2 m overview); 14 is about 4 m, enough
 * for mountain relief. `exaggeration` scales heights before shading, so
 * low ridges, ditches and earthworks show on flat lowland ground.
 */
export const RELIEF_SITES = Object.freeze([
  Object.freeze({
    id: 'revingehed',
    name: 'Revingehed',
    west: 13.38,
    south: 55.645,
    east: 13.535,
    north: 55.745,
    maxZoom: 15,
    exaggeration: 3,
  }),
  Object.freeze({
    id: 'skillingaryd',
    name: 'Skillingaryd',
    west: 14.09,
    south: 57.37,
    east: 14.18,
    north: 57.49,
    maxZoom: 15,
    exaggeration: 3,
  }),
  Object.freeze({
    id: 'tofta',
    name: 'Tofta, Gotland',
    west: 18.02,
    south: 57.46,
    east: 18.24,
    north: 57.6,
    maxZoom: 15,
    exaggeration: 3,
  }),
  Object.freeze({
    id: 'vidsel',
    name: 'Vidsel airbase',
    west: 20.05,
    south: 65.84,
    east: 20.25,
    north: 65.92,
    maxZoom: 15,
    exaggeration: 3,
  }),
  Object.freeze({
    id: 'hemavan',
    name: 'Hemavan',
    west: 14.95,
    south: 65.76,
    east: 15.25,
    north: 65.88,
    maxZoom: 14,
    exaggeration: 1.5,
  }),
  Object.freeze({
    id: 'mierkenis',
    name: 'Mierkenis (Merkenes)',
    west: 15.98,
    south: 66.63,
    east: 16.24,
    north: 66.73,
    maxZoom: 14,
    exaggeration: 1.5,
  }),
]);

/** Tiles below this zoom are not rendered; the layer shows from here down. */
export const RELIEF_MIN_ZOOM = 11;
export const RELIEF_TILE_SIZE = 256;

const DEG = Math.PI / 180;

/** Web-mercator tile x for a longitude at zoom `z`. */
export function lonToTileX(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

/** Web-mercator tile y for a latitude at zoom `z`. */
export function latToTileY(lat, z) {
  const r = lat * DEG;
  return Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z,
  );
}

/** Longitude of a fractional global pixel column at zoom `z`. */
export function pixelToLon(px, z, tileSize = RELIEF_TILE_SIZE) {
  return (px / (tileSize * 2 ** z)) * 360 - 180;
}

/** Latitude of a fractional global pixel row at zoom `z`. */
export function pixelToLat(py, z, tileSize = RELIEF_TILE_SIZE) {
  const n = Math.PI - (2 * Math.PI * py) / (tileSize * 2 ** z);
  return Math.atan(Math.sinh(n)) / DEG;
}

/** Inclusive tile ranges covering a site box at zoom `z`. */
export function siteTileRange(site, z) {
  return {
    x0: lonToTileX(site.west, z),
    x1: lonToTileX(site.east, z),
    y0: latToTileY(site.north, z),
    y1: latToTileY(site.south, z),
  };
}

/**
 * Light directions (azimuth clockwise from north, degrees) and weights. A
 * north-west key light with three softer fills, so ridges and ditches read
 * whatever their orientation.
 */
export const RELIEF_LIGHTS = Object.freeze([
  Object.freeze({ azimuth: 315, weight: 0.4 }),
  Object.freeze({ azimuth: 225, weight: 0.2 }),
  Object.freeze({ azimuth: 270, weight: 0.2 }),
  Object.freeze({ azimuth: 360, weight: 0.2 }),
]);
export const RELIEF_ALTITUDE = 45;

/**
 * Hillshade of an elevation grid (rows run north to south, `NaN` = no data)
 * by Horn's method with the lights above. Returns 0–1 illumination, `NaN`
 * where any neighbour lacks data. A flat surface scores sin(altitude).
 * @param {Float32Array} heights
 * @param {number} width
 * @param {number} height
 * @param {number} resolution Metres per cell.
 * @param {{ zFactor?: number }} [options]
 * @returns {Float32Array}
 */
export function hillshade(
  heights,
  width,
  height,
  resolution,
  { zFactor = 1 } = {},
) {
  const out = new Float32Array(width * height).fill(NaN);
  const alt = RELIEF_ALTITUDE * DEG;
  const lights = RELIEF_LIGHTS.map(({ azimuth, weight }) => ({
    x: Math.sin(azimuth * DEG) * Math.cos(alt) * weight,
    y: Math.cos(azimuth * DEG) * Math.cos(alt) * weight,
    z: Math.sin(alt) * weight,
  }));
  const scale = zFactor / (8 * resolution);
  for (let row = 1; row < height - 1; row++) {
    for (let col = 1; col < width - 1; col++) {
      const i = row * width + col;
      const a = heights[i - width - 1];
      const b = heights[i - width];
      const c = heights[i - width + 1];
      const d = heights[i - 1];
      const f = heights[i + 1];
      const g = heights[i + width - 1];
      const h = heights[i + width];
      const k = heights[i + width + 1];
      // NaN propagates, so a cell next to missing data stays NaN.
      const east = (c + 2 * f + k - (a + 2 * d + g)) * scale;
      // Rows run south, so the northward gradient is top minus bottom.
      const north = (a + 2 * b + c - (g + 2 * h + k)) * scale;
      if (Number.isNaN(east) || Number.isNaN(north)) continue;
      const norm = Math.hypot(east, north, 1);
      let sum = 0;
      for (const light of lights)
        sum += Math.max(
          0,
          (-east * light.x - north * light.y + light.z) / norm,
        );
      out[i] = sum;
    }
  }
  return out;
}

const SHADOW_LEVELS = 10;
const HIGHLIGHT_LEVELS = 5;
const MAX_SHADOW_ALPHA = 0.78;
const MAX_HIGHLIGHT_ALPHA = 0.5;
const CONTRAST = 1.6;

/**
 * The 16-colour palette of relief tiles: index 0 is clear, 1–10 are
 * increasingly dark translucent black, 11–15 increasingly bright
 * translucent white. Four bits per pixel keep the tiles small.
 * @type {ReadonlyArray<readonly [number, number]>} `[gray, alpha]`, 0–255.
 */
export const RELIEF_PALETTE = Object.freeze([
  Object.freeze([0, 0]),
  ...Array.from({ length: SHADOW_LEVELS }, (_, i) =>
    Object.freeze([
      0,
      Math.round(((i + 1) / SHADOW_LEVELS) * MAX_SHADOW_ALPHA * 255),
    ]),
  ),
  ...Array.from({ length: HIGHLIGHT_LEVELS }, (_, i) =>
    Object.freeze([
      255,
      Math.round(((i + 1) / HIGHLIGHT_LEVELS) * MAX_HIGHLIGHT_ALPHA * 255),
    ]),
  ),
]);

/**
 * Palette index for one illumination value: darker than flat ground
 * becomes a shadow level, brighter a highlight level, flat ground (or no
 * data) stays clear.
 * @param {number} shade 0–1, or NaN for no data.
 * @returns {number} 0–15.
 */
export function reliefIndex(shade) {
  if (!Number.isFinite(shade)) return 0;
  const delta = (shade - Math.sin(RELIEF_ALTITUDE * DEG)) * CONTRAST;
  if (delta < 0)
    return Math.round(
      (Math.min(MAX_SHADOW_ALPHA, -delta) / MAX_SHADOW_ALPHA) * SHADOW_LEVELS,
    );
  const level = Math.round(
    (Math.min(MAX_HIGHLIGHT_ALPHA, delta) / MAX_HIGHLIGHT_ALPHA) *
      HIGHLIGHT_LEVELS,
  );
  return level ? SHADOW_LEVELS + level : 0;
}

/**
 * Validate the relief manifest the build script writes. Returns null when
 * it is malformed.
 * @param {unknown} json
 */
export function validateReliefManifest(json) {
  if (
    !json ||
    json.format !== RELIEF_MANIFEST_FORMAT ||
    typeof json.builtAt !== 'string' ||
    !Array.isArray(json.sites) ||
    !json.sites.length
  )
    return null;
  for (const site of json.sites) {
    if (
      !site ||
      typeof site.id !== 'string' ||
      !/^[a-z0-9-]+$/.test(site.id) ||
      typeof site.name !== 'string' ||
      ![site.west, site.south, site.east, site.north].every(Number.isFinite) ||
      !(site.west < site.east && site.south < site.north) ||
      Math.abs(site.west) > 180 ||
      Math.abs(site.north) > 85 ||
      !Number.isInteger(site.minZoom) ||
      !Number.isInteger(site.maxZoom) ||
      site.minZoom > site.maxZoom ||
      site.maxZoom > 18 ||
      typeof site.producedAt !== 'string'
    )
      return null;
  }
  return json;
}
