import { createOpenFreeMapSource } from '../sources/openFreeMap.js';
import {
  createOpenSkySource,
  createAdsbLolSource,
  createAisStreamSource,
} from '../sources/live/standalone.js';
import { createCctvSource } from '../layers/cctv/source.js';
import { createRadioSource } from '../layers/radio/source.js';
import { createTransitSource } from '../layers/transit/source.js';
import { createTrafficSource } from '../layers/traffic/source.js';
import { createBikeshareSource } from '../layers/bikeshare/source.js';
import { createInstallationSource } from '../layers/installations/source.js';
import { createSatelliteSource } from '../layers/satellites/source.js';
import { createLaunchSource } from '../layers/launches/source.js';
import { createAlprTileSource } from '../layers/alpr/source.js';
import { createWeatherSource } from '../layers/weather/source.js';
import { createCycloneSource } from '../layers/cyclones/source.js';
import { createWindSource } from '../layers/wind/source.js';
import { createFirmsSource } from '../layers/firms/source.js';
import { createSmhiObservationSource } from '../layers/smhi/source.js';
import { createTrafikverketIncidentSource } from '../layers/trafikverket/source.js';
import { createGnssInterferenceSource } from '../layers/gnss/source.js';
import { createFrontlineSource } from '../layers/frontline/source.js';
import { createSeabedIncidentSource } from '../layers/seabed/source.js';
import { createTrainPositionSource } from '../layers/trains/source.js';
import { createLantmaterietLineSource } from '../layers/lantmateriet/source.js';
import { createReferenceSources } from '../sources/reference.js';
export { createReferenceSources as createStandaloneReferenceSources } from '../sources/reference.js';

/** Select standalone providers without starting their acquisition. */
export function createStandaloneLayerSources() {
  const mapTiles = createOpenFreeMapSource();
  return {
    ...createReferenceSources(),
    flights: createOpenSkySource(),
    military: createAdsbLolSource(),
    vessels: createAisStreamSource({
      apiUrl: import.meta.env?.VITE_AIS_LIVE_API_URL || '/api/ais-live',
    }),
    cctv: createCctvSource(),
    radio: createRadioSource(),
    traffic: createTrafficSource({ mapTiles }),
    transit: createTransitSource(),
    bikeshare: createBikeshareSource(),
    installations: createInstallationSource({ mapTiles }),
    satellites: createSatelliteSource(),
    launches: createLaunchSource(),
    alpr: createAlprTileSource(),
    firms: createFirmsSource(),
    wind: createWindSource(),
    weather: createWeatherSource(),
    cyclones: createCycloneSource(),
    'smhi-observations': createSmhiObservationSource(),
    'trafikverket-road-incidents': createTrafikverketIncidentSource(),
    'gnss-interference': createGnssInterferenceSource(),
    'ukraine-frontline': createFrontlineSource(),
    'baltic-seabed-incidents': createSeabedIncidentSource(),
    'trafikverket-train-positions': createTrainPositionSource(),
    'lantmateriet-power-lines': createLantmaterietLineSource({
      dataset: 'power',
    }),
    'lantmateriet-railways': createLantmaterietLineSource({ dataset: 'rail' }),
    'lantmateriet-roads': createLantmaterietLineSource({ dataset: 'roads' }),
    'lantmateriet-military-areas': createLantmaterietLineSource({
      dataset: 'military',
    }),
  };
}
