import { createTrafikverketIncidentsLayer } from '../../layers/trafikverket/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire Trafikverket road incidents to the application overlay host. */
export function createApplicationTrafikverketIncidents(options) {
  return createTrafikverketIncidentsLayer({ overlayHost, ...options });
}
