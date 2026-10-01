/**
 * Lantmäteriet Topografi 250 static line datasets: what each layer takes from
 * the GeoPackages, and the compact bundled format the build script writes and
 * the browser validates. Pure and portable.
 */
import {
  encodeLine,
  mergeLines,
  simplifyLine,
  sweref99tmToWgs84,
} from './geometry.js';

export const STATIC_LINES_FORMAT = 'gev-static-lines/1';

/**
 * Per dataset: the GeoPackage theme file and table, the line classes kept
 * (keyed by Lantmäteriet `objekttypnr`), whether a road number labels the
 * line, and the simplification tolerance in metres. Topografi 250 is already
 * generalized for 1:250 000, so tolerances stay small.
 */
export const LANTMATERIET_DATASETS = Object.freeze({
  power: Object.freeze({
    theme: 'ledningar',
    table: 'ledningslinje',
    classes: Object.freeze({
      1702: 'stam',
      1703: 'region',
    }),
    labelColumn: null,
    toleranceM: 20,
  }),
  rail: Object.freeze({
    theme: 'kommunikation',
    table: 'ralstrafik',
    classes: Object.freeze({
      1861: 'jarnvag',
      1862: 'museijarnvag',
    }),
    labelColumn: null,
    toleranceM: 15,
  }),
  roads: Object.freeze({
    theme: 'kommunikation',
    table: 'vaglinje',
    classes: Object.freeze({
      1801: 'motorvag',
      1802: 'motortrafikled',
      1803: 'motesfri',
      1804: 'landsvag',
    }),
    labelColumn: 'vardvagnummer',
    toleranceM: 20,
  }),
});

const MAX_LABEL_LENGTH = 32;

function cleanLabel(value) {
  if (typeof value !== 'string') return null;
  const label = value.trim();
  return label && label.length <= MAX_LABEL_LENGTH ? label : null;
}

/**
 * Build one bundled dataset from GeoPackage rows.
 * @param {string} datasetId A key of `LANTMATERIET_DATASETS`.
 * @param {Iterable<{ objekttypnr: number, label?: string|null, lines: Array<Array<[number, number]>> }>} rows
 *   Rows with their lines already parsed, in SWEREF 99 TM metres.
 * @param {{ producedAt: string }} meta Date the source data was produced.
 */
export function buildStaticLineDataset(datasetId, rows, { producedAt }) {
  const dataset = LANTMATERIET_DATASETS[datasetId];
  if (!dataset)
    throw new TypeError(`Unknown Lantmäteriet dataset ${datasetId}`);
  const classes = Object.values(dataset.classes);
  // Group by class and label so merging never joins two different roads.
  const groups = new Map();
  for (const row of rows) {
    const className = dataset.classes[row.objekttypnr];
    if (!className) continue;
    const label = dataset.labelColumn ? cleanLabel(row.label) : null;
    const key = `${className}\u0000${label ?? ''}`;
    let group = groups.get(key);
    if (!group) {
      group = { classIndex: classes.indexOf(className), label, lines: [] };
      groups.set(key, group);
    }
    group.lines.push(...row.lines);
  }
  const lines = [];
  for (const group of [...groups.values()].sort(
    (a, b) =>
      a.classIndex - b.classIndex ||
      (a.label ?? '').localeCompare(b.label ?? ''),
  )) {
    for (const merged of mergeLines(group.lines)) {
      const simplified = simplifyLine(merged, dataset.toleranceM);
      const encoded = encodeLine(
        simplified.map(([e, n]) => sweref99tmToWgs84(e, n)),
      );
      if (encoded.length >= 4)
        lines.push([group.classIndex, group.label, encoded]);
    }
  }
  return {
    format: STATIC_LINES_FORMAT,
    dataset: datasetId,
    source: 'Lantmäteriet, Topografi 250 Nedladdning, vektor',
    license: 'CC0 1.0',
    producedAt,
    classes,
    lines,
  };
}

/**
 * Validate a bundled dataset before it is drawn. Returns null when it is
 * malformed or is not the expected dataset.
 * @param {unknown} json
 * @param {string} datasetId
 */
export function validateStaticLineDataset(json, datasetId) {
  const dataset = LANTMATERIET_DATASETS[datasetId];
  if (
    !dataset ||
    !json ||
    json.format !== STATIC_LINES_FORMAT ||
    json.dataset !== datasetId ||
    typeof json.producedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}/.test(json.producedAt) ||
    !Array.isArray(json.classes) ||
    json.classes.join() !== Object.values(dataset.classes).join() ||
    !Array.isArray(json.lines)
  )
    return null;
  for (const line of json.lines) {
    if (
      !Array.isArray(line) ||
      line.length !== 3 ||
      !Number.isInteger(line[0]) ||
      line[0] < 0 ||
      line[0] >= json.classes.length ||
      (line[1] !== null &&
        (typeof line[1] !== 'string' || line[1].length > MAX_LABEL_LENGTH)) ||
      !Array.isArray(line[2]) ||
      line[2].length < 4 ||
      line[2].length % 2 !== 0 ||
      !line[2].every(Number.isInteger)
    )
      return null;
  }
  return json;
}
