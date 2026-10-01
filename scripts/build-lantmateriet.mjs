#!/usr/bin/env node
/**
 * Build the bundled Lantmäteriet static line datasets (power lines, railways,
 * main roads) in src/data/local_data/lantmateriet_topografi250/ from
 * Lantmäteriet's open "Topografi 250 Nedladdning, vektor" (CC0).
 *
 * The data comes as GeoPackages per theme (ledningar, kommunikation) in
 * SWEREF 99 TM. Rows are merged per class, simplified in metres, converted to
 * WGS84 and delta-encoded; see src/layers/lantmateriet/records.js.
 *
 * Usage:
 *   node scripts/build-lantmateriet.mjs [--order <OrderID>] [--new-delivery]
 *   node scripts/build-lantmateriet.mjs --from <dir with .gpkg or .zip files>
 * Add --out <dir> to write somewhere other than the bundled data folder.
 *
 * Download mode reads LANTMATERIET_USERNAME and LANTMATERIET_PASSWORD (a
 * Geotorget account, Basic auth) and the order id from --order or
 * LANTMATERIET_TOPT_250_ORDER_ID: the id on the order row in Geotorget, Mitt konto →
 * Ärenden. It downloads the order's latest delivery into .gev-cache/.
 * --new-delivery first asks for a fresh delivery (subscription orders only)
 * and waits for it. Requires Node 24 (node:sqlite).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { parseGpkgLines } from '../src/layers/lantmateriet/geometry.js';
import {
  LANTMATERIET_DATASETS,
  buildStaticLineDataset,
} from '../src/layers/lantmateriet/records.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(
  ROOT,
  'src',
  'data',
  'local_data',
  'lantmateriet_topografi250',
);
const CACHE_DIR = path.join(ROOT, '.gev-cache', 'lantmateriet');
const API = 'https://api.lantmateriet.se/geotorget/nedladdning/v1';

function parseArgs(argv) {
  const args = { order: process.env.LANTMATERIET_TOPT_250_ORDER_ID || null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') args.from = argv[++i];
    else if (argv[i] === '--order') args.order = argv[++i];
    else if (argv[i] === '--new-delivery') args.newDelivery = true;
    else if (argv[i] === '--out') args.out = argv[++i];
    else throw new Error(`Unknown argument ${argv[i]}`);
  }
  return args;
}

function authHeader() {
  const user = process.env.LANTMATERIET_USERNAME;
  const password = process.env.LANTMATERIET_PASSWORD;
  if (!user || !password)
    throw new Error(
      'Set LANTMATERIET_USERNAME and LANTMATERIET_PASSWORD (a Geotorget account), or use --from',
    );
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

async function api(pathname, { method = 'GET', json = true } = {}) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(
      `Geotorget ${method} ${pathname.split('?')[0]}: HTTP ${response.status} ${body}`,
    );
  }
  return json ? response.json() : response;
}

/** List every downloadable file in the latest delivery, walking sub-levels. */
async function listFiles(
  order,
  pathname = '/leverans/latest/files',
  depth = 0,
) {
  if (depth > 4) return [];
  const entries = await api(`/${order}${pathname}`);
  const files = [];
  for (const entry of entries) {
    if (entry.type === 'application/octet-stream') files.push(entry);
    else if (entry.type === 'application/json' && entry.title !== 'metadata')
      files.push(...(await listFiles(order, entry.path, depth + 1)));
  }
  return files;
}

async function download(order, args) {
  if (!args.order)
    throw new Error(
      'Pass --order <OrderID> or set LANTMATERIET_TOPT_250_ORDER_ID (Geotorget, Mitt konto → Ärenden)',
    );
  const info = await api(`/${order}`);
  console.log(
    `Order: ${info.produktnamn} (${info.status}, created ${info.skapad})`,
  );
  if (args.newDelivery) {
    await api(`/${order}/leverans?typ=BAS`, { method: 'POST' });
    console.log('Requested a new delivery; waiting for it…');
  }
  let delivery;
  for (let attempt = 0; ; attempt++) {
    delivery = await api(`/${order}/leverans/latest`);
    if (delivery.status === 'LYCKAD') break;
    if (delivery.status !== 'PÅGÅENDE' || attempt >= 60)
      throw new Error(`Latest delivery is ${delivery.status}`);
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
  console.log(
    `Delivery ${delivery.skapad} (${delivery.metadata?.humanReadableSize ?? 'size unknown'})`,
  );
  const themes = new Set(
    Object.values(LANTMATERIET_DATASETS).map(({ theme }) => theme),
  );
  const wanted = (await listFiles(order)).filter((file) =>
    [...themes].some((theme) => file.title.toLowerCase().startsWith(theme)),
  );
  if (!wanted.length)
    throw new Error('The delivery has no ledningar or kommunikation files');
  const dir = path.join(CACHE_DIR, delivery.objektidentitet || 'latest');
  fs.mkdirSync(dir, { recursive: true });
  for (const file of wanted) {
    const target = path.join(dir, path.basename(file.title));
    if (fs.existsSync(target) && fs.statSync(target).size === file.length) {
      console.log(`Cached ${file.title}`);
      continue;
    }
    console.log(`Downloading ${file.title} (${file.displaySize})…`);
    const response = await api(`/${order}${file.path}`, { json: false });
    fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  }
  return { dir, producedAt: delivery.skapad.slice(0, 10) };
}

/** Delivery dates of extracted GeoPackages, from their zip entries. */
const zipDates = new Map();

/** `YYYY-MM-DD` from a zip entry's DOS date field. */
function dosDate(value) {
  const year = 1980 + (value >> 9);
  const month = String((value >> 5) & 0x0f).padStart(2, '0');
  const day = String(value & 0x1f).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Extract the .gpkg members of a zip archive (stored or deflated). */
function extractGpkgs(zipPath, dir) {
  const zip = fs.readFileSync(zipPath);
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error(`${zipPath} is not a zip archive`);
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const extracted = [];
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(offset + 10);
    const date = dosDate(zip.readUInt16LE(offset + 14));
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (!name.toLowerCase().endsWith('.gpkg')) continue;
    if (compressedSize === 0xffffffff)
      throw new Error(`${name} needs zip64; unzip it first and use --from`);
    const dataStart =
      local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(dataStart, dataStart + compressedSize);
    const bytes =
      method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : null;
    if (!bytes)
      throw new Error(`${name} uses unsupported zip method ${method}`);
    const target = path.join(dir, path.basename(name));
    fs.writeFileSync(target, bytes);
    zipDates.set(target, date);
    extracted.push(target);
  }
  return extracted;
}

function findGpkgs(dir) {
  const found = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) found.push(...findGpkgs(full));
    else if (name.toLowerCase().endsWith('.gpkg')) found.push(full);
    else if (name.toLowerCase().endsWith('.zip')) {
      const unpacked = path.join(
        dir,
        `${path.basename(name, '.zip')}.unzipped`,
      );
      fs.mkdirSync(unpacked, { recursive: true });
      found.push(...extractGpkgs(full, unpacked));
    }
  }
  return [...new Set(found)];
}

/** Read one dataset's rows from whichever GeoPackage holds its table. */
function readRows(gpkgs, datasetId) {
  const dataset = LANTMATERIET_DATASETS[datasetId];
  for (const file of gpkgs) {
    if (!path.basename(file).toLowerCase().startsWith(dataset.theme)) continue;
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const column = db
        .prepare(
          'SELECT table_name, column_name, srs_id FROM gpkg_geometry_columns WHERE lower(table_name) = ? OR lower(table_name) LIKE ?',
        )
        .get(dataset.table, `%${dataset.table}`);
      if (!column) continue;
      if (Number(column.srs_id) !== 3006)
        throw new Error(
          `${column.table_name} is in SRS ${column.srs_id}; order SWEREF 99 TM (EPSG:3006)`,
        );
      const quote = (name) => `"${String(name).replaceAll('"', '""')}"`;
      const label = dataset.labelColumn ? quote(dataset.labelColumn) : 'NULL';
      const rows = [];
      let latest = '';
      for (const row of db
        .prepare(
          `SELECT objekttypnr, ${label} AS label, skapad, ${quote(column.column_name)} AS geom FROM ${quote(column.table_name)}`,
        )
        .iterate()) {
        if (typeof row.skapad === 'string' && row.skapad > latest)
          latest = row.skapad;
        rows.push({
          objekttypnr: Number(row.objekttypnr),
          label: row.label,
          lines: parseGpkgLines(row.geom),
        });
      }
      console.log(
        `${datasetId}: ${rows.length} rows from ${path.basename(file)} ${column.table_name}`,
      );
      // Local files: the zip's delivery date, else the newest edit.
      return {
        rows,
        asOf: zipDates.get(file) || latest.slice(0, 10),
      };
    } finally {
      db.close();
    }
  }
  throw new Error(
    `No ${dataset.theme} GeoPackage with a ${dataset.table} table`,
  );
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { dir, producedAt } = args.from
    ? { dir: path.resolve(args.from), producedAt: null }
    : await download(args.order, args);
  const gpkgs = findGpkgs(dir);
  const outDir = args.out ? path.resolve(args.out) : OUT_DIR;
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  for (const datasetId of Object.keys(LANTMATERIET_DATASETS)) {
    const { rows, asOf } = readRows(gpkgs, datasetId);
    const built = buildStaticLineDataset(datasetId, rows, {
      producedAt: producedAt || asOf,
    });
    const text = `${JSON.stringify(built)}\n`;
    const name = `${datasetId}.json`;
    fs.writeFileSync(path.join(outDir, name), text);
    const points = built.lines.reduce((sum, [, , c]) => sum + c.length / 2, 0);
    console.log(
      `${name}: ${built.lines.length} lines, ${points} points, ${(text.length / 1024).toFixed(0)} KB`,
    );
    files.push({
      path: name,
      dataset: datasetId,
      table: LANTMATERIET_DATASETS[datasetId].table,
      produced_at: built.producedAt,
      line_count: built.lines.length,
      point_count: points,
      sha256: sha256(text),
    });
  }
  const source = {
    id: 'lantmateriet-topografi250',
    name: 'Lantmäteriet Topografi 250 Nedladdning, vektor',
    category: 'infrastructure',
    description:
      'Swedish power lines, railways and main roads, simplified for the globe.',
    built_at: new Date().toISOString().slice(0, 10),
    license_note: 'CC0 1.0. Attribution: © Lantmäteriet.',
    files,
  };
  fs.writeFileSync(
    path.join(outDir, 'source.json'),
    `${JSON.stringify(source, null, 2)}\n`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
