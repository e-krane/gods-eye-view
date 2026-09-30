import assert from 'node:assert/strict';
import test from 'node:test';
import { createFrontlineLayer } from './index.js';
import { frontlineDayIsStale } from './model.js';
import { deepstateDay, normalizeDeepstateGeojson } from './records.js';
import { createFrontlineSource } from './source.js';

const NOW = Date.parse('2026-09-30T12:00:00Z');
const OUTER = [
  [37.0, 47.0],
  [38.0, 47.0],
  [38.0, 48.0],
  [37.0, 48.0],
  [37.0, 47.0],
];
const HOLE = [
  [37.4, 47.4],
  [37.6, 47.4],
  [37.6, 47.6],
  [37.4, 47.4],
];
const CRIMEA = [
  [33.5, 44.5],
  [35.0, 44.5],
  [35.0, 45.5],
  [33.5, 44.5],
];

function file(coordinates = [[OUTER, HOLE], [CRIMEA]]) {
  return {
    type: 'FeatureCollection',
    name: 'deepstatemap_data',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'MultiPolygon', coordinates },
      },
    ],
  };
}

test('file names follow the UTC day', () => {
  assert.deepEqual(deepstateDay(NOW), {
    date: '2026-09-30',
    fileDate: '20260930',
  });
  assert.deepEqual(deepstateDay(Date.parse('2026-10-01T01:00:00Z'), 1), {
    date: '2026-09-30',
    fileDate: '20260930',
  });
});

test('normalizer returns open rings per polygon and rejects malformed files', () => {
  const polygons = normalizeDeepstateGeojson(file());
  assert.equal(polygons.length, 2);
  assert.equal(polygons[0].length, 2, 'outer ring plus one hole');
  assert.deepEqual(polygons[0][0], OUTER.slice(0, 4), 'closing vertex dropped');
  assert.deepEqual(polygons[1][0], CRIMEA.slice(0, 3));
  assert.deepEqual(
    normalizeDeepstateGeojson({ type: 'Polygon', coordinates: [OUTER] }),
    [[OUTER.slice(0, 4)]],
  );
  for (const bad of [
    null,
    { type: 'FeatureCollection', features: [] },
    { type: 'FeatureCollection', features: [{ geometry: null }] },
    { type: 'LineString', coordinates: OUTER },
    file([[OUTER.slice(0, 3)]]),
    file([[[...OUTER.slice(0, 4), [200, 47]]]]),
    file([[[[37, 'x'], ...OUTER]]]),
  ])
    assert.equal(normalizeDeepstateGeojson(bad), null);
});

test('a file reads stale once it is more than two days past its day', () => {
  assert.equal(frontlineDayIsStale('2026-09-30', NOW), false);
  assert.equal(frontlineDayIsStale('2026-09-28', NOW), false);
  assert.equal(frontlineDayIsStale('2026-09-27', NOW), true);
});

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status });

test('source falls back a day at a time until a file exists', async () => {
  const urls = [];
  const published = new Set(['20260929']);
  const source = createFrontlineSource({
    now: () => NOW,
    fetchImpl: async (url) => {
      urls.push(url);
      const day = url.match(/deepstatemap_data_(\d{8})\.geojson$/)[1];
      return published.has(day) ? json(file()) : json({}, 404);
    },
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.date, '2026-09-29');
  assert.equal(snapshot.polygons.length, 2);
  assert.deepEqual(
    urls.map((url) => url.split('/').at(-1)),
    [
      'deepstatemap_data_20260930.geojson',
      'deepstatemap_data_20260929.geojson',
    ],
  );
  assert.ok(
    urls[0].startsWith(
      'https://raw.githubusercontent.com/cyterat/deepstate-map-data/main/data/',
    ),
  );

  published.clear();
  await assert.rejects(
    source.getSnapshot(),
    /No DeepState file in the last 4 days/,
  );
});

test('source surfaces upstream errors, malformed files and stalls', async () => {
  const make = (reply) =>
    createFrontlineSource({ now: () => NOW, fetchImpl: async () => reply() });
  await assert.rejects(
    make(() => json({}, 503)).getSnapshot(),
    /DeepState mirror HTTP 503/,
  );
  await assert.rejects(
    make(() => json({ type: 'FeatureCollection', features: [] })).getSnapshot(),
    /Malformed DeepState file/,
  );
  const stalled = createFrontlineSource({
    now: () => NOW,
    timeoutMs: 20,
    fetchImpl: () => new Promise(() => {}),
  });
  await assert.rejects(stalled.getSnapshot(), { name: 'TimeoutError' });
});

function harness(source, now = () => NOW) {
  const sources = [];
  const viewer = {
    dataSources: {
      add(value) {
        sources.push(value);
      },
      remove(value) {
        sources.splice(sources.indexOf(value), 1);
      },
    },
  };
  const layer = createFrontlineLayer({ source, now });
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, sources };
}

test('layer fills each polygon, outlines every ring and names the day', async () => {
  let current = {
    date: '2026-09-30',
    polygons: normalizeDeepstateGeojson(file()),
  };
  const h = harness({ getSnapshot: async () => current });
  assert.equal(await h.layer.update(h.viewer), true);
  const entities = h.sources[0].entities.values;
  assert.deepEqual(
    entities.map((entity) => entity.id),
    [
      'ukraine-frontline:0',
      'ukraine-frontline:0:line:0',
      'ukraine-frontline:0:line:1',
      'ukraine-frontline:1',
      'ukraine-frontline:1:line:0',
    ],
  );
  const fill = entities[0].polygon.hierarchy.getValue();
  assert.equal(fill.positions.length, 4);
  assert.equal(fill.holes.length, 1);
  const line = entities[1].polyline;
  assert.equal(line.clampToGround.getValue(), true);
  assert.equal(line.positions.getValue().length, 5, 'line closes its ring');
  assert.deepEqual(h.layer.getStats(), {
    count: 2,
    lastUpdate: NOW,
    stale: false,
    source: 'DeepState 2026-09-30',
    error: null,
  });

  // The same day again keeps the existing entities.
  const first = entities[0];
  await h.layer.update(h.viewer);
  assert.equal(h.sources[0].entities.values[0], first);

  // An old day reads stale.
  current = { ...current, date: '2026-09-26' };
  await h.layer.update(h.viewer);
  assert.equal(h.layer.getStats().stale, true);
  assert.notEqual(h.sources[0].entities.values[0], first);
  h.layer.destroy();
  assert.equal(h.sources.length, 0);
});

test('failures keep the last good day and report the error', async () => {
  let fail = false;
  const h = harness({
    getSnapshot: async () => {
      if (fail) throw new Error('DeepState mirror HTTP 503');
      return {
        date: '2026-09-30',
        polygons: normalizeDeepstateGeojson(file()),
      };
    },
  });
  await h.layer.update(h.viewer);
  fail = true;
  assert.equal(await h.layer.update(h.viewer), false);
  const stats = h.layer.getStats();
  assert.equal(stats.count, 2);
  assert.equal(stats.error, 'DeepState mirror HTTP 503');
  assert.equal(h.sources[0].entities.values.length, 5);
  h.layer.destroy();
});

test('late refresh cannot publish after disable or destroy', async () => {
  for (const action of ['disable', 'destroy']) {
    let resolve, signal;
    const h = harness({
      getSnapshot(options) {
        signal = options.signal;
        return new Promise((done) => {
          resolve = done;
        });
      },
    });
    const pending = h.layer.update(h.viewer);
    h.layer[action](h.viewer);
    assert.equal(signal.aborted, true);
    if (action === 'disable') h.layer.enable(h.viewer);
    resolve({ date: '2026-09-30', polygons: [] });
    assert.equal(await pending, false);
    assert.equal(h.layer.getStats().lastUpdate, null);
    h.layer.destroy(h.viewer);
  }
});
