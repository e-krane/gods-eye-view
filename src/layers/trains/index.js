import * as Cesium from 'cesium';
import {
  TRAIN_COLOR,
  TRAIN_OVERLAY_COHORT_LIMIT,
  TRAIN_OVERLAY_COLLISION_CAPACITY,
  TRAIN_OVERLAY_SOURCE_ID,
  createTrainOverlayEntry,
  trainTitle,
} from './model.js';
export * from './model.js';
export { createTrainPositionSource } from './source.js';
export {
  TRAIN_MAX_AGE_MS,
  normalizeTrafikverketTrainPositions,
  validateTrainPositionRows,
} from './records.js';

const LAYER_ID = 'trafikverket-train-positions';

/** Own one live Swedish train-position display and its refresh lifecycle. */
export function createTrainPositionsLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Train positions require a snapshot source');
  if (!overlayHost)
    throw new TypeError('Train positions require an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _keyRequired = false;
  let _enabled = false;
  /** @type {Map<string, Cesium.Entity>} */
  const _entities = new Map();

  function clearDisplay() {
    _dataSource?.entities.removeAll();
    _entities.clear();
    overlayHost.clearSource(TRAIN_OVERLAY_SOURCE_ID);
  }

  function upsert(row, position) {
    const properties = {
      trainNumber: row.number,
      speed: row.speed,
      bearing: row.bearing,
      reportedAt: row.timestamp,
    };
    const existing = _entities.get(row.id);
    if (existing) {
      // Moving the existing point avoids re-creating ~300 entities per poll.
      existing.position = new Cesium.ConstantPositionProperty(position);
      existing.name = trainTitle(row);
      existing.properties = new Cesium.PropertyBag(properties);
      return;
    }
    const entity = new Cesium.Entity({
      id: `${LAYER_ID}:${row.id}`,
      name: trainTitle(row),
      position,
      point: {
        pixelSize: 7,
        color: Cesium.Color.fromCssColorString(TRAIN_COLOR),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
        outlineWidth: 1.5,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      properties,
    });
    _dataSource.entities.add(entity);
    _entities.set(row.id, entity);
  }

  const layer = {
    id: LAYER_ID,
    name: 'Trains (SE)',
    icon: '🚆',
    source: 'Trafikverket',
    // The proxy caches for 30 seconds; trains report every few seconds.
    updateInterval: 30_000,
    // The proxy answers 503 {error:'no_key'} until a Trafikverket key is set.
    requiresKeyId: 'trafikverket',

    init(viewer) {
      if (_viewer) throw new Error('Train layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource(LAYER_ID);
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _entities.clear();
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _keyRequired = false;
      _enabled = false;
      overlayHost.setVisible(TRAIN_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(TRAIN_OVERLAY_SOURCE_ID, true);
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(TRAIN_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(TRAIN_OVERLAY_SOURCE_ID, false);
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
        const seen = new Set();
        const overlayEntries = [];
        _dataSource.entities.suspendEvents();
        try {
          for (const row of snapshot.rows) {
            const position = Cesium.Cartesian3.fromDegrees(row.lon, row.lat);
            upsert(row, position);
            seen.add(row.id);
            overlayEntries.push(createTrainOverlayEntry({ row, position }));
          }
          for (const [id, entity] of _entities) {
            if (seen.has(id)) continue;
            _dataSource.entities.remove(entity);
            _entities.delete(id);
          }
        } finally {
          _dataSource.entities.resumeEvents();
        }
        overlayHost.setEntries(TRAIN_OVERLAY_SOURCE_ID, overlayEntries, {
          cohortLimit: TRAIN_OVERLAY_COHORT_LIMIT,
          collisionCapacity: TRAIN_OVERLAY_COLLISION_CAPACITY,
          moving: true,
        });
        _lastUpdate = snapshot.fetchedAt ?? Date.now();
        _lastError = null;
        _stale = snapshot.stale === true;
        _keyRequired = false;
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:Trains] Fetch error:', e);
        _lastError = e?.message || 'Trafikverket train positions unavailable';
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
      overlayHost.clearSource(TRAIN_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(TRAIN_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _entities.clear();
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _keyRequired = false;
    },

    getStats() {
      return {
        count: _entities.size,
        lastUpdate: _lastUpdate,
        stale: _stale,
        keyRequired: _keyRequired,
        error: _keyRequired ? 'KEY REQUIRED' : _lastError,
      };
    },
  };
  return layer;
}
