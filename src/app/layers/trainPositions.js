import { createTrainPositionsLayer } from '../../layers/trains/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire Trafikverket train positions to the application overlay host. */
export function createApplicationTrainPositions(options) {
  return createTrainPositionsLayer({ overlayHost, ...options });
}
