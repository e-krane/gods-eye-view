export const TRAFIKVERKET_OVERLAY_SOURCE_ID = 'trafikverket-road-incidents';
export const TRAFIKVERKET_OVERLAY_COHORT_LIMIT = 256;
export const TRAFIKVERKET_OVERLAY_COLLISION_CAPACITY = 48;

/** Presentation per incident category (see TRAFIKVERKET_INCIDENT_TYPES). */
export const TRAFIKVERKET_CATEGORY_STYLES = Object.freeze({
  accident: Object.freeze({ label: 'Accident', color: '#ef5350', rank: 5 }),
  obstacle: Object.freeze({ label: 'Obstacle', color: '#ffa726', rank: 4 }),
  important: Object.freeze({ label: 'Important', color: '#ce93d8', rank: 3 }),
  restriction: Object.freeze({
    label: 'Restriction',
    color: '#ffee58',
    rank: 2,
  }),
  notice: Object.freeze({ label: 'Notice', color: '#64b5f6', rank: 1 }),
});

const FALLBACK_STYLE = TRAFIKVERKET_CATEGORY_STYLES.notice;

/** Look up the style for a category, falling back to a plain notice. */
export function incidentStyle(category) {
  return TRAFIKVERKET_CATEGORY_STYLES[category] || FALLBACK_STYLE;
}

/** Point size in pixels by Trafikverket impact code (1, 2, 4, 5). */
export function incidentPixelSize(severity) {
  if (severity === 5) return 14;
  if (severity === 4) return 12;
  if (severity === 2) return 9;
  return 8;
}

/** Short ambient label, e.g. `Accident · E4`. */
export function incidentTitle(row) {
  const label = incidentStyle(row?.category).label;
  return row?.roadNumber ? `${label} · ${row.roadNumber}` : label;
}

/**
 * Build the source-owned presentation for one incident's ambient label.
 * Higher impact and more urgent categories win label collisions.
 * @param {object} input
 * @param {object} input.row Validated incident row.
 * @param {*} input.position Ground anchor shared with the incident point.
 * @returns {object}
 */
export function createIncidentOverlayEntry({ row, position }) {
  const style = incidentStyle(row.category);
  return {
    id: String(row.id),
    position,
    variant: 'label',
    title: incidentTitle(row),
    accent: style.color,
    priority: (row.severity || 0) * 10 + style.rank,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 12,
    verticalOnly: true,
    placement: 'above',
  };
}

export {
  TRAFIKVERKET_INCIDENT_TYPES,
  normalizeTrafikverketSituations,
  validateTrafikverketIncidentRows,
} from './records.js';
