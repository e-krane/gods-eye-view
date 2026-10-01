import * as Cesium from 'cesium';
import { decodeLine, lineLengthKm, polygonAreaKm2 } from './geometry.js';
import {
  LANTMATERIET_LAYERS,
  LANTMATERIET_LINE_STYLES,
  lineClassVisible,
} from './model.js';
export * from './model.js';
export { createLantmaterietLineSource } from './source.js';
export {
  LANTMATERIET_DATASETS,
  STATIC_AREAS_FORMAT,
  STATIC_LINES_FORMAT,
  buildStaticAreaDataset,
  buildStaticLineDataset,
  validateLantmaterietDataset,
  validateStaticAreaDataset,
  validateStaticLineDataset,
} from './records.js';
import { LANTMATERIET_DATASETS } from './records.js';
export { decodeLine, encodeLine, sweref99tmToWgs84 } from './geometry.js';

/**
 * One primitive for every line of a class. Per-line entities would cost tens
 * of thousands of objects; a primitive batches them all and builds its
 * geometry in Cesium's web workers. Plain polylines, unlike ground-clamped
 * ones, are anti-aliased by MSAA; they lie on the ellipsoid, under the
 * terrain, so the depth-fail appearance draws them where terrain hides them.
 * The layer hides them when its data is behind the horizon.
 */
function createLinePrimitive(lines, style) {
  const color = Cesium.Color.fromCssColorString(style.color);
  const dashed = Boolean(style.gapColor);
  const appearance = () =>
    dashed
      ? new Cesium.PolylineMaterialAppearance({
          material: Cesium.Material.fromType('PolylineDash', {
            color,
            gapColor: Cesium.Color.fromCssColorString(style.gapColor),
            dashLength: style.dashLength,
          }),
        })
      : new Cesium.PolylineColorAppearance();
  const colorAttribute = Cesium.ColorGeometryInstanceAttribute.fromColor(color);
  return new Cesium.Primitive({
    geometryInstances: lines.map(
      (flat) =>
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({
            positions: Cesium.Cartesian3.fromDegreesArray(flat),
            width: style.width,
            vertexFormat: dashed
              ? Cesium.PolylineMaterialAppearance.VERTEX_FORMAT
              : Cesium.PolylineColorAppearance.VERTEX_FORMAT,
            arcType: Cesium.ArcType.GEODESIC,
          }),
          ...(dashed
            ? {}
            : {
                attributes: {
                  color: colorAttribute,
                  depthFailColor: colorAttribute,
                },
              }),
        }),
    ),
    appearance: appearance(),
    depthFailAppearance: appearance(),
    asynchronous: true,
    // Static reference lines are not pickable, so clicks reach the layers above.
    allowPicking: false,
  });
}

/**
 * Corners and centre of the data's extent on the ellipsoid, used to tell
 * whether any of it faces the camera.
 * @param {number[][]} flats Flat lon/lat lines or rings.
 */
export function extentSamplePoints(flats) {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const flat of flats)
    for (let i = 0; i < flat.length; i += 2) {
      west = Math.min(west, flat[i]);
      east = Math.max(east, flat[i]);
      south = Math.min(south, flat[i + 1]);
      north = Math.max(north, flat[i + 1]);
    }
  if (!Number.isFinite(west)) return [];
  const midLon = (west + east) / 2;
  const midLat = (south + north) / 2;
  return [
    [west, south],
    [west, north],
    [east, south],
    [east, north],
    [midLon, midLat],
    [midLon, south],
    [midLon, north],
    [west, midLat],
    [east, midLat],
  ].map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
}

/**
 * A class's ground primitives: one batched line primitive, or for areas a
 * translucent fill plus that line primitive along every ring.
 * @param {Array<number[]>|Array<number[][]>} items Flat lon/lat lines, or
 *   areas as lists of flat rings (outer ring first).
 * @param {object} style
 * @param {'line'|'area'} geometry
 */
export function createClassPrimitives(items, style, geometry = 'line') {
  if (geometry !== 'area') return [createLinePrimitive(items, style)];
  const fillColor = Cesium.ColorGeometryInstanceAttribute.fromColor(
    Cesium.Color.fromCssColorString(style.color).withAlpha(style.fillAlpha),
  );
  const toPositions = (flat) => Cesium.Cartesian3.fromDegreesArray(flat);
  const fill = new Cesium.GroundPrimitive({
    geometryInstances: items.map(
      ([outer, ...holes]) =>
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolygonGeometry({
            polygonHierarchy: new Cesium.PolygonHierarchy(
              toPositions(outer),
              holes.map(
                (hole) => new Cesium.PolygonHierarchy(toPositions(hole)),
              ),
            ),
          }),
          attributes: { color: fillColor },
        }),
    ),
    appearance: new Cesium.PerInstanceColorAppearance({
      flat: true,
      translucent: true,
    }),
    asynchronous: true,
    allowPicking: false,
  });
  return [fill, createLinePrimitive(items.flat(), style)];
}

/** `15,230 km`, rounded to whole kilometres. */
export function formatKm(km) {
  return `${Math.round(km).toLocaleString('en-US')} km`;
}

/** `1,234 km²`, rounded to whole square kilometres. */
export function formatKm2(km2) {
  return `${Math.round(km2).toLocaleString('en-US')} km²`;
}

/**
 * Own one bundled Lantmäteriet dataset: lines (power lines, railways, main
 * roads) or areas (military areas). The data is static: it loads once, on
 * first enable.
 */
export function createLantmaterietLineLayer({
  dataset,
  source,
  createPrimitives = createClassPrimitives,
  isSupported = (scene) =>
    LANTMATERIET_DATASETS[dataset]?.geometry !== 'area' ||
    Cesium.GroundPrimitive.isSupported(scene),
} = {}) {
  const meta = LANTMATERIET_LAYERS[dataset];
  const geometry = LANTMATERIET_DATASETS[dataset]?.geometry;
  const styles = LANTMATERIET_LINE_STYLES[dataset];
  if (!meta) throw new TypeError(`Unknown Lantmäteriet dataset ${dataset}`);
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Lantmäteriet lines require a snapshot source');
  let _viewer = null;
  let _removePreRender = null;
  let _request = null;
  let _enabled = false;
  let _loaded = null;
  let _lastUpdate = null;
  let _lastError = null;
  /** @type {Array<{ className: string, style: object, primitives: object[], count: number, size: number }>} */
  let _classes = [];
  /** @type {Cesium.Cartesian3[]} */
  let _samples = [];

  /** Whether any of the data is on the camera's side of the horizon. */
  function facesCamera() {
    const position = _viewer?.camera?.positionWC;
    if (!position || !_samples.length) return true;
    const occluder = new Cesium.EllipsoidalOccluder(
      Cesium.Ellipsoid.WGS84,
      position,
    );
    return _samples.some((point) => occluder.isPointVisible(point));
  }

  function applyVisibility() {
    const height = _viewer?.camera?.positionCartographic?.height;
    const facing = _enabled && facesCamera();
    for (const { style, primitives } of _classes) {
      const show =
        facing && (!Number.isFinite(height) || lineClassVisible(style, height));
      for (const primitive of primitives)
        if (primitive.show !== show) primitive.show = show;
    }
  }

  /** Area fills drape in the ground pass; lines are ordinary primitives. */
  function collectionFor(primitive) {
    return primitive instanceof Cesium.GroundPrimitive
      ? _viewer?.scene?.groundPrimitives
      : _viewer?.scene?.primitives;
  }

  function removePrimitives() {
    for (const { primitives } of _classes)
      for (const primitive of primitives)
        collectionFor(primitive)?.remove(primitive);
    _classes = [];
  }

  function draw(snapshot) {
    const items = geometry === 'area' ? snapshot.areas : snapshot.lines;
    const byClass = snapshot.classes.map(() => []);
    for (const [classIndex, , coords] of items)
      byClass[classIndex].push(
        geometry === 'area' ? coords.map(decodeLine) : decodeLine(coords),
      );
    _samples = extentSamplePoints(
      geometry === 'area' ? byClass.flat(2) : byClass.flat(),
    );
    _classes = [];
    snapshot.classes.forEach((className, index) => {
      const style = styles[className];
      const members = byClass[index];
      if (!style || !members.length) return;
      const primitives = createPrimitives(members, style, geometry);
      for (const primitive of primitives)
        collectionFor(primitive).add(primitive);
      // Lines are sized by length, areas by the ground they cover.
      const size = members.reduce(
        (sum, member) =>
          sum +
          (geometry === 'area' ? polygonAreaKm2(member) : lineLengthKm(member)),
        0,
      );
      _classes.push({
        className,
        style,
        primitives,
        count: members.length,
        size,
      });
    });
    applyVisibility();
  }

  const layer = {
    id: meta.id,
    name: meta.name,
    icon: meta.icon,
    source: 'Lantmäteriet',
    // Static data: after the first load each poll is a no-op.
    updateInterval: 24 * 60 * 60_000,

    init(viewer) {
      if (_viewer) throw new Error(`${meta.name} is already initialized`);
      _viewer = viewer;
      _removePreRender =
        viewer.scene.preRender?.addEventListener?.(applyVisibility) ?? null;
      _enabled = false;
    },

    enable() {
      _enabled = true;
      applyVisibility();
      _viewer?.scene?.requestRender?.();
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      applyVisibility();
      _viewer?.scene?.requestRender?.();
    },

    async update() {
      if (!_enabled || !_viewer) return false;
      if (_loaded) return true;
      if (!isSupported(_viewer.scene)) {
        _lastError = 'Ground areas unsupported by this browser';
        return false;
      }
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_viewer)
          return false;
        draw(snapshot);
        _loaded = snapshot;
        _lastUpdate = Date.now();
        _lastError = null;
        _viewer?.scene?.requestRender?.();
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request) return false;
        console.warn(`[Data:Lantmäteriet] ${dataset}:`, e);
        _lastError = e?.message || 'Lantmäteriet dataset unavailable';
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _removePreRender?.();
      _removePreRender = null;
      if (viewer) _viewer = viewer;
      removePrimitives();
      _samples = [];
      _viewer = null;
      _enabled = false;
      _loaded = null;
      _lastUpdate = null;
      _lastError = null;
    },

    getRowControls() {
      const drawn = new Map(_classes.map((c) => [c.className, c]));
      return {
        chips: [],
        legend: Object.entries(styles).map(([className, style], index) => {
          const entry = drawn.get(className);
          return {
            // Lines are merged pieces, so total length is the meaningful
            // size; areas show how many there are and the ground they cover.
            label: !entry
              ? style.label
              : geometry === 'area'
                ? `${style.label} · ${entry.count} · ${formatKm2(entry.size)}`
                : `${style.label} · ${formatKm(entry.size)}`,
            color: style.color,
            count: null,
            ...(index === 0 ? { blurb: meta.blurb } : {}),
          };
        }),
      };
    },

    getStats() {
      return {
        count: (_loaded?.lines ?? _loaded?.areas)?.length ?? 0,
        lastUpdate: _lastUpdate,
        // The panel shows when Lantmäteriet produced the bundled data.
        source: _loaded
          ? `Lantmäteriet, ${_loaded.producedAt.slice(0, 10)}`
          : 'Lantmäteriet',
        error: _lastError,
      };
    },
  };
  return layer;
}
