import * as Cesium from 'cesium';
import { decodeLine, lineLengthKm } from './geometry.js';
import {
  LANTMATERIET_LAYERS,
  LANTMATERIET_LINE_STYLES,
  lineClassVisible,
} from './model.js';
export * from './model.js';
export { createLantmaterietLineSource } from './source.js';
export {
  LANTMATERIET_DATASETS,
  STATIC_LINES_FORMAT,
  buildStaticLineDataset,
  validateStaticLineDataset,
} from './records.js';
export { decodeLine, encodeLine, sweref99tmToWgs84 } from './geometry.js';

/**
 * One ground-clamped primitive for every line of a class. Per-line entities
 * would cost tens of thousands of objects; a primitive batches them all and
 * builds its geometry in Cesium's web workers.
 */
export function createClassPrimitive(lines, style) {
  const color = Cesium.Color.fromCssColorString(style.color);
  const geometryInstances = lines.map(
    (flat) =>
      new Cesium.GeometryInstance({
        geometry: new Cesium.GroundPolylineGeometry({
          positions: Cesium.Cartesian3.fromDegreesArray(flat),
          width: style.width,
        }),
        ...(style.gapColor
          ? {}
          : {
              attributes: {
                color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
              },
            }),
      }),
  );
  const appearance = style.gapColor
    ? new Cesium.PolylineMaterialAppearance({
        material: Cesium.Material.fromType('PolylineDash', {
          color,
          gapColor: Cesium.Color.fromCssColorString(style.gapColor),
          dashLength: style.dashLength,
        }),
      })
    : new Cesium.PolylineColorAppearance();
  return new Cesium.GroundPolylinePrimitive({
    geometryInstances,
    appearance,
    asynchronous: true,
    // Static reference lines are not pickable, so clicks reach the layers above.
    allowPicking: false,
  });
}

/** `15,230 km`, rounded to whole kilometres. */
export function formatKm(km) {
  return `${Math.round(km).toLocaleString('en-US')} km`;
}

/**
 * Own one bundled Lantmäteriet line dataset (power lines, railways or main
 * roads). The data is static: it loads once, on first enable.
 */
export function createLantmaterietLineLayer({
  dataset,
  source,
  createPrimitive = createClassPrimitive,
  isSupported = (scene) => Cesium.GroundPolylinePrimitive.isSupported(scene),
} = {}) {
  const meta = LANTMATERIET_LAYERS[dataset];
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
  /** @type {Array<{ className: string, style: object, primitive: Cesium.GroundPolylinePrimitive, km: number }>} */
  let _classes = [];

  function applyVisibility() {
    const height = _viewer?.camera?.positionCartographic?.height;
    for (const { style, primitive } of _classes) {
      const show =
        _enabled &&
        (!Number.isFinite(height) || lineClassVisible(style, height));
      if (primitive.show !== show) primitive.show = show;
    }
  }

  function removePrimitives() {
    for (const { primitive } of _classes)
      _viewer?.scene?.groundPrimitives?.remove(primitive);
    _classes = [];
  }

  function draw(snapshot) {
    const byClass = snapshot.classes.map(() => []);
    for (const [classIndex, , encoded] of snapshot.lines)
      byClass[classIndex].push(decodeLine(encoded));
    _classes = [];
    snapshot.classes.forEach((className, index) => {
      const style = styles[className];
      if (!style || !byClass[index].length) return;
      const primitive = createPrimitive(byClass[index], style);
      _viewer.scene.groundPrimitives.add(primitive);
      const km = byClass[index].reduce(
        (sum, flat) => sum + lineLengthKm(flat),
        0,
      );
      _classes.push({ className, style, primitive, km });
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
        _lastError = 'Ground lines unsupported by this browser';
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
      _viewer = null;
      _enabled = false;
      _loaded = null;
      _lastUpdate = null;
      _lastError = null;
    },

    getRowControls() {
      const lengths = new Map(_classes.map((c) => [c.className, c.km]));
      return {
        chips: [],
        legend: Object.entries(styles).map(([className, style], index) => ({
          // Lines are merged pieces, so total length is the meaningful size.
          label: lengths.has(className)
            ? `${style.label} · ${formatKm(lengths.get(className))}`
            : style.label,
          color: style.color,
          count: null,
          ...(index === 0 ? { blurb: meta.blurb } : {}),
        })),
      };
    },

    getStats() {
      return {
        count: _loaded?.lines.length ?? 0,
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
