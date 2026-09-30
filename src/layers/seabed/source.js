import { SEABED_DATASET_AS_OF, SEABED_INCIDENTS } from './incidents.js';
import { validateSeabedIncidents } from './records.js';

/**
 * Serve the curated, bundled Baltic seabed-incident dataset. There is no
 * upstream feed: incidents and their status are researched by hand, each
 * with cited sources, and `asOf` says when the dataset was last reviewed.
 */
export function createSeabedIncidentSource({
  incidents = SEABED_INCIDENTS,
  asOf = SEABED_DATASET_AS_OF,
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const rows = validateSeabedIncidents(incidents);
      if (!rows) throw new Error('Malformed seabed incident dataset');
      return { incidents: rows, asOf };
    },
  };
}
