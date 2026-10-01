#!/usr/bin/env node
/**
 * Build terrain relief (hillshade) tiles for the sites in
 * src/layers/lantmateriet/relief.js from Lantmäteriet's Markhöjdmodell
 * (1 m ground elevation from laser scanning, CC BY 4.0).
 *
 * For each site it searches Lantmäteriet's STAC catalogue
 * (api.lantmateriet.se/stac-hojd/v1) for the 2.5 km elevation tiles, reads
 * only the overview it needs from each cloud-optimized GeoTIFF on
 * dl1.lantmateriet.se (HTTP range requests), mosaics them in SWEREF 99 TM,
 * shades the mosaic and writes 256 px web-mercator PNG tiles to
 * public/lantmateriet-hillshade/<site>/<z>/<x>/<y>.png plus a manifest.
 *
 * Usage:
 *   node scripts/build-lantmateriet-hillshade.mjs [--site <id>]…
 *
 * Downloads need LANTMATERIET_USERNAME and LANTMATERIET_PASSWORD for a
 * Geotorget account that has ordered Markhöjdmodell Nedladdning (free).
 * Mosaics are cached in .gev-cache/lantmateriet-hillshade/. Requires
 * Node 24.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { fromUrl } from 'geotiff';
import {
  sweref99tmToWgs84,
  wgs84ToSweref99tm,
} from '../src/layers/lantmateriet/geometry.js';
import {
  RELIEF_MANIFEST_FORMAT,
  RELIEF_MIN_ZOOM,
  RELIEF_PALETTE,
  RELIEF_SITES,
  RELIEF_TILE_SIZE,
  hillshade,
  pixelToLat,
  pixelToLon,
  reliefIndex,
  siteTileRange,
} from '../src/layers/lantmateriet/relief.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'lantmateriet-hillshade');
const CACHE_DIR = path.join(ROOT, '.gev-cache', 'lantmateriet-hillshade');
const STAC = 'https://api.lantmateriet.se/stac-hojd/v1/search';
const NODATA = -9999;
// The overview whose cell size fits each maximum zoom.
const RESOLUTION_FOR_ZOOM = { 15: 2, 14: 4 };
const PAD_M = 200;

function authHeader() {
  const user = process.env.LANTMATERIET_USERNAME;
  const password = process.env.LANTMATERIET_PASSWORD;
  if (!user || !password)
    throw new Error(
      'Set LANTMATERIET_USERNAME and LANTMATERIET_PASSWORD (a Geotorget account with Markhöjdmodell Nedladdning ordered)',
    );
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

/** Every elevation tile intersecting a WGS84 box, newest first per tile. */
async function searchTiles(site) {
  const items = new Map();
  let next = {
    url: STAC,
    method: 'POST',
    body: {
      bbox: [site.west, site.south, site.east, site.north],
      limit: 200,
    },
  };
  for (let page = 0; next && page < 50; page++) {
    const response = await fetch(next.url, {
      method: next.method,
      ...(next.method === 'POST'
        ? {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(next.body),
          }
        : {}),
    });
    if (!response.ok) throw new Error(`STAC search: HTTP ${response.status}`);
    const result = await response.json();
    for (const feature of result.features ?? []) {
      if (!feature.collection?.startsWith('mhm-')) continue;
      const href = feature.assets?.data?.href;
      const date = feature.properties?.datetime ?? '';
      const previous = items.get(feature.id);
      if (href && (!previous || previous.date < date))
        items.set(feature.id, { id: feature.id, href, date });
    }
    // STAC next links are either GET URLs or POST bodies to resend.
    const link = result.links?.find((l) => l.rel === 'next');
    next = link
      ? link.method === 'POST' || link.body
        ? {
            url: link.href,
            method: 'POST',
            body: link.merge ? { ...next.body, ...link.body } : link.body,
          }
        : { url: link.href, method: 'GET' }
      : null;
  }
  return [...items.values()];
}

/** The site box in SWEREF 99 TM metres, padded and snapped to `res`. */
function sweref99Box(site, res) {
  const corners = [
    [site.west, site.south],
    [site.west, site.north],
    [site.east, site.south],
    [site.east, site.north],
  ].map(([lon, lat]) => wgs84ToSweref99tm(lon, lat));
  const snap = (value, up) => (up ? Math.ceil : Math.floor)(value / res) * res;
  return {
    e0: snap(Math.min(...corners.map((c) => c[0])) - PAD_M, false),
    e1: snap(Math.max(...corners.map((c) => c[0])) + PAD_M, true),
    n0: snap(Math.min(...corners.map((c) => c[1])) - PAD_M, false),
    n1: snap(Math.max(...corners.map((c) => c[1])) + PAD_M, true),
  };
}

async function mapLimit(items, limit, fn) {
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) await fn(items[index++]);
    }),
  );
}

/** Mosaic a site's elevation at `res` metres; rows run north to south. */
async function buildMosaic(site, res) {
  const cachePath = path.join(CACHE_DIR, `${site.id}-${res}m.f32`);
  const box = sweref99Box(site, res);
  const width = (box.e1 - box.e0) / res;
  const height = (box.n1 - box.n0) / res;
  if (fs.existsSync(cachePath)) {
    const bytes = fs.readFileSync(cachePath);
    if (bytes.length === width * height * 4) {
      console.log(`${site.id}: cached ${width}×${height} mosaic`);
      // Copy: a Buffer view need not be aligned for a Float32Array.
      const heights = new Float32Array(width * height);
      new Uint8Array(heights.buffer).set(bytes);
      return { box, width, height, heights };
    }
  }
  const tiles = await searchTiles(site);
  console.log(
    `${site.id}: ${tiles.length} elevation tiles, ${width}×${height} cells at ${res} m`,
  );
  const heights = new Float32Array(width * height).fill(NaN);
  const headers = { Authorization: authHeader() };
  let done = 0;
  await mapLimit(tiles, 4, async (tile) => {
    const tiff = await fromUrl(tile.href, { headers });
    const full = await tiff.getImage(0);
    const [originE, originN] = full.getOrigin();
    const fullRes = full.getResolution()[0];
    // Pick the overview with the requested cell size.
    let image = full;
    for (let i = 1, n = await tiff.getImageCount(); i < n; i++) {
      const candidate = await tiff.getImage(i);
      if ((full.getWidth() / candidate.getWidth()) * fullRes <= res + 1e-6)
        image = candidate;
    }
    const scale = full.getWidth() / image.getWidth();
    const cell = fullRes * scale;
    if (Math.abs(cell - res) > 1e-6)
      throw new Error(`${tile.id}: no ${res} m overview (closest ${cell} m)`);
    // The part of this tile inside the mosaic, in overview pixels.
    const c0 = Math.max(0, Math.floor((box.e0 - originE) / cell));
    const c1 = Math.min(image.getWidth(), Math.ceil((box.e1 - originE) / cell));
    const r0 = Math.max(0, Math.floor((originN - box.n1) / cell));
    const r1 = Math.min(
      image.getHeight(),
      Math.ceil((originN - box.n0) / cell),
    );
    if (c0 >= c1 || r0 >= r1) return;
    const [values] = await image.readRasters({ window: [c0, r0, c1, r1] });
    const windowWidth = c1 - c0;
    for (let r = r0; r < r1; r++) {
      const row = (box.n1 - (originN - r * cell)) / res;
      if (row < 0 || row >= height) continue;
      for (let c = c0; c < c1; c++) {
        const col = (originE + c * cell - box.e0) / res;
        if (col < 0 || col >= width) continue;
        const value = values[(r - r0) * windowWidth + (c - c0)];
        if (value > NODATA + 1) heights[row * width + col] = value;
      }
    }
    done++;
    if (done % 10 === 0 || done === tiles.length)
      console.log(`${site.id}: ${done}/${tiles.length} tiles read`);
  });
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath, Buffer.from(heights.buffer));
  return { box, width, height, heights };
}

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

const PLTE = Buffer.from(
  RELIEF_PALETTE.flatMap(([gray]) => [gray, gray, gray]),
);
const TRNS = Buffer.from(RELIEF_PALETTE.map(([, alpha]) => alpha));

/** Encode 4-bit palette indices (one per byte in `indices`) as PNG. */
function encodeIndexedPng(indices, size) {
  const stride = size / 2;
  const packed = new Uint8Array(stride * size);
  for (let i = 0; i < indices.length; i += 2)
    packed[i / 2] = (indices[i] << 4) | indices[i + 1];
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    // Filter "up": consecutive rows of shading are strongly alike.
    raw[y * (stride + 1)] = 2;
    for (let x = 0; x < stride; x++) {
      const above = y ? packed[(y - 1) * stride + x] : 0;
      raw[y * (stride + 1) + 1 + x] = (packed[y * stride + x] - above) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 4; // bit depth
  header[9] = 3; // palette
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('PLTE', PLTE),
    pngChunk('tRNS', TRNS),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Bilinear sample of the shade grid at fractional cell coordinates. */
function sample(shade, width, height, col, row) {
  const c = Math.floor(col);
  const r = Math.floor(row);
  if (c < 0 || r < 0 || c + 1 >= width || r + 1 >= height) return NaN;
  const fx = col - c;
  const fy = row - r;
  const i = r * width + c;
  return (
    shade[i] * (1 - fx) * (1 - fy) +
    shade[i + 1] * fx * (1 - fy) +
    shade[i + width] * (1 - fx) * fy +
    shade[i + width + 1] * fx * fy
  );
}

/** Render one web-mercator tile; null when it is wholly transparent. */
function renderTile(mosaic, shade, res, z, x, y) {
  const size = RELIEF_TILE_SIZE;
  const indices = new Uint8Array(size * size);
  // Project a coarse control grid exactly and interpolate between its
  // points; within 16 px the error is far below a centimetre.
  const STEP = 16;
  const grid = [];
  for (let gy = 0; gy <= size; gy += STEP)
    for (let gx = 0; gx <= size; gx += STEP) {
      const lon = pixelToLon(x * size + gx, z);
      const lat = pixelToLat(y * size + gy, z);
      grid.push(wgs84ToSweref99tm(lon, lat));
    }
  const per = size / STEP + 1;
  let any = false;
  for (let py = 0; py < size; py++) {
    const gy = Math.floor((py + 0.5) / STEP);
    const fy = (py + 0.5) / STEP - gy;
    for (let px = 0; px < size; px++) {
      const gx = Math.floor((px + 0.5) / STEP);
      const fx = (px + 0.5) / STEP - gx;
      const p00 = grid[gy * per + gx];
      const p10 = grid[gy * per + gx + 1];
      const p01 = grid[(gy + 1) * per + gx];
      const p11 = grid[(gy + 1) * per + gx + 1];
      const e =
        p00[0] * (1 - fx) * (1 - fy) +
        p10[0] * fx * (1 - fy) +
        p01[0] * (1 - fx) * fy +
        p11[0] * fx * fy;
      const n =
        p00[1] * (1 - fx) * (1 - fy) +
        p10[1] * fx * (1 - fy) +
        p01[1] * (1 - fx) * fy +
        p11[1] * fx * fy;
      // Cell centres sit half a cell in from the mosaic edge.
      const col = (e - mosaic.box.e0) / res - 0.5;
      const row = (mosaic.box.n1 - n) / res - 0.5;
      const index = reliefIndex(
        sample(shade, mosaic.width, mosaic.height, col, row),
      );
      indices[py * size + px] = index;
      if (index) any = true;
    }
  }
  return any ? encodeIndexedPng(indices, size) : null;
}

/** A fully transparent tile, written where a site has no relief. */
const EMPTY_TILE = encodeIndexedPng(
  new Uint8Array(RELIEF_TILE_SIZE * RELIEF_TILE_SIZE),
  RELIEF_TILE_SIZE,
);

async function buildSite(site) {
  const res = RESOLUTION_FOR_ZOOM[site.maxZoom];
  if (!res)
    throw new Error(`${site.id}: no resolution for zoom ${site.maxZoom}`);
  const mosaic = await buildMosaic(site, res);
  const valid = mosaic.heights.reduce(
    (n, v) => n + (Number.isNaN(v) ? 0 : 1),
    0,
  );
  if (!valid) throw new Error(`${site.id}: no elevation data found`);
  const shade = hillshade(mosaic.heights, mosaic.width, mosaic.height, res, {
    zFactor: site.exaggeration ?? 1,
  });
  const siteDir = path.join(OUT_DIR, site.id);
  fs.rmSync(siteDir, { recursive: true, force: true });
  let tiles = 0;
  let bytes = 0;
  for (let z = RELIEF_MIN_ZOOM; z <= site.maxZoom; z++) {
    const { x0, x1, y0, y1 } = siteTileRange(site, z);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const png = renderTile(mosaic, shade, res, z, x, y) ?? EMPTY_TILE;
        const file = path.join(siteDir, String(z), String(x), `${y}.png`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, png);
        tiles++;
        bytes += png.length;
      }
  }
  const [lonA, latA] = sweref99tmToWgs84(mosaic.box.e0, mosaic.box.n0);
  console.log(
    `${site.id}: ${tiles} tiles, ${(bytes / 1048576).toFixed(1)} MB (${((valid / mosaic.heights.length) * 100).toFixed(0)}% with data, SW ${lonA.toFixed(3)} ${latA.toFixed(3)})`,
  );
  return { tiles, bytes };
}

async function main() {
  const wanted = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--site') wanted.push(argv[++i]);
    else throw new Error(`Unknown argument ${argv[i]}`);
  }
  const sites = wanted.length
    ? RELIEF_SITES.filter((site) => wanted.includes(site.id))
    : RELIEF_SITES;
  if (wanted.length && sites.length !== wanted.length)
    throw new Error(`Unknown site in ${wanted.join(', ')}`);
  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  const previous = fs.existsSync(manifestPath)
    ? (JSON.parse(fs.readFileSync(manifestPath, 'utf8')).sites ?? [])
    : [];
  const built = new Map(previous.map((site) => [site.id, site]));
  const today = new Date().toISOString().slice(0, 10);
  let total = 0;
  for (const site of sites) {
    const { bytes } = await buildSite(site);
    total += bytes;
    built.set(site.id, {
      id: site.id,
      name: site.name,
      west: site.west,
      south: site.south,
      east: site.east,
      north: site.north,
      minZoom: RELIEF_MIN_ZOOM,
      maxZoom: site.maxZoom,
      producedAt: today,
    });
  }
  // Keep the configured order; drop sites no longer configured.
  const manifest = {
    format: RELIEF_MANIFEST_FORMAT,
    source: 'Lantmäteriet, Markhöjdmodell Nedladdning (1 m grid)',
    license: 'CC BY 4.0',
    attribution: '© Lantmäteriet',
    builtAt: today,
    sites: RELIEF_SITES.map((site) => built.get(site.id)).filter(Boolean),
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${(total / 1048576).toFixed(1)} MB of tiles`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
