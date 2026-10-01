import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RELIEF_PALETTE,
  RELIEF_SITES,
  hillshade,
  latToTileY,
  lonToTileX,
  pixelToLat,
  pixelToLon,
  reliefIndex,
  siteTileRange,
  validateReliefManifest,
} from './relief.js';
import { createLantmaterietReliefLayer } from './reliefLayer.js';
import { createLantmaterietReliefSource } from './source.js';

test('tile maths round-trips between degrees and mercator pixels', () => {
  const z = 15;
  const x = lonToTileX(14.13, z);
  const y = latToTileY(57.43, z);
  assert.ok(pixelToLon(x * 256, z) <= 14.13);
  assert.ok(pixelToLon((x + 1) * 256, z) > 14.13);
  assert.ok(pixelToLat(y * 256, z) >= 57.43);
  assert.ok(pixelToLat((y + 1) * 256, z) < 57.43);
  for (const site of RELIEF_SITES) {
    const range = siteTileRange(site, site.maxZoom);
    assert.ok(range.x1 >= range.x0 && range.y1 >= range.y0, site.id);
  }
});

function grid(width, height, fn) {
  const out = new Float32Array(width * height);
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) out[row * width + col] = fn(col, row);
  return out;
}

test('hillshade lights slopes facing the north-west key light', () => {
  const size = 5;
  const flat = hillshade(
    grid(size, size, () => 100),
    size,
    size,
    2,
  );
  const centre = 2 * size + 2;
  assert.ok(Math.abs(flat[centre] - Math.sin(Math.PI / 4)) < 1e-6);
  assert.ok(Number.isNaN(flat[0]), 'edges have no full neighbourhood');
  // Ground rising to the east faces west, towards the key light's side.
  const westFacing = hillshade(
    grid(size, size, (col) => col * 2),
    size,
    size,
    2,
  );
  const eastFacing = hillshade(
    grid(size, size, (col) => -col * 2),
    size,
    size,
    2,
  );
  assert.ok(westFacing[centre] > eastFacing[centre]);
  // Ground rising to the south (rows run south) faces north, also lit.
  const northFacing = hillshade(
    grid(size, size, (_, row) => row * 2),
    size,
    size,
    2,
  );
  const southFacing = hillshade(
    grid(size, size, (_, row) => -row * 2),
    size,
    size,
    2,
  );
  assert.ok(northFacing[centre] > southFacing[centre]);
  const gap = grid(size, size, () => 100);
  gap[centre - 1] = NaN;
  assert.ok(Number.isNaN(hillshade(gap, size, size, 2)[centre]));
});

test('relief pixels: flat is clear, shadows dark, highlights faint white', () => {
  const flat = Math.sin(Math.PI / 4);
  assert.equal(reliefIndex(flat), 0);
  assert.equal(reliefIndex(NaN), 0);
  assert.equal(reliefIndex(0), 10, 'full shadow is the darkest level');
  const lit = reliefIndex(1);
  assert.equal(lit, 15);
  assert.equal(RELIEF_PALETTE.length, 16);
  assert.deepEqual(RELIEF_PALETTE[0], [0, 0]);
  assert.equal(RELIEF_PALETTE[10][0], 0);
  assert.equal(RELIEF_PALETTE[15][0], 255);
  assert.ok(RELIEF_PALETTE[10][1] > RELIEF_PALETTE[1][1]);
});

function manifest(overrides = {}) {
  return {
    format: 'gev-relief-sites/1',
    builtAt: '2026-10-01',
    attribution: '© Lantmäteriet',
    sites: [
      {
        id: 'skillingaryd',
        name: 'Skillingaryd',
        west: 14.09,
        south: 57.37,
        east: 14.18,
        north: 57.49,
        minZoom: 11,
        maxZoom: 15,
        producedAt: '2026-10-01',
      },
    ],
    ...overrides,
  };
}

test('manifest validation and the source', async () => {
  assert.ok(validateReliefManifest(manifest()));
  for (const bad of [
    { format: 'x' },
    { sites: [] },
    { sites: [{ ...manifest().sites[0], id: '../etc' }] },
    { sites: [{ ...manifest().sites[0], west: 20 }] },
    { sites: [{ ...manifest().sites[0], minZoom: 16 }] },
  ])
    assert.equal(validateReliefManifest(manifest(bad)), null);

  const source = createLantmaterietReliefSource({
    baseUrl: '/tiles/',
    fetchImpl: async (url) => {
      assert.equal(url, '/tiles/manifest.json');
      return new Response(JSON.stringify(manifest()));
    },
  });
  const snapshot = await source.getSnapshot();
  assert.equal(
    snapshot.sites[0].template,
    '/tiles/skillingaryd/{z}/{x}/{y}.png',
  );
  assert.throws(() => createLantmaterietReliefSource({ baseUrl: '/tiles' }));
  await assert.rejects(
    createLantmaterietReliefSource({
      baseUrl: '/t/',
      fetchImpl: async () => new Response('{}'),
    }).getSnapshot(),
    /Malformed relief manifest/,
  );
});

function harness({ hostKind = 'globe' } = {}) {
  const collections = { globe: [], tileset: [] };
  const collection = (name) => ({
    addImageryProvider(provider) {
      const layer = { provider };
      collections[name].push(layer);
      return layer;
    },
    remove(layer) {
      collections[name].splice(collections[name].indexOf(layer), 1);
      return true;
    },
  });
  const hosts = { globe: collection('globe'), tileset: collection('tileset') };
  const state = { kind: hostKind };
  const preRender = [];
  const flights = [];
  const viewer = {
    camera: { flyTo: (options) => flights.push(options) },
    scene: {
      preRender: {
        addEventListener(fn) {
          preRender.push(fn);
          return () => preRender.splice(preRender.indexOf(fn), 1);
        },
      },
      requestRender() {},
    },
  };
  let fetches = 0;
  const layer = createLantmaterietReliefLayer({
    source: createLantmaterietReliefSource({
      baseUrl: '/tiles/',
      fetchImpl: async () => {
        fetches++;
        return new Response(JSON.stringify(manifest()));
      },
    }),
    host: () =>
      state.kind === 'none'
        ? { collection: null, kind: 'none' }
        : { collection: hosts[state.kind], kind: state.kind },
  });
  layer.init(viewer);
  return {
    layer,
    viewer,
    collections,
    state,
    flights,
    fetches: () => fetches,
    frame: () => preRender.forEach((fn) => fn()),
  };
}

test('relief drapes one imagery layer per site and follows the map stack', async () => {
  const h = harness();
  assert.equal(h.layer.id, 'lantmateriet-relief');
  h.layer.enable(h.viewer);
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.fetches(), 1, 'the manifest loads once');
  assert.equal(h.collections.globe.length, 1);
  const provider = h.collections.globe[0].provider;
  assert.equal(provider.url, '/tiles/skillingaryd/{z}/{x}/{y}.png');
  assert.equal(provider.minimumLevel, 11);
  assert.equal(provider.maximumLevel, 15);

  // Switching to the photoreal stack moves the drape to the tileset.
  h.state.kind = 'tileset';
  h.frame();
  assert.equal(h.collections.globe.length, 0);
  assert.equal(h.collections.tileset.length, 1);
  h.state.kind = 'none';
  h.frame();
  assert.equal(h.collections.tileset.length, 0);
  assert.match(h.layer.getStats().source, /choose a globe map/);
  h.state.kind = 'globe';
  h.frame();

  const { chips } = h.layer.getRowControls();
  assert.deepEqual(
    chips.map((chip) => chip.label),
    ['Skillingaryd'],
  );
  chips[0].onClick();
  assert.equal(h.flights.length, 1);
  assert.equal(h.layer.getStats().count, 1);
  assert.equal(h.layer.getStats().source, 'Lantmäteriet, 2026-10-01');

  h.layer.disable(h.viewer);
  assert.equal(h.collections.globe.length, 0, 'disabled relief loads no tiles');
  h.layer.enable(h.viewer);
  assert.equal(h.collections.globe.length, 1);
  h.layer.destroy(h.viewer);
  assert.equal(h.collections.globe.length, 0);
});
