import { createLantmaterietReliefLayer } from '../../layers/lantmateriet/index.js';

/** Wire the bundled terrain relief tiles into the application catalog. */
export function createApplicationLantmaterietRelief(options) {
  return createLantmaterietReliefLayer(options);
}
