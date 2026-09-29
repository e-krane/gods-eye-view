import { createHash } from 'node:crypto';
import {
  normalizeTrafikverketSituations,
  TRAFIKVERKET_INCIDENT_TYPES,
  TRAFIKVERKET_NOTICE_TYPE,
  TRAFIKVERKET_ROADWORK_TYPE,
} from '../../src/layers/trafikverket/records.js';
import { readResponseJsonCapped, coalesceProxyRequest } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';

/**
 * Trafikverket open API proxy for the Road Incidents layer.
 * Upstream: POST https://api.trafikinfo.trafikverket.se/v2/data.json with an
 * XML query (Situation, namespace Road.TrafficInfo, schema 1.6). The API key
 * travels in the request body, so it stays server-side; the browser only sees
 * compact normalized rows.
 *
 * Routes:
 *   GET /api/trafikverket/incidents → {fetchedAt, stale, count, rows}
 *
 * Keyless (no TRAFIKVERKET_API_KEY): 503 {error:'no_key'}; upstream is never
 * touched. A rejected key answers 502 {error:'auth_failed'} and never serves
 * cached rows fetched with an earlier key. Other upstream failures serve the
 * last good snapshot marked stale, else 502 {error:'trafikverket_unavailable'}.
 * Upstream is called at most once per TTL per key: successes are cached and
 * failures are remembered for the same window, so a revoked key or an outage
 * never turns client polling into repeated upstream calls.
 * Data: CC0 (https://data.trafikverket.se/).
 */
const API_URL = 'https://api.trafikinfo.trafikverket.se/v2/data.json';
const TTL_MS = 120_000;
const UPSTREAM_TIMEOUT_MS = 30_000;
const MAX_UPSTREAM_BYTES = 48 * 1024 * 1024;

const INCLUDE_FIELDS = Object.freeze([
  'Id',
  'Deleted',
  'Deviation.Id',
  'Deviation.MessageType',
  'Deviation.MessageCode',
  'Deviation.Header',
  'Deviation.Message',
  'Deviation.SeverityCode',
  'Deviation.SeverityText',
  'Deviation.RoadNumber',
  'Deviation.LocationDescriptor',
  'Deviation.StartTime',
  'Deviation.EndTime',
  'Deviation.ValidUntilFurtherNotice',
  'Deviation.Geometry.Point.WGS84',
  'Deviation.Geometry.Line.WGS84',
]);

/** Incident types that qualify a situation on their own. */
const DIRECT_INCIDENT_TYPES = Object.freeze(
  Object.keys(TRAFIKVERKET_INCIDENT_TYPES).filter(
    (type) => type !== TRAFIKVERKET_NOTICE_TYPE,
  ),
);

function xmlAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build the Situation query. `Situation` lives in the `Road.TrafficInfo`
 * namespace and is only served at schema 1.6: without the namespace or with a
 * retired version the API answers 400 (SOURCE 'Request'), as it does for an
 * unknown field, so INCLUDE_FIELDS must follow the 1.6 model.
 *
 * Filters select whole situations, not individual deviations: a match on
 * `Deviation.*` is true when any deviation matches, and `NOT` means none
 * does. A situation qualifies when it has a direct incident type, or a
 * traffic message and no roadworks. Most traffic messages belong to
 * roadworks, so this keeps the response to tens of kilobytes instead of
 * megabytes. The normalizer drops the deviations that ride along.
 * @param {string} apiKey
 * @returns {string}
 */
export function trafikverketIncidentQuery(apiKey) {
  const include = INCLUDE_FIELDS.map(
    (field) => `<INCLUDE>${field}</INCLUDE>`,
  ).join('');
  return (
    '<REQUEST>' +
    `<LOGIN authenticationkey="${xmlAttribute(apiKey)}" />` +
    '<QUERY objecttype="Situation" namespace="Road.TrafficInfo" schemaversion="1.6">' +
    '<FILTER><OR>' +
    `<IN name="Deviation.MessageType" value="${xmlAttribute(DIRECT_INCIDENT_TYPES.join(','))}" />` +
    '<AND>' +
    `<EQ name="Deviation.MessageType" value="${xmlAttribute(TRAFIKVERKET_NOTICE_TYPE)}" />` +
    `<NOT><EQ name="Deviation.MessageType" value="${xmlAttribute(TRAFIKVERKET_ROADWORK_TYPE)}" /></NOT>` +
    '</AND>' +
    '</OR></FILTER>' +
    include +
    '</QUERY>' +
    '</REQUEST>'
  );
}

function upstreamError(payload) {
  const error = payload?.RESPONSE?.RESULT?.[0]?.ERROR;
  return error && typeof error === 'object' ? error : null;
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {() => number} [options.now]
 * @param {() => string} [options.apiKey] Reads the key per request, so a key
 *   saved through Provider Settings applies without a restart.
 * @returns {import('vite').Plugin}
 */
export function trafikverketProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  apiKey = () => String(process.env.TRAFIKVERKET_API_KEY || '').trim(),
} = {}) {
  /** @type {?{keyId: string, savedAt: number, value: object}} */
  let cached = null;
  /** @type {?{keyId: string, at: number, error: Error}} */
  let failure = null;
  const inFlight = new Map();
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 1200 });

  const keyId = (key) =>
    createHash('sha256').update(key).digest('hex').slice(0, 16);

  async function fetchIncidents(key) {
    const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
    const response = await fetchImpl(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml', Accept: 'application/json' },
      body: trafikverketIncidentQuery(key),
      signal,
      redirect: 'error',
    });
    let payload = null;
    try {
      payload = await readResponseJsonCapped(
        response,
        MAX_UPSTREAM_BYTES,
        signal,
      );
    } catch (error) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError')
        throw error;
      /* status below remains authoritative */
    }
    const failure = upstreamError(payload);
    if (
      response.status === 401 ||
      response.status === 403 ||
      failure?.SOURCE === 'Security'
    )
      throw Object.assign(new Error('auth_failed'), { code: 'auth_failed' });
    if (!response.ok || failure) throw new Error('upstream_unavailable');
    const rows = normalizeTrafikverketSituations(payload, { now: now() });
    if (!rows) throw new Error('invalid_snapshot');
    return { fetchedAt: now(), count: rows.length, rows };
  }

  async function acquire(key) {
    const id = keyId(key);
    const previous = cached?.keyId === id ? cached : null;
    if (previous && now() - previous.savedAt < TTL_MS)
      return { value: previous.value, stale: false };
    if (failure?.keyId === id && now() - failure.at < TTL_MS) {
      if (previous) return { value: previous.value, stale: true };
      throw failure.error;
    }
    try {
      const { promise } = coalesceProxyRequest(inFlight, id, async () => {
        const value = await fetchIncidents(key);
        cached = { keyId: id, savedAt: now(), value };
        failure = null;
        return value;
      });
      return { value: await promise, stale: false };
    } catch (error) {
      failure = { keyId: id, at: now(), error };
      if (error?.code === 'auth_failed') {
        if (cached?.keyId === id) cached = null;
        throw error;
      }
      if (previous) return { value: previous.value, stale: true };
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
    if (path !== '/incidents') return json(404, { error: 'unknown_route' });
    const key = apiKey();
    if (!key) return json(503, { error: 'no_key' });
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    try {
      const { value, stale } = await acquire(key);
      json(200, { ...value, stale });
    } catch (error) {
      json(502, {
        error:
          error?.code === 'auth_failed'
            ? 'auth_failed'
            : 'trafikverket_unavailable',
      });
    }
  }

  return {
    name: 'trafikverket',
    configureServer({ middlewares }) {
      middlewares.use('/api/trafikverket', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/trafikverket', handler);
    },
  };
}
