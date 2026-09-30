/** GPSJam's own colours for its medium and high levels. */
export const GNSS_LEVEL_STYLES = Object.freeze({
  medium: Object.freeze({ label: 'Medium', color: '#fdd835', alpha: 0.5 }),
  high: Object.freeze({ label: 'High', color: '#e53935', alpha: 0.6 }),
});

/**
 * GPSJam publishes day D shortly after it ends at midnight UTC. A snapshot
 * reads stale once day D + 1 should also have been published, with slack.
 */
export const GNSS_STALE_AFTER_DAY_END_MS = 36 * 60 * 60_000;

/** Look up the style for a level, falling back to medium. */
export function gnssLevelStyle(level) {
  return GNSS_LEVEL_STYLES[level] || GNSS_LEVEL_STYLES.medium;
}

/**
 * True when the UTC day a snapshot covers is older than the next expected
 * publication.
 * @param {string} date `YYYY-MM-DD`
 * @param {number} now
 */
export function gnssDayIsStale(date, now) {
  const dayEnd = Date.parse(`${date}T00:00:00Z`) + 24 * 60 * 60_000;
  return !Number.isFinite(dayEnd) || now - dayEnd > GNSS_STALE_AFTER_DAY_END_MS;
}

/** Entity name for one hexagon, e.g. `GNSS interference · High · 23.4 %`. */
export function gnssCellTitle(cell) {
  return `GNSS interference · ${gnssLevelStyle(cell?.level).label} · ${cell?.percent} %`;
}
