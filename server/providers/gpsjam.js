import { cellToBoundary, isValidCell } from 'h3-js';
import {
  interferenceCells,
  parseGpsjamCells,
  parseGpsjamManifest,
} from '../../src/layers/gnss/records.js';
import { readResponseTextCapped, coalesceProxyRequest } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';

/**
 * GPSJam proxy for the GNSS Interference layer.
 * Upstream: https://gpsjam.org/data/manifest.csv lists each UTC day (and
 * flags incomplete ones as `suspect`); `YYYY-MM-DD-h3_4.csv` holds that day's
 * aircraft counts per H3 resolution-4 hexagon. GPSJam sends no CORS headers,
 * and the browser would need h3-js to draw hexagons, so this proxy fetches the
 * latest day, keeps the medium and high hexagons, and adds their boundaries.
 *
 * Routes:
 *   GET /api/gpsjam/latest → {date, suspect, fetchedAt, stale, totalCells, count, cells}
 *
 * Keyless. The manifest is re-read at most once an hour (GPSJam publishes
 * once a day, soon after midnight UTC) and each day's file is fetched once.
 * A failure is remembered for ten minutes; meanwhile the last good day is
 * served marked stale, else 502 {error:'gpsjam_unavailable'}.
 * Data: GPSJam (John Wiseman), from airplanes.live and ADS-B Exchange.
 */
const DATA_URL = 'https://gpsjam.org/data';
const MANIFEST_TTL_MS = 60 * 60_000;
const FAILURE_BACKOFF_MS = 10 * 60_000;
const UPSTREAM_TIMEOUT_MS = 30_000;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_DAY_BYTES = 16 * 1024 * 1024;

const round = (value) => Math.round(value * 1e4) / 1e4;

/**
 * Boundary of one H3 cell as an open `[lon, lat]` ring. A ring that crosses
 * the antimeridian has its western longitudes shifted by 360 so it stays one
 * contiguous hexagon instead of wrapping around the globe.
 * @param {string} hex
 * @returns {Array<[number, number]>|null}
 */
export function gpsjamCellBoundary(hex) {
  if (!isValidCell(hex)) return null;
  const ring = cellToBoundary(hex, true).slice(0, -1);
  const lons = ring.map(([lon]) => lon);
  const wraps = Math.max(...lons) - Math.min(...lons) > 180;
  return ring.map(([lon, lat]) => [
    round(wraps && lon < 0 ? lon + 360 : lon),
    round(lat),
  ]);
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {() => number} [options.now]
 * @returns {import('vite').Plugin}
 */
export function gpsjamProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  /** @type {?{date: string, suspect: boolean, fetchedAt: number, totalCells: number, cells: Array<object>}} */
  let snapshot = null;
  let checkedAt = 0;
  /** @type {?{at: number, error: Error}} */
  let failure = null;
  const inFlight = new Map();
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 1200 });

  async function fetchText(url, maxBytes) {
    const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
    const response = await fetchImpl(url, {
      headers: { Accept: 'text/csv' },
      signal,
      redirect: 'error',
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new Error(`GPSJam HTTP ${response.status}`);
    }
    return readResponseTextCapped(response, maxBytes, signal);
  }

  async function refresh() {
    const days = parseGpsjamManifest(
      await fetchText(`${DATA_URL}/manifest.csv`, MAX_MANIFEST_BYTES),
    );
    if (!days) throw new Error('invalid_manifest');
    const latest = days[days.length - 1];
    if (snapshot?.date === latest.date && snapshot.suspect === latest.suspect)
      return snapshot;
    const cells = parseGpsjamCells(
      await fetchText(`${DATA_URL}/${latest.date}-h3_4.csv`, MAX_DAY_BYTES),
    );
    if (!cells) throw new Error('invalid_day');
    const published = [];
    for (const cell of interferenceCells(cells)) {
      const boundary = gpsjamCellBoundary(cell.hex);
      if (boundary) published.push({ ...cell, boundary });
    }
    return {
      date: latest.date,
      suspect: latest.suspect,
      fetchedAt: now(),
      totalCells: cells.length,
      cells: published,
    };
  }

  async function acquire() {
    if (snapshot && now() - checkedAt < MANIFEST_TTL_MS)
      return { value: snapshot, stale: false };
    if (failure && now() - failure.at < FAILURE_BACKOFF_MS) {
      if (snapshot) return { value: snapshot, stale: true };
      throw failure.error;
    }
    try {
      const { promise } = coalesceProxyRequest(inFlight, 'latest', async () => {
        const value = await refresh();
        snapshot = value;
        checkedAt = now();
        failure = null;
        return value;
      });
      return { value: await promise, stale: false };
    } catch (error) {
      failure = { at: now(), error };
      if (snapshot) return { value: snapshot, stale: true };
      throw error;
    }
  }

  async function handler(req, res) {
    const json = (status, value) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(status === 405 ? { Allow: 'GET' } : {}),
        ...(status === 429 ? { 'Retry-After': '60' } : {}),
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    const path = (req.url || '/').split('?')[0];
    if (path !== '/latest') return json(404, { error: 'unknown_route' });
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    try {
      const { value, stale } = await acquire();
      json(200, { ...value, count: value.cells.length, stale });
    } catch (error) {
      console.warn('[gpsjam] upstream failed:', error?.message || error);
      json(502, { error: 'gpsjam_unavailable' });
    }
  }

  return {
    name: 'gpsjam',
    configureServer({ middlewares }) {
      middlewares.use('/api/gpsjam', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/gpsjam', handler);
    },
  };
}
