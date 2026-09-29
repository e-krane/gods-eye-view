/** SMHI metobs parameter 1: air temperature, instantaneous, hourly. */
export const SMHI_AIR_TEMPERATURE_PARAMETER = '1';

const QUALITY_CODES = new Set(['G', 'Y', 'O']);

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Validate a complete SMHI latest-hour station-set before it can replace the
 * displayed snapshot. Stations that have not reported this hour (empty
 * `value`) are skipped; a structurally malformed feed returns null so the
 * layer keeps its last good snapshot.
 * @param {object} payload Parsed `station-set/all/period/latest-hour` body.
 * @param {string} [parameter] Expected metobs parameter key.
 * @returns {Array<object>|null}
 */
export function normalizeSmhiObservationSnapshot(
  payload,
  parameter = SMHI_AIR_TEMPERATURE_PARAMETER,
) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    String(payload.parameter?.key) !== parameter ||
    !Array.isArray(payload.station)
  )
    return null;
  const rows = [];
  const ids = new Set();
  for (const station of payload.station) {
    if (!station || typeof station !== 'object') return null;
    const stationId = String(station.key ?? '').trim();
    const lat = finiteNumber(station.latitude);
    const lon = finiteNumber(station.longitude);
    if (
      !stationId ||
      ids.has(stationId) ||
      lat === null ||
      Math.abs(lat) > 90 ||
      lon === null ||
      Math.abs(lon) > 180 ||
      (station.value != null && !Array.isArray(station.value))
    )
      return null;
    ids.add(stationId);
    // Latest-hour carries at most one observation; take the newest if not.
    let latest = null;
    for (const observation of station.value || []) {
      const observedAt = finiteNumber(observation?.date);
      if (observedAt === null) return null;
      if (!latest || observedAt > latest.observedAt)
        latest = { observedAt, raw: observation };
    }
    if (!latest) continue;
    const value = finiteNumber(latest.raw.value);
    // A present but non-numeric reading is a feed fault, not a quiet station.
    if (value === null) {
      if (latest.raw.value == null || latest.raw.value === '') continue;
      return null;
    }
    // Physically implausible air temperatures are sensor faults; skip them.
    if (value < -70 || value > 60) continue;
    const quality = QUALITY_CODES.has(latest.raw.quality)
      ? latest.raw.quality
      : null;
    rows.push({
      stationId,
      name:
        typeof station.name === 'string' && station.name.trim()
          ? station.name.trim()
          : `Station ${stationId}`,
      owner: typeof station.owner === 'string' ? station.owner : null,
      lat,
      lon,
      heightM: finiteNumber(station.height),
      value,
      observedAt: latest.observedAt,
      quality,
    });
  }
  return rows;
}
