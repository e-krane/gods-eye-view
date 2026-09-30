import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrainPositionsLayer } from './index.js';
import { createTrainOverlayEntry, trainTitle } from './model.js';
import {
  normalizeTrafikverketTrainPositions,
  parseWktPoint,
  validateTrainPositionRows,
} from './records.js';
import { createTrainPositionSource } from './source.js';

const NOW = Date.parse('2026-09-30T17:30:00Z');

function report(number, overrides = {}) {
  return {
    Train: {
      OperationalTrainNumber: number,
      OperationalTrainDepartureDate: '2026-09-30T00:00:00.000+02:00',
      AdvertisedTrainNumber: number,
    },
    Position: { WGS84: 'POINT (18.0592 59.3303)' },
    TimeStamp: '2026-09-30T19:29:30.000+02:00',
    Status: { Active: true },
    Bearing: 194,
    Speed: 180,
    Deleted: false,
    ...overrides,
  };
}

const body = (positions) => ({
  RESPONSE: { RESULT: [{ TrainPosition: positions }] },
});

test('WKT points parse; lines and bad coordinates do not', () => {
  assert.deepEqual(parseWktPoint('POINT (15.13 58.32)'), [15.13, 58.32]);
  assert.equal(parseWktPoint('LINESTRING (1 2, 3 4)'), null);
  assert.equal(parseWktPoint('POINT (200 58)'), null);
  assert.equal(parseWktPoint(undefined), null);
});

test('normalizer keeps current, active, located trains, newest report first', () => {
  const rows = normalizeTrafikverketTrainPositions(
    body([
      report('537'),
      report('537', {
        TimeStamp: '2026-09-30T19:28:00.000+02:00',
        Position: { WGS84: 'POINT (17 59)' },
      }),
      report('18860', { Speed: undefined, Bearing: 400 }),
      report('900', { Deleted: true }),
      report('901', { Status: { Active: false } }),
      report('902', { TimeStamp: '2026-09-30T19:20:00.000+02:00' }),
      report('903', { Position: { WGS84: 'nowhere' } }),
      report('bad number!'),
    ]),
    { now: NOW },
  );
  assert.deepEqual(rows, [
    {
      id: '537:2026-09-30',
      number: '537',
      lon: 18.0592,
      lat: 59.3303,
      bearing: 194,
      speed: 180,
      timestamp: Date.parse('2026-09-30T17:29:30Z'),
    },
    {
      id: '18860:2026-09-30',
      number: '18860',
      lon: 18.0592,
      lat: 59.3303,
      bearing: null,
      speed: null,
      timestamp: Date.parse('2026-09-30T17:29:30Z'),
    },
  ]);
  assert.equal(normalizeTrafikverketTrainPositions(null), null);
  assert.equal(
    normalizeTrafikverketTrainPositions({
      RESPONSE: { RESULT: [{ ERROR: { SOURCE: 'Request' } }] },
    }),
    null,
  );
  assert.deepEqual(
    normalizeTrafikverketTrainPositions({ RESPONSE: { RESULT: [{}] } }),
    [],
  );
});

test('row validation rejects anything the proxy should never publish', () => {
  const [row] = normalizeTrafikverketTrainPositions(body([report('537')]), {
    now: NOW,
  });
  assert.ok(validateTrainPositionRows([row]));
  for (const bad of [
    { ...row, id: '' },
    { ...row, number: 537 },
    { ...row, lat: 99 },
    { ...row, bearing: 360 },
    { ...row, speed: 1.5 },
    { ...row, timestamp: 'now' },
  ])
    assert.equal(validateTrainPositionRows([bad]), null);
  assert.equal(validateTrainPositionRows([row, row]), null);
});

test('labels name the train and, when known, its speed', () => {
  assert.equal(
    trainTitle({ number: '537', speed: 180 }),
    'Train 537 · 180 km/h',
  );
  assert.equal(trainTitle({ number: '18860', speed: null }), 'Train 18860');
  const fast = createTrainOverlayEntry({
    row: { id: 'a', number: '537', speed: 180 },
    position: 'p',
  });
  const slow = createTrainOverlayEntry({
    row: { id: 'b', number: '18860', speed: null },
    position: 'p',
  });
  assert.ok(fast.priority > slow.priority);
});

const response = (value, status = 200) =>
  new Response(JSON.stringify(value), { status });

test('source maps proxy states: no key, rejected key, errors and rows', async () => {
  const [row] = normalizeTrafikverketTrainPositions(body([report('537')]), {
    now: NOW,
  });
  const make = (reply) =>
    createTrainPositionSource({ fetchImpl: async () => reply() });
  assert.deepEqual(
    await make(() => response({ error: 'no_key' }, 503)).getSnapshot(),
    { keyRequired: true },
  );
  await assert.rejects(
    make(() => response({ error: 'auth_failed' }, 502)).getSnapshot(),
    /rejected the API key/,
  );
  await assert.rejects(
    make(() => response({ rows: [{ id: 'x' }] })).getSnapshot(),
    /Malformed train position snapshot/,
  );
  const snapshot = await make(() =>
    response({ rows: [row], stale: true, fetchedAt: NOW }),
  ).getSnapshot();
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.stale, true);
});

function harness(source) {
  const sources = [];
  const events = [];
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
  const layer = createTrainPositionsLayer({
    source,
    overlayHost: {
      setEntries(...args) {
        events.push(['set', ...args]);
      },
      setVisible() {},
      clearSource(id) {
        events.push(['clear', id]);
      },
    },
  });
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, sources, events };
}

test('trains move in place, new ones appear and departed ones leave', async () => {
  const rowsAt = (entries) =>
    normalizeTrafikverketTrainPositions(body(entries), { now: NOW });
  let rows = rowsAt([report('537'), report('18860')]);
  const h = harness({
    getSnapshot: async () => ({ rows, stale: false, fetchedAt: NOW }),
  });
  assert.equal(h.layer.requiresKeyId, 'trafikverket');
  await h.layer.update(h.viewer);
  const entities = h.sources[0].entities;
  const first = entities.getById('trafikverket-train-positions:537:2026-09-30');
  assert.ok(first.point);
  assert.equal(first.name, 'Train 537 · 180 km/h');

  rows = rowsAt([
    report('537', { Position: { WGS84: 'POINT (18.5 59.5)' }, Speed: 120 }),
    report('42'),
  ]);
  await h.layer.update(h.viewer);
  const moved = entities.getById('trafikverket-train-positions:537:2026-09-30');
  assert.equal(moved, first, 'same entity, new position');
  assert.equal(moved.name, 'Train 537 · 120 km/h');
  assert.equal(
    entities.getById('trafikverket-train-positions:18860:2026-09-30'),
    undefined,
  );
  assert.ok(entities.getById('trafikverket-train-positions:42:2026-09-30'));
  assert.equal(h.layer.getStats().count, 2);
  const [, sourceId, labels, options] = h.events
    .filter(([kind]) => kind === 'set')
    .at(-1);
  assert.equal(sourceId, 'trafikverket-train-positions');
  assert.equal(labels.length, 2);
  assert.equal(options.moving, true);
  h.layer.destroy();
  assert.equal(h.sources.length, 0);
});

test('a missing key reads KEY REQUIRED and clears the trains', async () => {
  let keyed = true;
  const [row] = normalizeTrafikverketTrainPositions(body([report('537')]), {
    now: NOW,
  });
  const h = harness({
    getSnapshot: async () =>
      keyed
        ? { rows: [row], stale: false, fetchedAt: NOW }
        : { keyRequired: true },
  });
  await h.layer.update(h.viewer);
  keyed = false;
  assert.equal(await h.layer.update(h.viewer), false);
  const stats = h.layer.getStats();
  assert.equal(stats.keyRequired, true);
  assert.equal(stats.error, 'KEY REQUIRED');
  assert.equal(stats.count, 0);
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
    resolve({ rows: [], stale: false, fetchedAt: NOW });
    assert.equal(await pending, false);
    assert.equal(h.layer.getStats().lastUpdate, null);
    h.layer.destroy(h.viewer);
  }
});
