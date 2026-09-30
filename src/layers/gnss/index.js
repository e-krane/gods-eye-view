import * as Cesium from 'cesium';
import { gnssCellTitle, gnssDayIsStale, gnssLevelStyle } from './model.js';
export * from './model.js';
export { createGnssInterferenceSource } from './source.js';
export {
  GNSS_LEVEL_THRESHOLDS,
  gnssBadPercent,
  gnssLevel,
  validateGnssSnapshot,
} from './records.js';

/** Own one GPSJam GNSS-interference display and its refresh lifecycle. */
export function createGnssInterferenceLayer({
  source,
  now = () => Date.now(),
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('GNSS interference requires a snapshot source');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _signature = null;
  let _date = null;
  let _suspect = false;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;

  function reset() {
    _signature = null;
    _date = null;
    _suspect = false;
    _count = 0;
    _lastUpdate = null;
    _lastError = null;
    _stale = false;
  }

  function cellEntity(cell) {
    const style = gnssLevelStyle(cell.level);
    return new Cesium.Entity({
      id: `gnss-interference:${cell.hex}`,
      name: gnssCellTitle(cell),
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(
          Cesium.Cartesian3.fromDegreesArray(cell.boundary.flat()),
        ),
        material: new Cesium.ColorMaterialProperty(
          Cesium.Color.fromCssColorString(style.color).withAlpha(style.alpha),
        ),
      },
      properties: {
        hex: cell.hex,
        level: cell.level,
        percent: cell.percent,
        goodAircraft: cell.good,
        badAircraft: cell.bad,
      },
    });
  }

  const layer = {
    id: 'gnss-interference',
    name: 'GNSS Interference',
    icon: '📡',
    source: 'GPSJam',
    // GPSJam publishes once a day; the proxy re-reads its manifest hourly.
    updateInterval: 30 * 60_000,

    init(viewer) {
      if (_viewer) throw new Error('GNSS layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('gnss-interference');
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
        // The same day comes back on every poll until GPSJam publishes the
        // next one; rebuilding a thousand ground polygons would be wasted.
        const signature = `${snapshot.date}:${snapshot.suspect}:${snapshot.cells.length}`;
        if (signature !== _signature) {
          const next = snapshot.cells.map(cellEntity);
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
        _suspect = snapshot.suspect;
        _count = snapshot.cells.length;
        _lastUpdate = snapshot.fetchedAt ?? now();
        _lastError = null;
        _stale =
          snapshot.stale === true || gnssDayIsStale(snapshot.date, now());
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:GNSS] Fetch error:', e);
        _lastError = e?.message || 'GPSJam unavailable';
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
        // GPSJam flags days it knows are incomplete; the chip reads PARTIAL.
        partial: _suspect,
        // The data covers one UTC day, which the panel shows as the source.
        source: _date ? `GPSJam ${_date}` : 'GPSJam',
        error: _lastError,
      };
    },
  };
  return layer;
}
