import { createSmhiObservationsLayer } from '../../layers/smhi/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire SMHI station observations to the application overlay host. */
export function createApplicationSmhiObservations(options) {
  return createSmhiObservationsLayer({ overlayHost, ...options });
}
