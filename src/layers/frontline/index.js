import * as Cesium from 'cesium';
import { FRONTLINE_STYLE, frontlineDayIsStale } from './model.js';
export * from './model.js';
export { createFrontlineSource } from './source.js';
export { deepstateDay, normalizeDeepstateGeojson } from './records.js';

const positions = (ring) => Cesium.Cartesian3.fromDegreesArray(ring.flat());

/** Own one DeepStateMap occupied-territory display and its refresh lifecycle. */
export function createFrontlineLayer({ source, now = () => Date.now() } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Ukraine frontline requires a snapshot source');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _signature = null;
  let _date = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;

  function reset() {
    _signature = null;
    _date = null;
    _count = 0;
    _lastUpdate = null;
    _lastError = null;
    _stale = false;
  }

  function polygonEntities(rings, index) {
    const color = Cesium.Color.fromCssColorString(FRONTLINE_STYLE.color);
    const [outer, ...holes] = rings.map(positions);
    const entities = [
      new Cesium.Entity({
        id: `ukraine-frontline:${index}`,
        name: 'Occupied territory (DeepStateMap)',
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(
            outer,
            holes.map((hole) => new Cesium.PolygonHierarchy(hole)),
          ),
          material: new Cesium.ColorMaterialProperty(
            color.withAlpha(FRONTLINE_STYLE.fillAlpha),
          ),
        },
      }),
    ];
    // Ground-clamped polygons cannot draw their own outline, so each ring
    // gets a clamped line; along the outer ring that line is the front.
    for (const [ringIndex, ring] of [outer, ...holes].entries()) {
      entities.push(
        new Cesium.Entity({
          id: `ukraine-frontline:${index}:line:${ringIndex}`,
          polyline: {
            positions: [...ring, ring[0]],
            clampToGround: true,
            width: FRONTLINE_STYLE.lineWidth,
            material: new Cesium.ColorMaterialProperty(
              color.withAlpha(FRONTLINE_STYLE.lineAlpha),
            ),
          },
        }),
      );
    }
    return entities;
  }

  const layer = {
    id: 'ukraine-frontline',
    name: 'Ukraine Frontline',
    icon: '⚔️',
    source: 'DeepStateMap',
    // The mirror publishes once a day, around 03:00 UTC.
    updateInterval: 60 * 60_000,

    init(viewer) {
      if (_viewer) throw new Error('Frontline layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('ukraine-frontline');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      reset();
      _enabled = false;
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        // Hourly polls return the same day until the mirror publishes again.
        const vertices = snapshot.polygons.reduce(
          (sum, rings) => sum + rings.reduce((n, r) => n + r.length, 0),
          0,
        );
        const signature = `${snapshot.date}:${snapshot.polygons.length}:${vertices}`;
        if (signature !== _signature) {
          const next = snapshot.polygons.flatMap(polygonEntities);
          _dataSource.entities.suspendEvents();
          try {
            _dataSource.entities.removeAll();
            for (const entity of next) _dataSource.entities.add(entity);
          } finally {
            _dataSource.entities.resumeEvents();
          }
          _signature = signature;
        }
        _date = snapshot.date;
        _count = snapshot.polygons.length;
        _lastUpdate = now();
        _lastError = null;
        _stale = frontlineDayIsStale(snapshot.date, now());
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:Frontline] Fetch error:', e);
        _lastError = e?.message || 'DeepState mirror unavailable';
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _viewer = null;
      _enabled = false;
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      reset();
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        stale: _stale,
        // The file covers one UTC day, which the panel shows as the source.
        source: _date ? `DeepState ${_date}` : 'DeepStateMap',
        error: _lastError,
      };
    },
  };
  return layer;
}
