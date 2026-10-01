import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeLine,
  encodeLine,
  lineLengthKm,
  mergeLines,
  parseGpkgLines,
  simplifyLine,
  sweref99tmToWgs84,
  wgs84ToSweref99tm,
} from './geometry.js';
import { createLantmaterietLineLayer, formatKm } from './index.js';
import { LANTMATERIET_LINE_STYLES, lineClassVisible } from './model.js';
import {
  buildStaticLineDataset,
  validateStaticLineDataset,
} from './records.js';
import { createLantmaterietLineSource } from './source.js';

const close = (actual, expected, tolerance, message) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: ${actual} vs ${expected}`,
  );

test('SWEREF 99 TM matches the projection definition and round-trips', () => {
  // On the central meridian the equator maps to the false easting.
  const [lon0, lat0] = sweref99tmToWgs84(500000, 0);
  close(lon0, 15, 1e-9, 'lon');
  close(lat0, 0, 1e-9, 'lat');
  // GRS80 meridian arc to 60° N is 6 654 072.82 m; scaled by 0.9996.
  const [e60, n60] = wgs84ToSweref99tm(15, 60);
  close(e60, 500000, 1e-6, 'easting');
  close(n60, 6654072.82 * 0.9996, 0.05, 'northing');
  for (const [lon, lat] of [
    [18.0686, 59.3293], // Stockholm
    [11.9746, 57.7089], // Göteborg
    [22.1547, 65.5848], // Luleå
    [24.15, 68.8], // far north-east, 9° off the central meridian
  ]) {
    const [e, n] = wgs84ToSweref99tm(lon, lat);
    const [lon2, lat2] = sweref99tmToWgs84(e, n);
    close(lon2, lon, 1e-9, 'round-trip lon');
    close(lat2, lat, 1e-9, 'round-trip lat');
  }
  // Stockholm lands where SWEREF 99 TM maps put it.
  const [e, n] = wgs84ToSweref99tm(18.0686, 59.3293);
  close(e, 674_000, 1_000, 'Stockholm easting');
  close(n, 6_580_800, 1_000, 'Stockholm northing');
});

function wkbLine(points, { iso3d = false, big = false } = {}) {
  const dims = iso3d ? 3 : 2;
  const bytes = new DataView(new ArrayBuffer(9 + points.length * 8 * dims));
  const little = !big;
  bytes.setUint8(0, little ? 1 : 0);
  bytes.setUint32(1, iso3d ? 1002 : 2, little);
  bytes.setUint32(5, points.length, little);
  points.forEach(([x, y], i) => {
    const offset = 9 + i * 8 * dims;
    bytes.setFloat64(offset, x, little);
    bytes.setFloat64(offset + 8, y, little);
    if (iso3d) bytes.setFloat64(offset + 16, 42, little);
  });
  return new Uint8Array(bytes.buffer);
}

function wkbMulti(parts) {
  const head = new DataView(new ArrayBuffer(9));
  head.setUint8(0, 1);
  head.setUint32(1, 1005, true);
  head.setUint32(5, parts.length, true);
  return concat(new Uint8Array(head.buffer), ...parts);
}

function concat(...arrays) {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  for (const array of arrays) {
    out.set(array, offset);
    offset += array.length;
  }
  return out;
}

/** A GeoPackage geometry header (optionally with an XY envelope) and WKB. */
function gpkg(wkb, { envelope = false } = {}) {
  const header = new DataView(new ArrayBuffer(8 + (envelope ? 32 : 0)));
  header.setUint8(0, 0x47);
  header.setUint8(1, 0x50);
  header.setUint8(3, 1 | (envelope ? 2 : 0));
  header.setInt32(4, 3006, true);
  return concat(new Uint8Array(header.buffer), wkb);
}

test('GeoPackage blobs yield lines in every WKB flavour Lantmäteriet may use', () => {
  const line = [
    [600000, 6600000],
    [600100, 6600100],
  ];
  assert.deepEqual(parseGpkgLines(gpkg(wkbLine(line))), [line]);
  assert.deepEqual(
    parseGpkgLines(gpkg(wkbLine(line, { big: true }), { envelope: true })),
    [line],
  );
  const z = wkbLine(line, { iso3d: true });
  assert.deepEqual(parseGpkgLines(gpkg(wkbMulti([z, z]))), [line, line]);
  // EWKB Z flag instead of ISO 1000s.
  const ewkb = wkbLine(line, { iso3d: true });
  new DataView(ewkb.buffer).setUint32(1, 0x80000002, true);
  assert.deepEqual(parseGpkgLines(gpkg(ewkb)), [line]);

  assert.deepEqual(parseGpkgLines(new Uint8Array([1, 2, 3])), []);
  assert.deepEqual(parseGpkgLines(gpkg(wkbLine(line)).slice(0, 20)), []);
  const point = new DataView(new ArrayBuffer(21));
  point.setUint8(0, 1);
  point.setUint32(1, 1, true);
  assert.deepEqual(parseGpkgLines(gpkg(new Uint8Array(point.buffer))), []);
  const empty = gpkg(wkbLine(line));
  empty[3] |= 0x10;
  assert.deepEqual(parseGpkgLines(empty), []);
});

test('segments merge through simple junctions but stop at real ones', () => {
  const a = [
    [0, 0],
    [10, 0],
  ];
  const b = [
    [20, 0],
    [10, 0],
  ]; // reversed, shares a's end
  const c = [
    [20, 0],
    [30, 0],
  ];
  assert.deepEqual(
    mergeLines([b, c, a]).map((l) => l.length),
    [4],
  );
  const merged = mergeLines([b, c, a])[0];
  assert.deepEqual([merged[0], merged.at(-1)].sort(), [
    [0, 0],
    [30, 0],
  ]);
  // A third line at the junction keeps all three separate.
  const spur = [
    [10, 0],
    [10, 10],
  ];
  assert.equal(mergeLines([a, b, spur]).length, 3);
  // A closed loop of two pieces becomes one line.
  const loop = mergeLines([
    [
      [0, 0],
      [5, 5],
      [10, 0],
    ],
    [
      [10, 0],
      [5, -5],
      [0, 0],
    ],
  ]);
  assert.equal(loop.length, 1);
  assert.equal(loop[0].length, 5);
});

test('simplification keeps shape within tolerance and both endpoints', () => {
  const wiggle = [
    [0, 0],
    [10, 1],
    [20, -1],
    [30, 0],
    [40, 50],
    [50, 0],
  ];
  assert.deepEqual(simplifyLine(wiggle, 5), [
    [0, 0],
    [30, 0],
    [40, 50],
    [50, 0],
  ]);
  assert.deepEqual(simplifyLine(wiggle.slice(0, 2), 5), wiggle.slice(0, 2));
});

test('line encoding is delta integers and decodes back', () => {
  const encoded = encodeLine([
    [18.123456, 59.5],
    [18.123459, 59.5], // same after rounding: dropped
    [18.2, 59.4],
  ]);
  assert.deepEqual(encoded, [1812346, 5950000, 7654, -10000]);
  assert.deepEqual(decodeLine(encoded), [18.12346, 59.5, 18.2, 59.4]);
  close(lineLengthKm([18, 59, 18, 60]), 111.19, 0.01, 'one degree of latitude');
});

function row(objekttypnr, points, label = null) {
  return {
    objekttypnr,
    label,
    lines: [points.map(([lon, lat]) => wgs84ToSweref99tm(lon, lat))],
  };
}

test('datasets keep wanted classes, merge per road number and validate', () => {
  const built = buildStaticLineDataset(
    'roads',
    [
      row(
        1801,
        [
          [18, 59],
          [18.1, 59.1],
        ],
        'E4',
      ),
      row(
        1801,
        [
          [18.1, 59.1],
          [18.3, 59.1],
        ],
        ' E4 ',
      ),
      row(
        1801,
        [
          [18.2, 59.2],
          [18.3, 59.3],
        ],
        'E18',
      ),
      row(1806, [
        [17, 58],
        [17.1, 58.1],
      ]), // small road: not a main road
      row(1804, [
        [16, 57],
        [16.1, 57.1],
      ]),
    ],
    { producedAt: '2026-09-15' },
  );
  assert.equal(built.format, 'gev-static-lines/1');
  assert.deepEqual(built.classes, [
    'motorvag',
    'motortrafikled',
    'motesfri',
    'landsvag',
  ]);
  assert.deepEqual(
    built.lines.map(([cls, label, coords]) => [cls, label, coords.length]),
    [
      [0, 'E18', 4],
      [0, 'E4', 6], // two E4 pieces joined; E18 kept apart
      [3, null, 4],
    ],
  );
  const e4 = decodeLine(built.lines[1][2]);
  assert.deepEqual(
    [e4[0], e4[1], e4.at(-2), e4.at(-1)].sort(),
    [18, 59, 18.3, 59.1].sort(),
  );
  assert.equal(validateStaticLineDataset(built, 'roads'), built);

  const power = buildStaticLineDataset(
    'power',
    [
      row(
        1702,
        [
          [15, 60],
          [15.5, 60.5],
        ],
        'ignored',
      ),
    ],
    { producedAt: '2026-09-15' },
  );
  assert.equal(power.lines[0][1], null, 'power lines carry no label');

  for (const bad of [
    { ...built, format: 'x' },
    { ...built, dataset: 'rail' },
    { ...built, producedAt: 'soon' },
    { ...built, classes: ['motorvag'] },
    { ...built, lines: [[9, null, [1, 2, 3, 4]]] },
    { ...built, lines: [[0, 7, [1, 2, 3, 4]]] },
    { ...built, lines: [[0, null, [1, 2, 3]]] },
    { ...built, lines: [[0, null, [1, 2, 3.5, 4]]] },
  ])
    assert.equal(validateStaticLineDataset(bad, 'roads'), null);
  assert.equal(validateStaticLineDataset(built, 'power'), null);
});

const response = (value, status = 200) =>
  new Response(JSON.stringify(value), { status });

function powerDataset() {
  return buildStaticLineDataset(
    'power',
    [
      row(1702, [
        [15, 60],
        [16, 60],
      ]),
      row(1703, [
        [14, 58],
        [14, 58.1],
      ]),
    ],
    { producedAt: '2026-09-15T10:00:00Z' },
  );
}

test('source serves only a valid dataset', async () => {
  const make = (reply) =>
    createLantmaterietLineSource({
      dataset: 'power',
      url: 'power.json',
      fetchImpl: async () => reply,
    });
  const snapshot = await make(response(powerDataset())).getSnapshot();
  assert.equal(snapshot.lines.length, 2);
  await assert.rejects(
    make(response({ format: 'nope' })).getSnapshot(),
    /Malformed Lantmäteriet dataset/,
  );
  await assert.rejects(
    make(response({}, 404)).getSnapshot(),
    /unavailable \(HTTP 404\)/,
  );
  assert.throws(() => createLantmaterietLineSource({ dataset: 'pipes' }));
});

test('classes hide above their height limit', () => {
  const { stam, region } = LANTMATERIET_LINE_STYLES.power;
  assert.equal(lineClassVisible(stam, 9e9), true);
  assert.equal(lineClassVisible(region, 1_000_000), true);
  assert.equal(lineClassVisible(region, 2_000_000), false);
  assert.equal(formatKm(15229.6), '15,230 km');
});

function harness(source, { supported = true } = {}) {
  const added = [];
  const preRender = [];
  const viewer = {
    camera: { positionCartographic: { height: 2_000_000 } },
    scene: {
      groundPrimitives: {
        add(value) {
          added.push(value);
          return value;
        },
        remove(value) {
          added.splice(added.indexOf(value), 1);
          return true;
        },
      },
      preRender: {
        addEventListener(fn) {
          preRender.push(fn);
          return () => preRender.splice(preRender.indexOf(fn), 1);
        },
      },
      requestRender() {},
    },
  };
  const layer = createLantmaterietLineLayer({
    dataset: 'power',
    source,
    createPrimitive: (lines, style) => ({ lines, style, show: true }),
    isSupported: () => supported,
  });
  layer.init(viewer);
  return { layer, viewer, added, preRender };
}

test('layer loads once on enable and draws one primitive per class', async () => {
  let fetches = 0;
  const h = harness({
    getSnapshot: async () => {
      fetches++;
      return powerDataset();
    },
  });
  assert.equal(h.layer.id, 'lantmateriet-power-lines');
  assert.equal(await h.layer.update(h.viewer), false, 'nothing while disabled');
  h.layer.enable(h.viewer);
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(fetches, 1, 'static data loads once');
  const [stam, region] = h.added;
  assert.equal(h.added.length, 2, 'one primitive per class');
  assert.equal(stam.style.label, 'Main grid (>200 kV)');
  assert.equal(stam.lines[0].length, 4, 'decoded flat lon/lat');
  // At 2 000 km the regional class is hidden; lower down it shows.
  assert.equal(stam.show, true);
  assert.equal(region.show, false);
  h.viewer.camera.positionCartographic.height = 500_000;
  h.preRender.forEach((fn) => fn());
  assert.equal(region.show, true);

  const stats = h.layer.getStats();
  assert.equal(stats.count, 2);
  assert.equal(stats.source, 'Lantmäteriet, 2026-09-15');
  const legend = h.layer.getRowControls().legend;
  assert.match(legend[0].label, /^Main grid \(>200 kV\) · 5\d km$/);
  assert.equal(legend[0].count, null);
  assert.ok(legend[0].blurb);

  h.layer.disable(h.viewer);
  assert.equal(stam.show, false);
  assert.equal(region.show, false);
  h.layer.enable(h.viewer);
  assert.equal(stam.show, true, 're-enable shows without refetching');
  assert.equal(fetches, 1);
  h.layer.destroy(h.viewer);
  assert.equal(h.added.length, 0);
  assert.equal(h.preRender.length, 0);
});

test('without ground-line support the layer reports it and draws nothing', async () => {
  const h = harness(
    { getSnapshot: async () => powerDataset() },
    { supported: false },
  );
  h.layer.enable(h.viewer);
  assert.equal(await h.layer.update(h.viewer), false);
  assert.match(h.layer.getStats().error, /unsupported/);
  assert.equal(h.added.length, 0);
  h.layer.destroy(h.viewer);
});

test('a missing dataset reports an error and can retry', async () => {
  let fail = true;
  const h = harness({
    getSnapshot: async () => {
      if (fail) throw new Error('Lantmäteriet dataset unavailable (HTTP 404)');
      return powerDataset();
    },
  });
  h.layer.enable(h.viewer);
  assert.equal(await h.layer.update(h.viewer), false);
  assert.match(h.layer.getStats().error, /HTTP 404/);
  fail = false;
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.layer.getStats().error, null);
  h.layer.destroy(h.viewer);
});
