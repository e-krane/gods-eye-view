/** Occupied territory: a translucent fill with the front drawn as a line. */
export const FRONTLINE_STYLE = Object.freeze({
  color: '#e53935',
  fillAlpha: 0.22,
  lineAlpha: 0.9,
  lineWidth: 2,
});

/**
 * The mirror publishes daily; a file more than two days old means updates
 * have stopped, so the chip reads STALE.
 */
export const FRONTLINE_STALE_AFTER_MS = 2 * 24 * 60 * 60_000;

/**
 * @param {string} date `YYYY-MM-DD` of the file's UTC day
 * @param {number} now
 */
export function frontlineDayIsStale(date, now) {
  const dayEnd = Date.parse(`${date}T00:00:00Z`) + 24 * 60 * 60_000;
  return !Number.isFinite(dayEnd) || now - dayEnd > FRONTLINE_STALE_AFTER_MS;
}
