import assert from 'node:assert/strict';
import test from 'node:test';
import { createGnssInterferenceLayer } from './index.js';
import { gnssCellTitle, gnssDayIsStale } from './model.js';
import {
  gnssBadPercent,
  gnssLevel,
  interferenceCells,
  parseGpsjamCells,
  parseGpsjamManifest,
  validateGnssSnapshot,
} from './records.js';
import { createGnssInterferenceSource } from './source.js';

const NOW = Date.parse('2026-09-30T12:00:00Z');
const HEX = '8408993ffffffff';
const BOUNDARY = [
  [24.1, 59.4],
  [24.3, 59.4],
  [24.4, 59.5],
  [24.3, 59.6],
  [24.1, 59.6],
  [24.0, 59.5],
];

function cell(overrides = {}) {
  return {
    hex: HEX,
    good: 40,
    bad: 11,
    percent: 19.6,
    level: 'high',
    boundary: BOUNDARY,
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    date: '2026-09-29',
    suspect: false,
    fetchedAt: NOW,
    stale: false,
    totalCells: 47846,
    count: 1,
    cells: [cell()],
    ...overrides,
  };
}

test('bad-aircraft percentage and levels follow the GPSJam FAQ', () => {
  // 100 * (bad - 1) / (good + bad); one bad aircraft alone never counts.
  assert.equal(gnssBadPercent(9, 1), 0);
  assert.equal(gnssBadPercent(0, 0), 0);
  assert.equal(gnssBadPercent(90, 10), 9);
  assert.equal(gnssBadPercent(0, 5), 80);
  assert.equal(gnssLevel(2), 'low');
  assert.equal(gnssLevel(2.1), 'medium');
  assert.equal(gnssLevel(10), 'medium');
  assert.equal(gnssLevel(10.1), 'high');
});

test('manifest parsing sorts days and rejects malformed rows', () => {
  assert.deepEqual(
    parseGpsjamManifest(
      'date,suspect,num_bad_aircraft_hexes,source\n' +
        '2026-09-29,false,549,merged\n2026-09-28,true,556,merged\n',
    ),
    [
      { date: '2026-09-28', suspect: true },
      { date: '2026-09-29', suspect: false },
    ],
  );
  assert.equal(parseGpsjamManifest('day,suspect\n2026-09-29,false'), null);
  assert.equal(parseGpsjamManifest('date,suspect\n2026-13-45,false'), null);
  assert.equal(parseGpsjamManifest('date,suspect\n2026-09-29,maybe'), null);
  assert.equal(parseGpsjamManifest('date,suspect\n'), null);
  assert.equal(parseGpsjamManifest(null), null);
});

test('day parsing keeps only medium and high hexagons from a valid file', () => {
  const cells = parseGpsjamCells(
    'hex,count_good_aircraft,count_bad_aircraft\r\n' +
      '84005b1ffffffff,98,2\r\n' + // 1 %: low
      '8400ec3ffffffff,90,10\r\n' + // 9 %: medium
      `${HEX},40,11\r\n`, // 19.6 %: high
  );
  assert.equal(cells.length, 3);
  assert.deepEqual(
    interferenceCells(cells).map(({ hex, percent, level }) => [
      hex,
      percent,
      level,
    ]),
    [
      ['8400ec3ffffffff', 9, 'medium'],
      [HEX, 19.6, 'high'],
    ],
  );
  assert.equal(parseGpsjamCells('hex,good,bad\n84005b1ffffffff,1,0'), null);
  assert.equal(
    parseGpsjamCells(
      'hex,count_good_aircraft,count_bad_aircraft\nnot-a-hex,1,0',
    ),
    null,
  );
  assert.equal(
    parseGpsjamCells(
      'hex,count_good_aircraft,count_bad_aircraft\n84005b1ffffffff,-1,0',
    ),
    null,
  );
});

test('snapshot validation rejects anything the proxy should never publish', () => {
  assert.ok(validateGnssSnapshot(snapshot()));
  for (const bad of [
    null,
    snapshot({ date: '29/09/2026' }),
    snapshot({ suspect: 'no' }),
    snapshot({ cells: 'x' }),
    snapshot({ cells: [cell(), cell()] }),
    snapshot({ cells: [cell({ level: 'low' })] }),
    snapshot({ cells: [cell({ percent: 120 })] }),
    snapshot({ cells: [cell({ good: 1.5 })] }),
    snapshot({ cells: [cell({ boundary: BOUNDARY.slice(0, 2) })] }),
    snapshot({ cells: [cell({ boundary: [[24, 95], ...BOUNDARY] })] }),
  ])
    assert.equal(validateGnssSnapshot(bad), null);
  // A hexagon crossing the antimeridian keeps longitudes past 180.
  assert.ok(
    validateGnssSnapshot(
      snapshot({
        cells: [
          cell({ boundary: BOUNDARY.map(([, lat], i) => [179 + i, lat]) }),
        ],
      }),
    ),
  );
});

test('model titles and day staleness', () => {
  assert.equal(gnssCellTitle(cell()), 'GNSS interference · High · 19.6 %');
  assert.equal(gnssDayIsStale('2026-09-29', NOW), false);
  // Day 2026-09-28 ended 36 h before NOW; stale only after that.
  assert.equal(
    gnssDayIsStale('2026-09-28', Date.parse('2026-09-30T11:59:00Z')),
    false,
  );
  assert.equal(gnssDayIsStale('2026-09-27', NOW), true);
});

const response = (value, status = 200) =>
  new Response(JSON.stringify(value), { status });

test('source validates the proxy snapshot and maps failures', async () => {
  const make = (reply) =>
    createGnssInterferenceSource({ fetchImpl: async () => reply() });
  const result = await make(() =>
    response(snapshot({ stale: true })),
  ).getSnapshot();
  assert.equal(result.cells.length, 1);
  assert.equal(result.stale, true);
  assert.equal(result.fetchedAt, NOW);
  await assert.rejects(
    make(() => response({ error: 'gpsjam_unavailable' }, 502)).getSnapshot(),
    /GPSJam HTTP 502/,
  );
  await assert.rejects(
    make(() =>
      response(snapshot({ cells: [cell({ level: 'x' })] })),
    ).getSnapshot(),
    /Malformed GPSJam snapshot/,
  );
  const stalled = createGnssInterferenceSource({
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
  const layer = createGnssInterferenceLayer({ source, now });
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, sources };
}

test('layer draws one hexagon per cell and reports the day as its source', async () => {
  let current = snapshot();
  const h = harness({ getSnapshot: async () => current });
  assert.equal(await h.layer.update(h.viewer), true);
  const entities = h.sources[0].entities.values;
  assert.equal(entities.length, 1);
  assert.equal(entities[0].id, `gnss-interference:${HEX}`);
  assert.equal(entities[0].name, 'GNSS interference · High · 19.6 %');
  assert.ok(entities[0].polygon);
  assert.deepEqual(h.layer.getStats(), {
    count: 1,
    lastUpdate: NOW,
    stale: false,
    partial: false,
    source: 'GPSJam 2026-09-29',
    error: null,
  });

  // The same day again keeps the existing entities.
  const first = entities[0];
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.sources[0].entities.values[0], first);

  // An incomplete day reads PARTIAL; an old day reads STALE.
  current = snapshot({ date: '2026-09-27', suspect: true, cells: [] });
  assert.equal(await h.layer.update(h.viewer), true);
  const stats = h.layer.getStats();
  assert.equal(stats.count, 0);
  assert.equal(stats.partial, true);
  assert.equal(stats.stale, true);
  assert.equal(h.sources[0].entities.values.length, 0);
  h.layer.destroy();
  assert.equal(h.sources.length, 0);
});

test('failures keep the last good day and report the error', async () => {
  let mode = 'ok';
  const h = harness({
    getSnapshot: async () => {
      if (mode === 'fail') throw new Error('GPSJam HTTP 502');
      return snapshot({ stale: true });
    },
  });
  await h.layer.update(h.viewer);
  assert.equal(h.layer.getStats().stale, true);
  mode = 'fail';
  assert.equal(await h.layer.update(h.viewer), false);
  const stats = h.layer.getStats();
  assert.equal(stats.count, 1);
  assert.equal(stats.error, 'GPSJam HTTP 502');
  assert.equal(h.sources[0].entities.values.length, 1);
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
    resolve(snapshot());
    assert.equal(await pending, false);
    assert.equal(h.layer.getStats().lastUpdate, null);
    h.layer.destroy(h.viewer);
  }
});
