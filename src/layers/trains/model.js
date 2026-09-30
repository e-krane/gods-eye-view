export const TRAIN_OVERLAY_SOURCE_ID = 'trafikverket-train-positions';
export const TRAIN_OVERLAY_COHORT_LIMIT = 96;
export const TRAIN_OVERLAY_COLLISION_CAPACITY = 32;
export const TRAIN_COLOR = '#4dd0e1';

/** Short ambient label, e.g. `Train 537 · 180 km/h`. */
export function trainTitle(row) {
  return row?.speed != null
    ? `Train ${row.number} · ${row.speed} km/h`
    : `Train ${row?.number}`;
}

/**
 * Build the source-owned presentation for one train's ambient label. Faster
 * trains win label collisions, so long-distance services stay named.
 * @param {{row: object, position: *}} input
 * @returns {object}
 */
export function createTrainOverlayEntry({ row, position }) {
  return {
    id: row.id,
    position,
    variant: 'label',
    title: trainTitle(row),
    accent: TRAIN_COLOR,
    priority: row.speed ?? 0,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 10,
    verticalOnly: true,
    placement: 'above',
  };
}
