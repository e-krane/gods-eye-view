import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrafikverketIncidentsLayer } from './index.js';
import {
  createIncidentOverlayEntry,
  incidentPixelSize,
  incidentTitle,
} from './model.js';
import {
  normalizeTrafikverketSituations,
  parseWktFirstCoordinate,
  validateTrafikverketIncidentRows,
} from './records.js';
import { createTrafikverketIncidentSource } from './source.js';

const NOW = Date.parse('2026-09-29T12:00:00Z');

function body(deviations, extra = {}) {
  return {
    RESPONSE: {
      RESULT: [{ Situation: [{ Id: 'S1', Deviation: deviations, ...extra }] }],
    },
  };
}

function deviation(id, overrides = {}) {
  return {
    Id: id,
    MessageType: 'Olycka',
    Header: 'Trafikolycka',
    Message: '  Två bilar   inblandade. ',
    RoadNumber: 'E4',
    SeverityCode: 4,
    SeverityText: 'Stor påverkan',
    StartTime: '2026-09-29T11:00:00.000+02:00',
    Geometry: { Point: { WGS84: 'POINT (18.0686 59.3293)' } },
    ...overrides,
  };
}

test('WKT parsing takes the first coordinate of a point or line', () => {
  assert.deepEqual(
    parseWktFirstCoordinate('POINT (18.0686 59.3293)'),
    [18.0686, 59.3293],
  );
  assert.deepEqual(
    parseWktFirstCoordinate('LINESTRING (11.9 57.7, 12.0 57.8)'),
    [11.9, 57.7],
  );
  assert.deepEqual(parseWktFirstCoordinate('POINT Z (15 60 0)'), [15, 60]);
  assert.equal(parseWktFirstCoordinate('POINT (200 60)'), null);
  assert.equal(parseWktFirstCoordinate('POLYGON ((1 2, 3 4))'), null);
  assert.equal(parseWktFirstCoordinate(null), null);
});

test('normalizer keeps active incidents and skips planned, expired or incomplete ones', () => {
  const rows = normalizeTrafikverketSituations(
    body([
      deviation('a'),
      deviation('roadworks', { MessageType: 'Vägarbete' }),
      deviation('future', { StartTime: '2026-09-30T08:00:00Z' }),
      deviation('expired', { EndTime: '2026-09-29T09:00:00Z' }),
      deviation('open', {
        MessageType: 'Hinder',
        EndTime: '2026-09-29T09:00:00Z',
        ValidUntilFurtherNotice: true,
      }),
      deviation('line', {
        MessageType: 'Restriktion',
        Geometry: { Line: { WGS84: 'LINESTRING (11.9 57.7, 12.0 57.8)' } },
      }),
      deviation('nowhere', { Geometry: {} }),
      deviation(''),
      deviation('a'),
    ]),
    { now: NOW },
  );
  assert.deepEqual(
    rows.map((row) => [row.id, row.category]),
    [
      ['a', 'accident'],
      ['open', 'obstacle'],
      ['line', 'restriction'],
    ],
  );
  assert.equal(rows[0].message, 'Två bilar inblandade.');
  assert.equal(rows[0].severity, 4);
  assert.equal(rows[1].openEnded, true);
  assert.deepEqual([rows[2].lon, rows[2].lat], [11.9, 57.7]);
});

test('normalizer rejects malformed envelopes and drops deleted situations', () => {
  assert.equal(normalizeTrafikverketSituations(null), null);
  assert.equal(normalizeTrafikverketSituations({ RESPONSE: {} }), null);
  assert.equal(
    normalizeTrafikverketSituations({
      RESPONSE: { RESULT: [{ ERROR: { SOURCE: 'Request' } }] },
    }),
    null,
  );
  assert.equal(
    normalizeTrafikverketSituations({
      RESPONSE: { RESULT: [{ Situation: 'x' }] },
    }),
    null,
  );
  assert.deepEqual(
    normalizeTrafikverketSituations({ RESPONSE: { RESULT: [{}] } }),
    [],
  );
  assert.deepEqual(
    normalizeTrafikverketSituations(body([deviation('a')], { Deleted: true }), {
      now: NOW,
    }),
    [],
  );
});

test('row validation rejects anything the proxy should never publish', () => {
  const [row] = normalizeTrafikverketSituations(body([deviation('a')]), {
    now: NOW,
  });
  assert.deepEqual(validateTrafikverketIncidentRows([row]), [row]);
  assert.equal(validateTrafikverketIncidentRows('x'), null);
  assert.equal(validateTrafikverketIncidentRows([row, row]), null);
  assert.equal(
    validateTrafikverketIncidentRows([{ ...row, category: 'roadworks' }]),
    null,
  );
  assert.equal(validateTrafikverketIncidentRows([{ ...row, lat: 95 }]), null);
  assert.equal(
    validateTrafikverketIncidentRows([{ ...row, severity: 3 }]),
    null,
  );
});

test('model titles, sizes and label priority', () => {
  assert.equal(
    incidentTitle({ category: 'accident', roadNumber: 'E4' }),
    'Accident · E4',
  );
  assert.equal(incidentTitle({ category: 'notice' }), 'Notice');
  assert.ok(incidentPixelSize(5) > incidentPixelSize(1));
  const major = createIncidentOverlayEntry({
    row: { id: 1, category: 'accident', severity: 5 },
    position: null,
  });
  const minor = createIncidentOverlayEntry({
    row: { id: 2, category: 'notice', severity: 1 },
    position: null,
  });
  assert.equal(major.id, '1');
  assert.ok(major.priority > minor.priority);
});

const response = (value, status = 200) =>
  new Response(JSON.stringify(value), { status });

test('source maps proxy states: no key, rejected key, errors and rows', async () => {
  const [row] = normalizeTrafikverketSituations(body([deviation('a')]), {
    now: NOW,
  });
  const make = (reply) =>
    createTrafikverketIncidentSource({ fetchImpl: async () => reply() });
  assert.deepEqual(
    await make(() => response({ error: 'no_key' }, 503)).getSnapshot(),
    { keyRequired: true },
  );
  await assert.rejects(
    make(() => response({ error: 'auth_failed' }, 502)).getSnapshot(),
    /rejected the API key/,
  );
  await assert.rejects(
    make(() =>
      response({ error: 'trafikverket_unavailable' }, 502),
    ).getSnapshot(),
    /Trafikverket HTTP 502/,
  );
  await assert.rejects(
    make(() => response({ rows: [{ id: 'x' }] })).getSnapshot(),
    /Malformed Trafikverket snapshot/,
  );
  const snapshot = await make(() =>
    response({ rows: [row], stale: true, fetchedAt: NOW }),
  ).getSnapshot();
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.stale, true);
  assert.equal(snapshot.fetchedAt, NOW);

  const stalled = createTrafikverketIncidentSource({
    timeoutMs: 20,
    fetchImpl: () => new Promise(() => {}),
  });
  await assert.rejects(stalled.getSnapshot(), { name: 'TimeoutError' });
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
  const layer = createTrafikverketIncidentsLayer({
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

test('layer reports a missing key as KEY REQUIRED and clears old incidents', async () => {
  const [row] = normalizeTrafikverketSituations(body([deviation('a')]), {
    now: NOW,
  });
  let keyed = true;
  const h = harness({
    getSnapshot: async () =>
      keyed
        ? { rows: [row], stale: false, fetchedAt: NOW }
        : { keyRequired: true },
  });
  assert.equal(h.layer.requiresKeyId, 'trafikverket');
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.layer.getStats().count, 1);
  assert.equal(h.layer.getStats().lastUpdate, NOW);
  assert.equal(
    h.events.find(([kind]) => kind === 'set')[2][0].title,
    'Accident · E4',
  );

  keyed = false;
  assert.equal(await h.layer.update(h.viewer), false);
  const stats = h.layer.getStats();
  assert.equal(stats.keyRequired, true);
  assert.equal(stats.error, 'KEY REQUIRED');
  assert.equal(stats.count, 0);
  h.layer.destroy();
  assert.equal(h.sources.length, 0);
});

test('stale snapshots and failures keep the last good incidents', async () => {
  const [row] = normalizeTrafikverketSituations(body([deviation('a')]), {
    now: NOW,
  });
  let mode = 'stale';
  const h = harness({
    getSnapshot: async () => {
      if (mode === 'fail') throw new Error('Trafikverket HTTP 502');
      return { rows: [row], stale: true, fetchedAt: NOW };
    },
  });
  await h.layer.update(h.viewer);
  assert.equal(h.layer.getStats().stale, true);
  mode = 'fail';
  assert.equal(await h.layer.update(h.viewer), false);
  const stats = h.layer.getStats();
  assert.equal(stats.count, 1);
  assert.equal(stats.error, 'Trafikverket HTTP 502');
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
