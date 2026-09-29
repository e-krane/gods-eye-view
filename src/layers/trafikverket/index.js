import * as Cesium from 'cesium';
import {
  TRAFIKVERKET_OVERLAY_SOURCE_ID,
  TRAFIKVERKET_OVERLAY_COHORT_LIMIT,
  TRAFIKVERKET_OVERLAY_COLLISION_CAPACITY,
  createIncidentOverlayEntry,
  incidentPixelSize,
  incidentStyle,
} from './model.js';
export * from './model.js';
export { createTrafikverketIncidentSource } from './source.js';

/** Own one Trafikverket road-incident display and its refresh lifecycle. */
export function createTrafikverketIncidentsLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Road incidents require a snapshot source');
  if (!overlayHost)
    throw new TypeError('Road incidents require an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _keyRequired = false;
  let _enabled = false;

  function clearDisplay() {
    _dataSource?.entities.removeAll();
    overlayHost.clearSource(TRAFIKVERKET_OVERLAY_SOURCE_ID);
    _count = 0;
  }

  const layer = {
    id: 'trafikverket-road-incidents',
    name: 'Road Incidents (SE)',
    icon: '🚧',
    source: 'Trafikverket',
    // The proxy caches for two minutes; polling faster only re-reads its cache.
    updateInterval: 120000,
    // The proxy answers 503 {error:'no_key'} until a Trafikverket key is set.
    requiresKeyId: 'trafikverket',

    init(viewer) {
      if (_viewer)
        throw new Error('Road incident layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('trafikverket-road-incidents');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _keyRequired = false;
      _enabled = false;
      overlayHost.setVisible(TRAFIKVERKET_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(TRAFIKVERKET_OVERLAY_SOURCE_ID, true);
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(TRAFIKVERKET_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(TRAFIKVERKET_OVERLAY_SOURCE_ID, false);
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
        if (snapshot?.keyRequired) {
          clearDisplay();
          _keyRequired = true;
          _stale = false;
          _lastError = null;
          _lastUpdate = null;
          return false;
        }

        const nextEntities = [];
        const overlayEntries = [];
        for (const row of snapshot.rows) {
          const style = incidentStyle(row.category);
          const position = Cesium.Cartesian3.fromDegrees(row.lon, row.lat);
          nextEntities.push(
            new Cesium.Entity({
              id: `trafikverket-road-incidents:${row.id}`,
              name: row.header || style.label,
              position,
              point: {
                pixelSize: incidentPixelSize(row.severity),
                color: Cesium.Color.fromCssColorString(style.color),
                outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
                outlineWidth: 1.5,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              properties: {
                incidentId: row.id,
                category: row.category,
                messageType: row.messageType,
                header: row.header,
                message: row.message,
                messageCode: row.messageCode,
                roadNumber: row.roadNumber,
                location: row.location,
                severity: row.severity,
                severityText: row.severityText,
                startTime: row.startTime,
                endTime: row.endTime,
              },
            }),
          );
          overlayEntries.push(createIncidentOverlayEntry({ row, position }));
        }

        _dataSource.entities.removeAll();
        for (const entity of nextEntities) _dataSource.entities.add(entity);
        overlayHost.setEntries(TRAFIKVERKET_OVERLAY_SOURCE_ID, overlayEntries, {
          cohortLimit: TRAFIKVERKET_OVERLAY_COHORT_LIMIT,
          collisionCapacity: TRAFIKVERKET_OVERLAY_COLLISION_CAPACITY,
          moving: false,
        });

        _count = nextEntities.length;
        _lastUpdate = snapshot.fetchedAt ?? Date.now();
        _lastError = null;
        _stale = snapshot.stale === true;
        _keyRequired = false;
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:Trafikverket] Fetch error:', e);
        _lastError = e?.message || 'Trafikverket road incidents unavailable';
        _keyRequired = false;
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
      overlayHost.clearSource(TRAFIKVERKET_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(TRAFIKVERKET_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _keyRequired = false;
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        stale: _stale,
        // Machine-readable keyless state: the panel names the missing key
        // instead of presenting a broken feed (see layerKeyRequirementTooltip).
        keyRequired: _keyRequired,
        error: _keyRequired ? 'KEY REQUIRED' : _lastError,
      };
    },
  };
  return layer;
}
