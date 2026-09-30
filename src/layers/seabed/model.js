/** Presentation for Baltic seabed incidents. Pure: no Cesium types. */

export const SEABED_LABEL_SOURCE_ID = 'baltic-seabed-incidents';
export const SEABED_CARD_SOURCE_ID = 'baltic-seabed-incidents-card';
export const SEABED_LABEL_OPTIONS = Object.freeze({
  cohortLimit: 64,
  collisionCapacity: 24,
  moving: false,
});
export const SEABED_CARD_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/** Colour and wording per status (see SEABED_STATUSES). */
export const SEABED_STATUS_STYLES = Object.freeze({
  confirmed_sabotage: Object.freeze({
    label: 'Confirmed sabotage',
    color: '#e53935',
    rank: 5,
  }),
  suspected: Object.freeze({
    label: 'Suspected sabotage',
    color: '#fb8c00',
    rank: 4,
  }),
  attributed: Object.freeze({
    label: 'Anchor drag attributed',
    color: '#fdd835',
    rank: 3,
  }),
  unresolved: Object.freeze({ label: 'Unresolved', color: '#90a4ae', rank: 2 }),
  ruled_accidental: Object.freeze({
    label: 'Ruled accidental',
    color: '#66bb6a',
    rank: 1,
  }),
});

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const MAX_SUMMARY = 160;

/** Look up a status style, falling back to unresolved. */
export function seabedStatusStyle(status) {
  return SEABED_STATUS_STYLES[status] || SEABED_STATUS_STYLES.unresolved;
}

/** `2024-12-25` → `Dec 2024`. */
export function seabedMonth(date) {
  const [year, month] = String(date).split('-');
  return `${MONTHS[Number(month) - 1] || '?'} ${year}`;
}

/** Short ambient label, e.g. `Estlink 2 · Dec 2024`. */
export function seabedIncidentTitle(incident) {
  return `${incident.title} · ${seabedMonth(incident.date)}`;
}

/**
 * Build the source-owned presentation for one incident's ambient label.
 * More serious statuses and newer incidents win label collisions.
 * @param {{incident: object, position: *}} input
 * @returns {object}
 */
export function createSeabedLabelEntry({ incident, position }) {
  const style = seabedStatusStyle(incident.status);
  return {
    id: incident.id,
    position,
    variant: 'label',
    title: seabedIncidentTitle(incident),
    accent: style.color,
    priority: style.rank * 1e8 + Number(incident.date.replaceAll('-', '')),
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

function shorten(text, max) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Build the overlay card for one selected incident. The caller adds
 * `position`; the card links to the incident's first source.
 * @param {object} incident A validated incident.
 * @returns {object}
 */
export function buildSeabedCard(incident) {
  const style = seabedStatusStyle(incident.status);
  const [source] = incident.sources;
  const details = [
    `${incident.date} · ${style.label} (as of ${incident.statusAsOf})`,
    incident.assets.join(' · '),
  ];
  if (incident.vessel) details.push(`Vessel: ${incident.vessel}`);
  details.push(shorten(incident.summary, MAX_SUMMARY));
  details.push(`Location ±${incident.uncertaintyKm} km`);
  details.push(`${source.publisher} ↗ · click card to open`);
  const title = `SEABED · ${incident.title}`;
  return {
    id: `baltic-seabed-incident-card:${incident.id}`,
    selected: true,
    interactive: true,
    accessibilityLabel: `Open the ${source.publisher} source for ${incident.title}`,
    title,
    details,
    accent: style.color,
    priority: Number.MAX_SAFE_INTEGER,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}
