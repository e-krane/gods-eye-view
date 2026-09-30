import * as Cesium from 'cesium';
import {
  SEABED_CARD_OPTIONS,
  SEABED_CARD_SOURCE_ID,
  SEABED_LABEL_OPTIONS,
  SEABED_LABEL_SOURCE_ID,
  SEABED_STATUS_STYLES,
  buildSeabedCard,
  createSeabedLabelEntry,
  seabedIncidentTitle,
  seabedStatusStyle,
} from './model.js';
import { SEABED_STATUSES } from './records.js';
export * from './model.js';
export { createSeabedIncidentSource } from './source.js';
export {
  SEABED_STATUSES,
  isSeabedIncident,
  validateSeabedIncidents,
} from './records.js';

const LAYER_ID = 'baltic-seabed-incidents';
const PICK_PREFIX = `${LAYER_ID}:`;

/**
 * Own one Baltic seabed-incident display: a point per incident coloured by
 * status, a translucent circle for its location uncertainty, ambient labels,
 * and a card with the incident's facts and source on click.
 */
export function createSeabedIncidentsLayer({
  source,
  overlayHost,
  screenSpaceEventHandlerFactory = null,
  picking = null,
  pointer = null,
  openExternal = null,
  now = () => Date.now(),
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Seabed incidents require a snapshot source');
  if (!overlayHost)
    throw new TypeError('Seabed incidents require an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _asOf = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _clickHandler = null;
  let _selectedId = null;
  let _selectedCardId = null;
  /** @type {Map<string, object>} */
  const _incidents = new Map();

  const canSelect = () => Boolean(screenSpaceEventHandlerFactory && picking);

  function selectedLink() {
    return _incidents.get(_selectedId)?.sources[0]?.url ?? null;
  }

  function publishSelectedCard() {
    const incident = _selectedId ? _incidents.get(_selectedId) : null;
    if (!incident) {
      _selectedId = null;
      _selectedCardId = null;
      overlayHost.setEntries(SEABED_CARD_SOURCE_ID, [], SEABED_CARD_OPTIONS);
      return;
    }
    const card = {
      ...buildSeabedCard(incident),
      position: Cesium.Cartesian3.fromDegrees(incident.lon, incident.lat),
    };
    const link = incident.sources[0].url;
    if (openExternal) {
      // Keyboard/assistive activation mirrors the pointer click-through.
      card.activate = () => {
        openExternal(link);
        return true;
      };
    } else {
      card.interactive = false;
    }
    _selectedCardId = card.id;
    overlayHost.setEntries(SEABED_CARD_SOURCE_ID, [card], SEABED_CARD_OPTIONS);
  }

  function pickedIncidentId(picked) {
    const pickId = picking.resolvePickId(picked);
    if (typeof pickId !== 'string' || !pickId.startsWith(PICK_PREFIX))
      return null;
    const id = pickId.slice(PICK_PREFIX.length).split(':')[0];
    return _incidents.has(id) ? id : null;
  }

  function installClickHandler() {
    if (!canSelect() || _clickHandler || !_viewer) return;
    _clickHandler = screenSpaceEventHandlerFactory(_viewer);
    _clickHandler.setInputAction((click) => {
      if (pointer && !pointer.isPointerFree()) return;
      // A click on the open card follows its source link.
      const cardHit = overlayHost.hitTest?.(
        click.position?.x,
        click.position?.y,
        { sourceId: SEABED_CARD_SOURCE_ID },
      );
      if (cardHit && cardHit.entryId === _selectedCardId) {
        const link = selectedLink();
        if (link && openExternal) openExternal(link);
        return;
      }
      const picked = _viewer.scene.pick(click.position);
      const incidentId = picked ? pickedIncidentId(picked) : null;
      if (incidentId) {
        _selectedId = incidentId;
        publishSelectedCard();
        return;
      }
      // A sibling layer's pick is not empty space; leave the card alone.
      if (picked) {
        const pickId = picking.resolvePickId(picked);
        if (pickId && picking.isOwnedByOtherLayer(LAYER_ID, pickId)) return;
      }
      if (_selectedId) {
        _selectedId = null;
        publishSelectedCard();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function removeClickHandler() {
    _clickHandler?.destroy();
    _clickHandler = null;
  }

  function clearOverlays() {
    _selectedId = null;
    _selectedCardId = null;
    for (const id of [SEABED_LABEL_SOURCE_ID, SEABED_CARD_SOURCE_ID]) {
      overlayHost.clearSource(id);
      overlayHost.setVisible(id, false);
    }
  }

  function incidentEntities(incident) {
    const color = Cesium.Color.fromCssColorString(
      seabedStatusStyle(incident.status).color,
    );
    const position = Cesium.Cartesian3.fromDegrees(incident.lon, incident.lat);
    const radius = incident.uncertaintyKm * 1000;
    return {
      position,
      entities: [
        new Cesium.Entity({
          id: `${PICK_PREFIX}${incident.id}`,
          name: seabedIncidentTitle(incident),
          position,
          point: {
            pixelSize: 11,
            color,
            outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
            outlineWidth: 1.5,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
        }),
        // Where the damage lies is rarely published precisely; the circle
        // shows the stated uncertainty instead of a falsely exact pin.
        new Cesium.Entity({
          id: `${PICK_PREFIX}${incident.id}:area`,
          position,
          ellipse: {
            semiMajorAxis: radius,
            semiMinorAxis: radius,
            material: new Cesium.ColorMaterialProperty(color.withAlpha(0.14)),
          },
        }),
      ],
    };
  }

  const layer = {
    id: LAYER_ID,
    name: 'Baltic Seabed Incidents',
    icon: '⚓',
    source: 'Curated',
    // Bundled data; the refresh only re-validates it.
    updateInterval: 24 * 60 * 60_000,

    init(viewer) {
      if (_viewer)
        throw new Error('Seabed incident layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource(LAYER_ID);
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _incidents.clear();
      _asOf = null;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      for (const id of [SEABED_LABEL_SOURCE_ID, SEABED_CARD_SOURCE_ID])
        overlayHost.setVisible(id, false);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      for (const id of [SEABED_LABEL_SOURCE_ID, SEABED_CARD_SOURCE_ID])
        overlayHost.setVisible(id, true);
      installClickHandler();
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      removeClickHandler();
      clearOverlays();
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
        const next = [];
        const labels = [];
        _incidents.clear();
        for (const incident of snapshot.incidents) {
          const { position, entities } = incidentEntities(incident);
          next.push(...entities);
          labels.push(createSeabedLabelEntry({ incident, position }));
          _incidents.set(incident.id, incident);
        }
        _dataSource.entities.suspendEvents();
        try {
          _dataSource.entities.removeAll();
          for (const entity of next) _dataSource.entities.add(entity);
        } finally {
          _dataSource.entities.resumeEvents();
        }
        overlayHost.setEntries(
          SEABED_LABEL_SOURCE_ID,
          labels,
          SEABED_LABEL_OPTIONS,
        );
        if (_selectedId) publishSelectedCard();
        _asOf = snapshot.asOf;
        _lastUpdate = now();
        _lastError = null;
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:Seabed] Dataset error:', e);
        _lastError = e?.message || 'Seabed incident dataset unavailable';
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      removeClickHandler();
      clearOverlays();
      _viewer = null;
      _enabled = false;
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _incidents.clear();
      _asOf = null;
      _lastUpdate = null;
      _lastError = null;
    },

    /** Incident facts for the analyst query engine. */
    getAnalystRecords(maxCount = 200) {
      if (!_dataSource?.show) return [];
      return [..._incidents.values()]
        .slice(0, Math.max(1, Math.floor(maxCount) || 200))
        .map((incident) => ({
          id: incident.id,
          title: incident.title,
          date: incident.date,
          status: incident.status,
          vessel: incident.vessel,
          assets: incident.assets,
          lat: incident.lat,
          lon: incident.lon,
        }));
    },

    getRowControls() {
      const counts = new Map();
      for (const incident of _incidents.values())
        counts.set(incident.status, (counts.get(incident.status) || 0) + 1);
      return {
        chips: [],
        legend: SEABED_STATUSES.map((status, index) => ({
          label: SEABED_STATUS_STYLES[status].label,
          color: SEABED_STATUS_STYLES[status].color,
          count: counts.get(status) || 0,
          ...(index === 0
            ? {
                blurb:
                  'Status as the cited sources report it. Circles show how precisely the damage point is known.',
              }
            : {}),
        })),
      };
    },

    getStats() {
      return {
        count: _incidents.size,
        lastUpdate: _lastUpdate,
        // The panel shows when the curated dataset was last reviewed.
        source: _asOf ? `Curated, as of ${_asOf}` : 'Curated',
        error: _lastError,
      };
    },
  };
  return layer;
}
