import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeabedIncidentsLayer } from './index.js';
import { SEABED_DATASET_AS_OF, SEABED_INCIDENTS } from './incidents.js';
import {
  buildSeabedCard,
  createSeabedLabelEntry,
  seabedIncidentTitle,
  seabedMonth,
  SEABED_CARD_SOURCE_ID,
  SEABED_LABEL_SOURCE_ID,
} from './model.js';
import { isSeabedIncident, validateSeabedIncidents } from './records.js';
import { createSeabedIncidentSource } from './source.js';

const NOW = Date.parse('2026-09-30T12:00:00Z');

function incident(overrides = {}) {
  return {
    id: 'example-2024-12',
    date: '2024-12-25',
    title: 'Example cable',
    assets: ['Example cable (Finland–Estonia)'],
    vessel: 'Example Tanker (Cook Islands)',
    status: 'suspected',
    statusAsOf: '2025-10-03',
    lon: 24.9,
    lat: 59.9,
    uncertaintyKm: 10,
    locationBasis: 'Operator said the fault lies mid-gulf.',
    summary: 'A cable was damaged; a tanker dragging its anchor was detained.',
    sources: [
      {
        title: 'Example report',
        publisher: 'Example News',
        url: 'https://example.org/report',
        date: '2024-12-26',
      },
    ],
    ...overrides,
  };
}

test('the bundled dataset is complete, sourced and dated', () => {
  const rows = validateSeabedIncidents(SEABED_INCIDENTS);
  assert.ok(rows, 'every bundled incident passes validation');
  assert.ok(rows.length > 0);
  assert.match(SEABED_DATASET_AS_OF, /^\d{4}-\d{2}-\d{2}$/);
  for (const row of rows) assert.ok(row.statusAsOf <= SEABED_DATASET_AS_OF);
});

test('validation requires status, position, uncertainty and https sources', () => {
  assert.equal(isSeabedIncident(incident()), true);
  assert.equal(isSeabedIncident(incident({ vessel: null })), true);
  for (const bad of [
    { id: 'Not Slug' },
    { date: '25/12/2024' },
    { status: 'sabotage' },
    { statusAsOf: '2024-12-01' },
    { lon: 40 },
    { lat: 70 },
    { uncertaintyKm: 0 },
    { assets: [] },
    { summary: '' },
    { sources: [] },
    { sources: [{ ...incident().sources[0], url: 'http://example.org' }] },
    { sources: [{ ...incident().sources[0], url: 'not a url' }] },
  ])
    assert.equal(isSeabedIncident(incident(bad)), false, JSON.stringify(bad));
  assert.equal(validateSeabedIncidents([incident(), incident()]), null);
  assert.deepEqual(
    validateSeabedIncidents([
      incident({ id: 'older', date: '2023-10-08', statusAsOf: '2024-01-01' }),
      incident({ id: 'newer' }),
    ]).map(({ id }) => id),
    ['newer', 'older'],
  );
});

test('labels and cards name the incident, its status and its source', () => {
  assert.equal(seabedMonth('2024-12-25'), 'Dec 2024');
  assert.equal(seabedIncidentTitle(incident()), 'Example cable · Dec 2024');
  const label = createSeabedLabelEntry({ incident: incident(), position: 'p' });
  assert.equal(label.title, 'Example cable · Dec 2024');
  assert.equal(label.accent, '#fb8c00');
  const ruled = createSeabedLabelEntry({
    incident: incident({ status: 'ruled_accidental' }),
    position: 'p',
  });
  assert.ok(label.priority > ruled.priority, 'serious statuses win');

  const card = buildSeabedCard(incident({ summary: 'x'.repeat(300) }));
  assert.equal(card.title, 'SEABED · Example cable');
  assert.deepEqual(card.details.slice(0, 3), [
    '2024-12-25 · Suspected sabotage (as of 2025-10-03)',
    'Example cable (Finland–Estonia)',
    'Vessel: Example Tanker (Cook Islands)',
  ]);
  assert.equal(card.details[3].length, 160);
  assert.equal(card.details.at(-1), 'Example News ↗ · click card to open');
  assert.equal(
    buildSeabedCard(incident({ vessel: null })).details.includes(
      'Vessel: Example Tanker (Cook Islands)',
    ),
    false,
  );
});

test('source validates the dataset before serving it', async () => {
  const snapshot = await createSeabedIncidentSource({
    incidents: [incident()],
    asOf: '2026-09-30',
  }).getSnapshot();
  assert.equal(snapshot.incidents.length, 1);
  assert.equal(snapshot.asOf, '2026-09-30');
  await assert.rejects(
    createSeabedIncidentSource({
      incidents: [incident({ status: 'x' })],
    }).getSnapshot(),
    /Malformed seabed incident dataset/,
  );
});

function harness(incidents = [incident()]) {
  const sources = [];
  const overlay = { entries: new Map(), visible: new Map() };
  const handlers = [];
  const opened = [];
  let pickResult = null;
  let cardHit = null;
  const viewer = {
    dataSources: {
      add(value) {
        sources.push(value);
      },
      remove(value) {
        sources.splice(sources.indexOf(value), 1);
      },
    },
    scene: { pick: () => pickResult },
  };
  const layer = createSeabedIncidentsLayer({
    source: createSeabedIncidentSource({ incidents, asOf: '2026-09-30' }),
    overlayHost: {
      setEntries(id, entries) {
        overlay.entries.set(id, entries);
      },
      setVisible(id, visible) {
        overlay.visible.set(id, visible);
      },
      clearSource(id) {
        overlay.entries.delete(id);
      },
      hitTest: () => cardHit,
    },
    screenSpaceEventHandlerFactory: () => {
      const handler = {
        destroyed: false,
        setInputAction(action) {
          handler.action = action;
        },
        destroy() {
          handler.destroyed = true;
        },
      };
      handlers.push(handler);
      return handler;
    },
    picking: {
      resolvePickId: (picked) => picked?.id?.id ?? null,
      isOwnedByOtherLayer: (layerId, pickId) => pickId === 'other:1',
    },
    openExternal: (url) => opened.push(url),
    now: () => NOW,
  });
  layer.init(viewer);
  layer.enable(viewer);
  const click = (picked, hit = null) => {
    pickResult = picked;
    cardHit = hit;
    handlers.at(-1).action({ position: { x: 1, y: 2 } });
  };
  return { layer, viewer, sources, overlay, handlers, opened, click };
}

test('layer draws a point and uncertainty circle per incident with labels', async () => {
  const h = harness();
  assert.equal(await h.layer.update(h.viewer), true);
  const entities = h.sources[0].entities.values;
  assert.deepEqual(
    entities.map((entity) => entity.id),
    [
      'baltic-seabed-incidents:example-2024-12',
      'baltic-seabed-incidents:example-2024-12:area',
    ],
  );
  assert.ok(entities[0].point);
  assert.equal(entities[1].ellipse.semiMajorAxis.getValue(), 10_000);
  assert.equal(
    h.overlay.entries.get(SEABED_LABEL_SOURCE_ID)[0].title,
    'Example cable · Dec 2024',
  );
  assert.deepEqual(h.layer.getStats(), {
    count: 1,
    lastUpdate: NOW,
    source: 'Curated, as of 2026-09-30',
    error: null,
  });
  const legend = h.layer.getRowControls().legend;
  assert.equal(
    legend.find((row) => row.label === 'Suspected sabotage').count,
    1,
  );
  assert.equal(h.layer.getAnalystRecords()[0].status, 'suspected');
  h.layer.destroy();
  assert.equal(h.sources.length, 0);
  assert.equal(h.handlers[0].destroyed, true);
});

test('clicking an incident opens its card; clicking the card opens the source', async () => {
  const h = harness();
  await h.layer.update(h.viewer);
  const circle = { id: { id: 'baltic-seabed-incidents:example-2024-12:area' } };
  h.click(circle);
  const [card] = h.overlay.entries.get(SEABED_CARD_SOURCE_ID);
  assert.equal(card.title, 'SEABED · Example cable');
  assert.ok(card.position);
  assert.equal(card.activate(), true);
  assert.deepEqual(h.opened, ['https://example.org/report']);

  h.click(null, { entryId: card.id });
  assert.deepEqual(h.opened.length, 2);

  // A sibling layer's pick leaves the card; empty space clears it.
  h.click({ id: { id: 'other:1' } });
  assert.equal(h.overlay.entries.get(SEABED_CARD_SOURCE_ID).length, 1);
  h.click(null);
  assert.equal(h.overlay.entries.get(SEABED_CARD_SOURCE_ID).length, 0);

  h.layer.disable();
  assert.equal(h.handlers[0].destroyed, true);
  assert.equal(h.overlay.visible.get(SEABED_LABEL_SOURCE_ID), false);
  h.layer.destroy();
});

test('a malformed dataset reports an error and draws nothing', async () => {
  const h = harness([incident({ lat: 99 })]);
  assert.equal(await h.layer.update(h.viewer), false);
  assert.equal(h.layer.getStats().error, 'Malformed seabed incident dataset');
  assert.equal(h.sources[0].entities.values.length, 0);
  h.layer.destroy();
});
