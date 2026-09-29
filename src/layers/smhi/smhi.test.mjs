import assert from 'node:assert/strict';
import test from 'node:test';
import { createSmhiObservationsLayer } from './index.js';
import {
  SMHI_STALE_AFTER_MS,
  createSmhiOverlayEntry,
  isSmhiSnapshotStale,
  temperatureColor,
} from './model.js';
import { normalizeSmhiObservationSnapshot } from './records.js';
import { createSmhiObservationSource } from './source.js';

const HOUR = 1790701200000;

function station(key, value, extra = {}) {
  return {
    key,
    name: `Station ${key}`,
    owner: 'SMHI',
    height: 12.5,
    latitude: 59.3,
    longitude: 18.1,
    value: value === undefined ? [] : [{ date: HOUR, value, quality: 'G' }],
    ...extra,
  };
}

function feed(stations, parameterKey = '1') {
  return {
    updated: HOUR,
    parameter: { key: parameterKey, name: 'Lufttemperatur', unit: 'celsius' },
    station: stations,
  };
}

test('normalizer keeps reporting stations and skips quiet ones', () => {
  const rows = normalizeSmhiObservationSnapshot(
    feed([station('1', '7.6'), station('2'), station('3', '-12.0')]),
  );
  assert.deepEqual(
    rows.map((row) => [row.stationId, row.value, row.observedAt]),
    [
      ['1', 7.6, HOUR],
      ['3', -12, HOUR],
    ],
  );
  assert.equal(rows[0].quality, 'G');
  assert.equal(rows[0].heightM, 12.5);
});

test('normalizer rejects a malformed feed so the last snapshot survives', () => {
  assert.equal(normalizeSmhiObservationSnapshot(null), null);
  assert.equal(normalizeSmhiObservationSnapshot({ station: [] }), null);
  assert.equal(
    normalizeSmhiObservationSnapshot(feed([station('1', '3')], '4')),
    null,
  );
  assert.equal(
    normalizeSmhiObservationSnapshot(feed([station('1', '3'), station('1')])),
    null,
  );
  assert.equal(
    normalizeSmhiObservationSnapshot(
      feed([station('1', '3', { latitude: 'north' })]),
    ),
    null,
  );
  assert.equal(
    normalizeSmhiObservationSnapshot(feed([station('1', 'warm')])),
    null,
  );
});

test('normalizer skips implausible readings and takes the newest value', () => {
  const rows = normalizeSmhiObservationSnapshot(
    feed([
      station('1', '99'),
      station('2', null, {
        value: [
          { date: HOUR - 3600000, value: '1.0', quality: 'G' },
          { date: HOUR, value: '2.0', quality: 'Y' },
        ],
      }),
    ]),
  );
  assert.deepEqual(
    rows.map((row) => [row.stationId, row.value, row.quality]),
    [['2', 2, 'Y']],
  );
});

test('model colors, labels and staleness', () => {
  assert.notEqual(temperatureColor(-25), temperatureColor(25));
  assert.equal(temperatureColor(NaN), temperatureColor(0));
  const entry = createSmhiOverlayEntry({
    id: 42,
    position: null,
    value: -3.44,
    accent: '#fff',
  });
  assert.equal(entry.id, '42');
  assert.equal(entry.title, '-3.4°');
  assert.equal(entry.interactive, false);
  assert.equal(isSmhiSnapshotStale([], HOUR), false);
  assert.equal(isSmhiSnapshotStale([{ observedAt: HOUR }], HOUR), false);
  assert.equal(
    isSmhiSnapshotStale([{ observedAt: HOUR }], HOUR + SMHI_STALE_AFTER_MS + 1),
    true,
  );
});

test('source requests the latest-hour station set and validates it', async () => {
  const urls = [];
  const source = createSmhiObservationSource({
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify(feed([station('1', '4.2')])));
    },
  });
  const rows = await source.getSnapshot();
  assert.equal(rows.length, 1);
  assert.match(
    urls[0],
    /\/parameter\/1\/station-set\/all\/period\/latest-hour\/data\.json$/,
  );

  const failing = createSmhiObservationSource({
    fetchImpl: async () => new Response('nope', { status: 503 }),
  });
  await assert.rejects(failing.getSnapshot(), /SMHI HTTP 503/);

  const malformed = createSmhiObservationSource({
    fetchImpl: async () => new Response(JSON.stringify({ station: 'x' })),
  });
  await assert.rejects(malformed.getSnapshot(), /Malformed SMHI response/);

  const stalled = createSmhiObservationSource({
    timeoutMs: 20,
    fetchImpl: () => new Promise(() => {}),
  });
  await assert.rejects(stalled.getSnapshot(), { name: 'TimeoutError' });

  const abort = new AbortController();
  const cancelled = createSmhiObservationSource({
    fetchImpl: () => {
      abort.abort();
      return new Promise(() => {});
    },
  });
  await assert.rejects(cancelled.getSnapshot({ signal: abort.signal }), {
    name: 'AbortError',
  });
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
  const layer = createSmhiObservationsLayer({
    source,
    overlayHost: {
      setEntries(...args) {
        events.push(args);
      },
      setVisible() {},
      clearSource() {},
    },
  });
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, sources, events };
}

const row = {
  stationId: '1',
  name: 'Fixture',
  owner: 'SMHI',
  lat: 59.3,
  lon: 18.1,
  heightM: 10,
  value: 4.2,
  observedAt: HOUR,
  quality: 'G',
};

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
    resolve([row]);
    assert.equal(await pending, false);
    assert.equal(h.layer.getStats().count, 0);
    assert.equal(h.events.length, 0);
    h.layer.destroy(h.viewer);
  }
});

test('a failed refresh keeps the last good snapshot and reports the error', async () => {
  let fail = false;
  const h = harness({
    getSnapshot: async () => {
      if (fail) throw new Error('Malformed SMHI response');
      return [row];
    },
  });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.layer.getStats().count, 1);
  assert.equal(h.events.at(-1)[1][0].title, '4.2°');
  fail = true;
  assert.equal(await h.layer.update(h.viewer), false);
  const stats = h.layer.getStats();
  assert.equal(stats.count, 1);
  assert.equal(stats.error, 'Malformed SMHI response');
  h.layer.destroy();
  assert.equal(h.sources.length, 0);
});
