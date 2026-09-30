# gods-eye-view — Nordic/Ukraine extension fork

Upstream: bilawalsidhu/gods-eye-view (photorealistic 3D globe, live OSINT layers).
This fork adds Sweden/Scandinavia data sources and Ukraine-conflict monitoring layers.

Upstream docs still apply: `CONTRIBUTING.md` (workflow, share-link tokens),
`docs/CODE-BOUNDARIES.md` (module ownership, import gates) and
`docs/CURRENT-STATE.md` (authoritative runtime reference).

## Planned layers

See "Adding a data layer" below for the registration pattern.

- Trafikverket: Swedish rail/road real-time (train announcements, road incidents, weather stations)
  (road incidents done: `src/layers/trafikverket/` + `server/providers/trafikverket.js`, the reference
  for a keyed layer with a server-side proxy; train positions done: `src/layers/trains/`, a second `cachedRoute`
  in the same proxy; road weather can reuse the proxy and key the same way)
- BarentsWatch: Norwegian AIS (live + historic vessel tracks), fishing-vessel register
- SMHI: Swedish weather observations, no key required (air temperature done: `src/layers/smhi/`, the simplest reference for a keyless layer)
- ACLED: structured conflict/incident events with lat/lon, incl. hybrid-warfare incidents
- GPSJam: ADS-B-derived GNSS jamming/spoofing heatmap (done: `src/layers/gnss/` + `server/providers/gpsjam.js`,
  the reference for a keyless server-side proxy that reshapes an upstream file; the layer id is source-neutral
  so a live feed from the app's own adsb.lol data could drive it later)
- DeepStateMap mirror (GitHub raw GeoJSON): Ukraine frontline control polygons (done: `src/layers/frontline/`,
  browser-direct; the archive `deepstate-map-data.geojson.gz` holds every day since 2024-07-08 for a later date slider)
- GDELT: broader event aggregation for sabotage/hybrid incidents across Europe
- Baltic seabed incidents (done: `src/layers/seabed/`, a curated bundled dataset in `incidents.js`; review each
  incident's `status` and `statusAsOf` as investigations conclude, and bump `SEABED_DATASET_AS_OF`)

## Conventions

- Keep "Adding a data layer" below accurate. Before adding a layer, re-check it against
  how the existing layers (flights/ships/satellites) are registered and rendered, and
  update it here when the pattern changes so new layers follow it.
- New data sources go through the existing "power-up" API-key settings panel, not hardcoded.
- Keep each layer's fetch/parse logic isolated so a missing key degrades gracefully
  (layer just doesn't render) rather than breaking the app.

## Environment

- Node 24.14+ is required (`package.json` engines). Cloud sessions default to Node 22;
  run `source ~/.nvm/nvm.sh && nvm use 24` before npm scripts. The SessionStart hook
  (`scripts/cloud-install.sh`) already does this for `npm ci`.
- Checks: `npm test`, `npm run format:check`, `npm run check:boundaries`,
  `npm run layer-token:check -- --base-ref origin/main`, `npm run build`.
  `npm run test:track` and `scripts/qa-*.mjs` gates need a running dev server.

## Adding a data layer

Architecture: vanilla JS + CesiumJS + Vite. Sources acquire records; layers own Cesium
resources; anything needing a private key is proxied server-side.

**Templates.** `src/layers/earthquakes/` (keyless points) is the simplest.
`src/layers/perimeters/` builds polygons with holes (the frontline analogue).
`src/layers/firms/` is the keyed layer with missing-key handling. `src/layers/vessels/`
and `src/layers/flights/` are the heavy live-feed families with injected services.
Static bundled GeoJSON can use `createLocalGeoJsonLayer` in `src/data/localGeojsonCore.js`
(see `docs/INFRASTRUCTURE-LAYERS.md`).

**Layer interface** (plain object): `id, name, icon, source, updateInterval`,
`init(viewer)`, `enable()`, `disable()`, `update(viewer, { signal })`, `destroy()`,
`getStats()`. Optional: `requiresKeyId`, `getAnalystRecords(max)`, `getRowControls`.
`LayerLifecycle` (`src/data/lifecycle.js`) polls `update()` every `updateInterval` ms.
`init` adds a `Cesium.CustomDataSource` and `destroy` removes it. `update` aborts the
previous request before fetching. `getStats()` feeds the status chip via
`layerFeedState()` in `src/data/feedState.js` (`error`, `stale`, `unavailable`, `count`…).

**Steps**

1. `src/layers/<family>/records.js`: a pure normalizer; return null for a malformed feed.
2. `src/layers/<family>/source.js`: a factory returning `getSnapshot({ signal })` with an
   injectable `fetchImpl`. No Cesium, Node or browser globals (the boundary check
   enforces this). Helpers are in `src/sources/` (`httpBody.js`, `capability.js`,
   `live/contract.js`). Call a same-origin `/api/<route>` when the upstream needs a
   key or lacks CORS.
3. `src/layers/<family>/index.js`: `create<Family>Layer({ source, overlayHost, … })`.
4. Proxy (if needed): `server/providers/<name>.js` exports a Vite plugin using
   `server.middlewares.use('/api/<route>', …)`. List it in `localProviderPlugins()` in
   `server/providers/local.js`. Keyed providers read `process.env.X`, return
   `503 { error: 'no_key' }` when it is unset, and never log key-bearing URLs.
   Templates: `trafikverket.js` (keyed POST, cached per key), `firms.js` (keyed, disk cache)
   `firePerimeters.js` (keyless) and `gpsjam.js` (keyless,
   reshapes a daily upstream file once, uses a server-only npm dependency). Server tests live under `src/` (the runner only
   scans `src/`), e.g. `src/data/trafikverketProxy.test.mjs`.
5. Key (if needed):
   - Add an entry to `KEY_SETUP_KEYS` in `src/keySetupCore.mjs`. That entry is the
     POWER UP / Provider Settings panel; saving writes `.env` via
     `server/standalone/key-setup.js`.
   - Document the variable in `.env.example`, `scripts/setup-doctor.mjs` (and the
     credential fixtures in `src/setupDoctor.test.mjs`), `scripts/dev-fresh.sh`,
     `scripts/pinokio-environment.mjs` and `pinokio/` (`_ENVIRONMENT`, `install.js`,
     `start.js`, `update.js`).
   - `vite.config.js` copies `.env` into `process.env` only for undefined variables, so
     an env var set to an empty string shadows the `.env` value. POWER UP sets
     `process.env` directly and is unaffected.
   - Set `requiresKeyId` on the layer. On `no_key`, have the source return
     `{ keyRequired: true }` and `getStats()` report `keyRequired: true`; the panel then
     shows "Needs X". Mirror `src/layers/firms/`.
6. Sources: add the source's required methods to `SOURCE_METHODS` in
   `src/app/constructCatalog.js`. Add the source to `createStandaloneLayerSources` in
   `src/standalone/layerSources.js`, or to `src/sources/reference.js` for keyless
   reference feeds.
7. Catalog: add `src/app/layers/<name>.js` (wires the factory to app services). Add the
   layer to the `createLayerCatalog([...])` array in `src/app/constructCatalog.js`.
   A layer missing from the registries below throws at startup.
8. Share-link token: fork layers use the reserved `z0`-`zz` range so they never
   collide with tokens upstream allocates (this fork keeps merging upstream). Run
   `npm run layer-token:next -- <id> --fork` (without `--fork` it prints upstream's
   next token; don't use that for fork layers). Add the token to
   `src/data/layerStateTokenReservations.json` and to `LAYER_STATE_REGISTRY` in
   `src/data/layerState.js` (sorted by id). Update the pins: layer counts in
   `src/data/layerState.test.mjs` and `src/app/constructCatalog.test.mjs`, and the
   counts, encoded `l` length and fork-token map in
   `src/data/layerStateTokenLedger.test.mjs`. Never change or reuse a published token.
   When merging upstream, keep both sides' ledger rows and registry entries, then
   re-add the pins.
9. Panel: add the id to `PANEL_GROUPS` (and optionally `PANEL_LABELS`) in
   `src/ui/layerPanel.js`.
10. Packaging: add `./layers/<family>` (and `/source`) to `package.json` `exports`;
    assign it to exactly one group in `scripts/package-boundaries.json`. List new test
    files in `scripts/format-scope.json` (runtime files are discovered automatically).
11. Docs: update `DATA_SOURCES.md` (license and attribution), `DATA_CREDITS` in
    `src/data/dataCredits.js`, `CHANGELOG.md` and `docs/CURRENT-STATE.md`.
12. Optional voice/analyst: add the layer to the enums in `src/voice/actionSchemas.js`,
    `LAYER_ALIASES` in `src/voice/gevActions.js`, and `ANALYST_LAYERS` in
    `src/data/analystEngine.js`.
13. Tests: add `*.test.mjs` next to the code (auto-discovered). Model them on
    `src/layers/earthquakes/ownership.test.mjs` (fake viewer) and
    `src/ui/layerKeyRequirement.test.mjs`. Then run the checks under Environment.
