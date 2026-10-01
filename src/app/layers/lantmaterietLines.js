import { createLantmaterietLineLayer } from '../../layers/lantmateriet/index.js';

/** Wire one bundled Lantmäteriet line dataset into the application catalog. */
export function createApplicationLantmaterietLines(options) {
  return createLantmaterietLineLayer(options);
}
