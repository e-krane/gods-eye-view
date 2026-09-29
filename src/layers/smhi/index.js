import * as Cesium from 'cesium';
import {
  SMHI_OVERLAY_SOURCE_ID,
  SMHI_OVERLAY_COHORT_LIMIT,
  SMHI_OVERLAY_COLLISION_CAPACITY,
  createSmhiOverlayEntry,
  isSmhiSnapshotStale,
  temperatureColor,
} from './model.js';
export * from './model.js';
export { createSmhiObservationSource } from './source.js';

/** Own one SMHI station-observation display and its refresh lifecycle. */
export function createSmhiObservationsLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('SMHI observations require a snapshot source');
  if (!overlayHost)
    throw new TypeError('SMHI observations require an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;

  const layer = {
    id: 'smhi-observations',
    name: 'SMHI Air Temperature',
    icon: '🌡️',
    source: 'SMHI',
    // SMHI publishes hourly and caches responses for 10 minutes.
    updateInterval: 600000,

    init(viewer) {
      if (_viewer) throw new Error('SMHI layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('smhi-observations');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      overlayHost.setVisible(SMHI_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(SMHI_OVERLAY_SOURCE_ID, true);
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(SMHI_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SMHI_OVERLAY_SOURCE_ID, false);
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const rows = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;

        const nextEntities = [];
        const overlayEntries = [];
        for (const row of rows) {
          const css = temperatureColor(row.value);
          const color = Cesium.Color.fromCssColorString(css);
          const position = Cesium.Cartesian3.fromDegrees(row.lon, row.lat);
          nextEntities.push(
            new Cesium.Entity({
              id: `smhi-observations:${row.stationId}`,
              name: row.name,
              position,
              point: {
                pixelSize: 8,
                color,
                outlineColor: Cesium.Color.BLACK.withAlpha(0.8),
                outlineWidth: 1,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              properties: {
                stationId: row.stationId,
                station: row.name,
                owner: row.owner,
                airTemperatureC: row.value,
                observedAt: row.observedAt,
                quality: row.quality,
                heightM: row.heightM,
              },
            }),
          );
          overlayEntries.push(
            createSmhiOverlayEntry({
              id: row.stationId,
              position,
              value: row.value,
              accent: css,
            }),
          );
        }

        _dataSource.entities.removeAll();
        for (const entity of nextEntities) _dataSource.entities.add(entity);
        overlayHost.setEntries(SMHI_OVERLAY_SOURCE_ID, overlayEntries, {
          cohortLimit: SMHI_OVERLAY_COHORT_LIMIT,
          collisionCapacity: SMHI_OVERLAY_COLLISION_CAPACITY,
          moving: false,
        });

        _count = nextEntities.length;
        _lastUpdate = Date.now();
        _lastError = null;
        _stale = isSmhiSnapshotStale(rows, _lastUpdate);
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:SMHI] Fetch error:', e);
        _lastError = e?.message || 'SMHI observations unavailable';
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
      overlayHost.clearSource(SMHI_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SMHI_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
      };
    },
  };
  return layer;
}
