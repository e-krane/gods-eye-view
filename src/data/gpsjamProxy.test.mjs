import test from 'node:test';
import assert from 'node:assert/strict';
import { latLngToCell } from 'h3-js';
import {
  gpsjamCellBoundary,
  gpsjamProxy,
} from '../../server/providers/gpsjam.js';

const NOW = Date.parse('2026-09-30T06:00:00Z');
const HOUR = 60 * 60_000;
const BALTIC = latLngToCell(59.4, 24.7, 4);

const manifest = (...days) =>
  'date,suspect,num_bad_aircraft_hexes,source\n' +
  days
    .map(([date, suspect = false]) => `${date},${suspect},1,merged`)
    .join('\n');
const day = (rows) =>
  'hex,count_good_aircraft,count_bad_aircraft\n' +
  rows.map((row) => row.join(',')).join('\n');

const text = (body, status = 200) => new Response(body, { status });

function install(options) {
  let handler;
  const plugin = gpsjamProxy(options);
  for (const hook of ['configureServer', 'configurePreviewServer']) {
    plugin[hook]({
      middlewares: {
        use(path, callback) {
          assert.equal(path, '/api/gpsjam');
          handler = callback;
        },
      },
    });
  }
  return async (url = '/latest', method = 'GET') => {
    const res = {
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      end(body) {
        this.body = JSON.parse(body);
      },
    };
    await handler({ url, method, socket: { remoteAddress: 'local' } }, res);
    return res;
  };
}

/** A fake GPSJam: `days` maps a date to its CSV; `fail` breaks everything. */
function upstream(state) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url.replace('https://gpsjam.org/data/', ''));
    if (state.fail) return text('down', 503);
    if (url.endsWith('/manifest.csv')) return text(manifest(...state.manifest));
    const date = url.match(/(\d{4}-\d{2}-\d{2})-h3_4\.csv$/)?.[1];
    return state.days[date] ? text(state.days[date]) : text('missing', 404);
  };
  return { calls, fetchImpl };
}

test('hexagon boundaries are open rings, unwrapped across the antimeridian', () => {
  const ring = gpsjamCellBoundary(BALTIC);
  assert.ok(ring.length === 6);
  assert.ok(
    ring.every(([lon, lat]) => lon > 23 && lon < 27 && lat > 58 && lat < 61),
  );
  const dateline = latLngToCell(0, 179.95, 4);
  const lons = gpsjamCellBoundary(dateline).map(([lon]) => lon);
  assert.ok(Math.max(...lons) - Math.min(...lons) < 5, lons.join(','));
  assert.ok(lons.some((lon) => lon > 180));
  assert.equal(gpsjamCellBoundary('8400000ffffffff0'), null);
});

test('latest day is fetched once, filtered to medium and high, then served from memory', async () => {
  let clock = NOW;
  const state = {
    manifest: [['2026-09-28'], ['2026-09-29']],
    days: {
      '2026-09-29': day([
        [BALTIC, 40, 11],
        [latLngToCell(55.7, 12.6, 4), 98, 2],
        [latLngToCell(54.7, 20.5, 4), 90, 10],
      ]),
    },
  };
  const { calls, fetchImpl } = upstream(state);
  const request = install({ fetchImpl, now: () => clock });

  const res = await request();
  assert.equal(res.status, 200);
  assert.deepEqual(calls, ['manifest.csv', '2026-09-29-h3_4.csv']);
  assert.equal(res.body.date, '2026-09-29');
  assert.equal(res.body.suspect, false);
  assert.equal(res.body.stale, false);
  assert.equal(res.body.totalCells, 3);
  assert.equal(res.body.count, 2);
  assert.deepEqual(
    res.body.cells.map(({ level, percent }) => [level, percent]),
    [
      ['high', 19.6],
      ['medium', 9],
    ],
  );
  assert.equal(res.body.cells[0].boundary.length, 6);

  // Within the hour: memory only.
  clock += HOUR - 1;
  await request();
  assert.equal(calls.length, 2);

  // After the hour the manifest is re-read; an unchanged day is not refetched.
  clock += 2;
  assert.equal((await request()).body.date, '2026-09-29');
  assert.deepEqual(calls.slice(2), ['manifest.csv']);

  // A new day is fetched once it is listed.
  state.manifest.push(['2026-09-30', true]);
  state.days['2026-09-30'] = day([[BALTIC, 0, 5]]);
  clock += HOUR;
  const next = await request();
  assert.deepEqual(calls.slice(3), ['manifest.csv', '2026-09-30-h3_4.csv']);
  assert.equal(next.body.date, '2026-09-30');
  assert.equal(next.body.suspect, true);
  assert.equal(next.body.cells[0].percent, 80);
});

test('failures serve the last good day as stale and back off for ten minutes', async () => {
  let clock = NOW;
  const state = {
    manifest: [['2026-09-29']],
    days: { '2026-09-29': day([[BALTIC, 40, 11]]) },
  };
  const { calls, fetchImpl } = upstream(state);
  const request = install({ fetchImpl, now: () => clock });
  await request();

  state.fail = true;
  clock += HOUR;
  const stale = await request();
  assert.equal(stale.status, 200);
  assert.equal(stale.body.stale, true);
  assert.equal(stale.body.count, 1);
  const failedCalls = calls.length;

  clock += 10 * 60_000 - 1;
  assert.equal((await request()).body.stale, true);
  assert.equal(calls.length, failedCalls, 'no upstream call during backoff');

  state.fail = false;
  clock += 2;
  const recovered = await request();
  assert.equal(recovered.body.stale, false);
});

test('without a good day, failures and malformed files answer 502', async () => {
  let clock = NOW;
  const state = { manifest: [['2026-09-29']], days: {} };
  const { calls, fetchImpl } = upstream(state);
  const request = install({ fetchImpl, now: () => clock });
  const missing = await request();
  assert.equal(missing.status, 502);
  assert.deepEqual(missing.body, { error: 'gpsjam_unavailable' });

  // Backoff holds even with nothing cached.
  const before = calls.length;
  assert.equal((await request()).status, 502);
  assert.equal(calls.length, before);

  // A truncated day never becomes the snapshot.
  state.days['2026-09-29'] = 'hex,count_good_aircraft\n8400ec3ffffffff,1';
  clock += 10 * 60_000 + 1;
  assert.equal((await request()).status, 502);
});

test('only GET /latest is served', async () => {
  const { fetchImpl } = upstream({ manifest: [], days: {} });
  const request = install({ fetchImpl, now: () => NOW });
  assert.equal((await request('/latest', 'POST')).status, 405);
  assert.equal((await request('/other')).status, 404);
});
