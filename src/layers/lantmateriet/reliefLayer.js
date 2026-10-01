import * as Cesium from 'cesium';
import { NO_IMAGERY_HOST, resolveImageryHost } from '../../maps/imageryHost.js';

export const RELIEF_LAYER_ID = 'lantmateriet-relief';

/**
 * Own the terrain relief (hillshade) overlay: one imagery layer per site,
 * draped on whatever surface the map stack offers (the globe's imagery
 * layers, or the photoreal tileset's while the globe is hidden). The tiles
 * are bundled, so the manifest loads once, on first enable.
 * @param {{ source: { getSnapshot: Function }, host?: Function, cesium?: object }} options
 */
export function createLantmaterietReliefLayer({
  source,
  host = resolveImageryHost,
  cesium = Cesium,
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Terrain relief requires a snapshot source');
  let _viewer = null;
  let _tileset = null;
  let _removePreRender = null;
  let _request = null;
  let _enabled = false;
  let _snapshot = null;
  let _providers = [];
  let _collection = null;
  let _mounted = [];
  let _hostKind = 'none';
  let _lastUpdate = null;
  let _lastError = null;

  function unmount() {
    for (const layer of _mounted) {
      try {
        _collection?.remove(layer, true);
      } catch {
        /* the collection is already gone */
      }
    }
    _mounted = [];
    _collection = null;
  }

  /** Drape the sites on the current host, moving them when it changes. */
  function sync() {
    const next = (_enabled && host({ viewer: _viewer, tileset: _tileset })) || {
      collection: null,
      kind: 'none',
    };
    _hostKind = next.kind;
    const target = _providers.length ? next.collection : null;
    if (target === _collection) return;
    unmount();
    if (!target) return;
    _collection = target;
    _mounted = _providers.map((provider) =>
      target.addImageryProvider(provider),
    );
    _viewer?.scene?.requestRender?.();
  }

  function createProviders(snapshot) {
    return snapshot.sites.map(
      (site) =>
        new cesium.UrlTemplateImageryProvider({
          url: site.template,
          tilingScheme: new cesium.WebMercatorTilingScheme(),
          rectangle: cesium.Rectangle.fromDegrees(
            site.west,
            site.south,
            site.east,
            site.north,
          ),
          minimumLevel: site.minZoom,
          maximumLevel: site.maxZoom,
          credit: snapshot.manifest.attribution,
          hasAlphaChannel: true,
        }),
    );
  }

  const layer = {
    id: RELIEF_LAYER_ID,
    name: 'Terrain Relief (SE)',
    icon: '⛰️',
    source: 'Lantmäteriet',
    // Static tiles: after the first load each poll only re-checks the host.
    updateInterval: 24 * 60 * 60_000,

    init(viewer) {
      if (_viewer) throw new Error('Terrain relief is already initialized');
      _viewer = viewer;
      _removePreRender =
        viewer.scene.preRender?.addEventListener?.(() => {
          if (_enabled) sync();
        }) ?? null;
      _enabled = false;
    },

    /** The photoreal tileset, for draping while the globe is hidden. */
    attachTileset(tileset) {
      _tileset = tileset || null;
      sync();
    },

    enable() {
      _enabled = true;
      sync();
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      sync();
      _viewer?.scene?.requestRender?.();
    },

    async update() {
      if (!_enabled || !_viewer) return false;
      if (_snapshot) {
        sync();
        return true;
      }
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_viewer)
          return false;
        _snapshot = snapshot;
        _providers = createProviders(snapshot);
        _lastUpdate = Date.now();
        _lastError = null;
        sync();
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request) return false;
        console.warn('[Data:Relief]', e);
        _lastError = e?.message || 'Terrain relief unavailable';
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy() {
      _request?.abort();
      _request = null;
      _enabled = false;
      _removePreRender?.();
      _removePreRender = null;
      unmount();
      _providers = [];
      _snapshot = null;
      _viewer = null;
      _tileset = null;
      _lastUpdate = null;
      _lastError = null;
    },

    getRowControls() {
      return {
        chips: (_snapshot?.sites ?? []).map((site) => ({
          id: site.id,
          label: site.name,
          active: false,
          title: `Fly to ${site.name}`,
          onClick: () =>
            _viewer?.camera?.flyTo({
              destination: cesium.Rectangle.fromDegrees(
                site.west,
                site.south,
                site.east,
                site.north,
              ),
            }),
        })),
        legend: [],
        info: _snapshot
          ? 'Hillshade from Lantmäteriet’s 1 m laser-scanned ground model at a few test sites. It appears as you zoom in on a site; choose one to fly there.'
          : null,
      };
    },

    getStats() {
      return {
        count: _snapshot?.sites.length ?? 0,
        lastUpdate: _lastUpdate,
        source:
          _enabled && _snapshot && _hostKind === 'none'
            ? NO_IMAGERY_HOST
            : _snapshot
              ? `Lantmäteriet, ${_snapshot.manifest.builtAt}`
              : 'Lantmäteriet',
        error: _lastError,
      };
    },
  };
  return layer;
}
