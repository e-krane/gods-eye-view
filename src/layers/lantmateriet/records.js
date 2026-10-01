/**
 * Lantmäteriet Topografi 250 static line and area datasets: what each layer
 * takes from the GeoPackages, and the compact bundled formats the build script
 * writes and the browser validates. Pure and portable.
 */
import {
  encodeLine,
  mergeLines,
  simplifyLine,
  sweref99tmToWgs84,
} from './geometry.js';

export const STATIC_LINES_FORMAT = 'gev-static-lines/1';
export const STATIC_AREAS_FORMAT = 'gev-static-areas/1';

/**
 * Per dataset: the GeoPackage theme file and table, whether it holds lines or
 * areas, the classes kept (keyed by Lantmäteriet `objekttypnr`), whether a
 * road number labels the line, and the simplification tolerance in metres. Topografi 250 is already
 * generalized for 1:250 000, so tolerances stay small.
 */
export const LANTMATERIET_DATASETS = Object.freeze({
  power: Object.freeze({
    geometry: 'line',
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
    geometry: 'line',
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
    geometry: 'line',
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
  military: Object.freeze({
    geometry: 'area',
    theme: 'militartomrade',
    table: 'militart_omrade',
    classes: Object.freeze({
      5501: 'ovningsfalt',
      5503: 'skjutfalt',
    }),
    labelColumn: null,
    toleranceM: 10,
  }),
});

const MAX_LABEL_LENGTH = 32;
const SOURCE = 'Lantmäteriet, Topografi 250 Nedladdning, vektor';

function datasetOf(datasetId, geometry) {
  const dataset = LANTMATERIET_DATASETS[datasetId];
  if (!dataset || dataset.geometry !== geometry)
    throw new TypeError(
      `Unknown Lantmäteriet ${geometry} dataset ${datasetId}`,
    );
  return dataset;
}

const toWgs84 = (points) => points.map(([e, n]) => sweref99tmToWgs84(e, n));

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
  const dataset = datasetOf(datasetId, 'line');
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
      const encoded = encodeLine(toWgs84(simplified));
      if (encoded.length >= 4)
        lines.push([group.classIndex, group.label, encoded]);
    }
  }
  return {
    format: STATIC_LINES_FORMAT,
    dataset: datasetId,
    source: SOURCE,
    license: 'CC0 1.0',
    producedAt,
    classes,
    lines,
  };
}

/**
 * Build one bundled area dataset from GeoPackage rows. Each area is
 * `[classIndex, null, rings]`, its outer ring first, then holes; every ring
 * is encoded like a line and stays closed.
 * @param {string} datasetId A key of `LANTMATERIET_DATASETS` with area geometry.
 * @param {Iterable<{ objekttypnr: number, polygons: Array<Array<Array<[number, number]>>> }>} rows
 *   Rows with their polygons already parsed, in SWEREF 99 TM metres.
 * @param {{ producedAt: string }} meta Date the source data was produced.
 */
export function buildStaticAreaDataset(datasetId, rows, { producedAt }) {
  const dataset = datasetOf(datasetId, 'area');
  const classes = Object.values(dataset.classes);
  const areas = [];
  for (const row of rows) {
    const className = dataset.classes[row.objekttypnr];
    if (!className) continue;
    for (const polygon of row.polygons) {
      // A ring needs three corners plus the closing point.
      const [outer, ...holes] = polygon
        .map((ring) =>
          encodeLine(toWgs84(simplifyLine(ring, dataset.toleranceM))),
        )
        .map((encoded) => (encoded.length >= 8 ? encoded : null));
      // A polygon whose outer ring collapses is dropped, holes and all.
      if (!outer) continue;
      areas.push([
        classes.indexOf(className),
        null,
        [outer, ...holes.filter(Boolean)],
      ]);
    }
  }
  areas.sort((a, b) => a[0] - b[0]);
  return {
    format: STATIC_AREAS_FORMAT,
    dataset: datasetId,
    source: SOURCE,
    license: 'CC0 1.0',
    producedAt,
    classes,
    areas,
  };
}

const encodedLineValid = (coords, minLength) =>
  Array.isArray(coords) &&
  coords.length >= minLength &&
  coords.length % 2 === 0 &&
  coords.every(Number.isInteger);

function headerValid(json, datasetId, dataset, format) {
  return (
    dataset &&
    json &&
    json.format === format &&
    json.dataset === datasetId &&
    typeof json.producedAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}/.test(json.producedAt) &&
    Array.isArray(json.classes) &&
    json.classes.join() === Object.values(dataset.classes).join()
  );
}

/**
 * Validate a bundled dataset of either kind before it is drawn. Returns null
 * when it is malformed or is not the expected dataset.
 * @param {unknown} json
 * @param {string} datasetId
 */
export function validateLantmaterietDataset(json, datasetId) {
  return LANTMATERIET_DATASETS[datasetId]?.geometry === 'area'
    ? validateStaticAreaDataset(json, datasetId)
    : validateStaticLineDataset(json, datasetId);
}

/**
 * Validate a bundled area dataset. Returns null when it is malformed or is
 * not the expected dataset.
 * @param {unknown} json
 * @param {string} datasetId
 */
export function validateStaticAreaDataset(json, datasetId) {
  const dataset = LANTMATERIET_DATASETS[datasetId];
  if (
    dataset?.geometry !== 'area' ||
    !headerValid(json, datasetId, dataset, STATIC_AREAS_FORMAT) ||
    !Array.isArray(json.areas)
  )
    return null;
  for (const area of json.areas) {
    if (
      !Array.isArray(area) ||
      area.length !== 3 ||
      !Number.isInteger(area[0]) ||
      area[0] < 0 ||
      area[0] >= json.classes.length ||
      area[1] !== null ||
      !Array.isArray(area[2]) ||
      !area[2].length ||
      !area[2].every((ring) => encodedLineValid(ring, 8))
    )
      return null;
  }
  return json;
}

/**
 * Validate a bundled line dataset before it is drawn. Returns null when it is
 * malformed or is not the expected dataset.
 * @param {unknown} json
 * @param {string} datasetId
 */
export function validateStaticLineDataset(json, datasetId) {
  const dataset = LANTMATERIET_DATASETS[datasetId];
  if (
    dataset?.geometry !== 'line' ||
    !headerValid(json, datasetId, dataset, STATIC_LINES_FORMAT) ||
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
      !encodedLineValid(line[2], 4)
    )
      return null;
  }
  return json;
}
