import { createGnssInterferenceLayer } from '../../layers/gnss/index.js';
/** Wire the GPSJam GNSS-interference layer into the application catalog. */
export function createApplicationGnssInterference(options) {
  return createGnssInterferenceLayer(options);
}
