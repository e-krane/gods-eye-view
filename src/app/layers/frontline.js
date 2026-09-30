import { createFrontlineLayer } from '../../layers/frontline/index.js';
/** Wire the DeepStateMap occupied-territory layer into the application catalog. */
export function createApplicationFrontline(options) {
  return createFrontlineLayer(options);
}
