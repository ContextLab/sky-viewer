/**
 * T023 — build-tz.ts
 *
 * Reads the timezone-boundary-builder "combined.json" GeoJSON
 * (`data/raw/combined.json`), rasterises it to a 1440×720 grid at
 * 0.25° resolution (grid cell center is (lonMin + (i+0.5)*step,
 * latMax - (j+0.5)*step)), then run-length-encodes in row-major order
 * (north-to-south rows, west-to-east cells).
 *
 * Output `data/tz.json`:
 * {
 *   "grid":  { "lonMin":-180, "latMin":-90, "step":0.25, "cols":1440, "rows":720 },
 *   "zones": ["Etc/UTC", "America/New_York", ...],
 *   "rle":   [[count, zoneIndex], ...]
 * }
 *
 * Cells outside any zone are assigned a special index (0), whose zone is
 * "Etc/UTC". Oceans and Antarctic interior mostly hit this default.
 *
 * Runtime lookup is:
 *   col = floor((lon - lonMin) / step)
 *   row = floor((latMax - lat) / step)  // row 0 is at +90° (top)
 *   scan the RLE from (row * cols + col).
 *
 * Source: https://github.com/evansiroky/timezone-boundary-builder
 * (ODbL for the underlying OSM data.)
 */

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';

const RAW = resolve('data/raw/combined.json');
const OUT = resolve('data/tz.json');

const STEP = 0.25;
const LON_MIN = -180;
const LAT_MIN = -90;
const COLS = Math.round(360 / STEP); // 1440
const ROWS = Math.round(180 / STEP); // 720

type Ring = number[][]; // [[lon, lat], ...]
type Polygon = Ring[]; // outer + holes
interface Feature {
  type: 'Feature';
  properties: { tzid?: string };
  geometry:
    | { type: 'Polygon'; coordinates: Ring[] }
    | { type: 'MultiPolygon'; coordinates: Ring[][] };
}
interface FeatureCollection {
  type: 'FeatureCollection';
  features: Feature[];
}

function ringBounds(ring: Ring): [number, number, number, number] {
  let lo0 = Infinity,
    la0 = Infinity,
    lo1 = -Infinity,
    la1 = -Infinity;
  for (const pt of ring) {
    const lon = pt[0]!;
    const lat = pt[1]!;
    if (lon < lo0) lo0 = lon;
    if (lon > lo1) lo1 = lon;
    if (lat < la0) la0 = lat;
    if (lat > la1) la1 = lat;
  }
  return [lo0, la0, lo1, la1];
}

function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ri = ring[i]!;
    const rj = ring[j]!;
    const xi = ri[0]!;
    const yi = ri[1]!;
    const xj = rj[0]!;
    const yj = rj[1]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(x: number, y: number, poly: Polygon): boolean {
  if (!pointInRing(x, y, poly[0]!)) return false;
  for (let i = 1; i < poly.length; i++) {
    if (pointInRing(x, y, poly[i]!)) return false;
  }
  return true;
}

function main(): void {
  process.stdout.write(`build-tz: loading combined.json (~155 MB)…\n`);
  const fc = JSON.parse(readFileSync(RAW, 'utf8')) as FeatureCollection;
  process.stdout.write(`build-tz: ${fc.features.length} zones loaded.\n`);

  // Grid of zone-indices. 0 = default ("Etc/UTC"), 1…N = features.
  const grid = new Uint16Array(COLS * ROWS);

  const zones: string[] = ['Etc/UTC'];

  for (let fIdx = 0; fIdx < fc.features.length; fIdx++) {
    const feat = fc.features[fIdx]!;
    const tzid = feat.properties?.tzid ?? 'Etc/UTC';
    const zoneIndex = zones.length;
    zones.push(tzid);

    const polygons: Polygon[] =
      feat.geometry.type === 'Polygon'
        ? [feat.geometry.coordinates as Ring[]]
        : (feat.geometry.coordinates as Ring[][]);

    for (const poly of polygons) {
      const [lo0, la0, lo1, la1] = ringBounds(poly[0]!);
      // Convert bounds → grid cell range. Row 0 = +90° (top).
      const colStart = Math.max(0, Math.floor((lo0 - LON_MIN) / STEP));
      const colEnd = Math.min(COLS - 1, Math.ceil((lo1 - LON_MIN) / STEP));
      const rowStartTopDown = Math.max(0, Math.floor((90 - la1) / STEP));
      const rowEndTopDown = Math.min(ROWS - 1, Math.ceil((90 - la0) / STEP));

      for (let r = rowStartTopDown; r <= rowEndTopDown; r++) {
        // lat of cell center
        const lat = 90 - (r + 0.5) * STEP;
        for (let c = colStart; c <= colEnd; c++) {
          const lon = LON_MIN + (c + 0.5) * STEP;
          const idx = r * COLS + c;
          if (grid[idx] !== 0) continue; // first-assignment wins
          if (pointInPolygon(lon, lat, poly)) grid[idx] = zoneIndex;
        }
      }
    }
    if ((fIdx + 1) % 50 === 0) {
      process.stdout.write(`  rasterised ${fIdx + 1}/${fc.features.length} zones…\n`);
    }
  }

  // Row-major RLE: we walk top-to-bottom, left-to-right (that's how the
  // grid Uint16Array is laid out already).
  const rle: [number, number][] = [];
  let run = 1;
  let curr = grid[0]!;
  for (let i = 1; i < grid.length; i++) {
    const v = grid[i]!;
    if (v === curr) {
      run++;
    } else {
      rle.push([run, curr]);
      curr = v;
      run = 1;
    }
  }
  rle.push([run, curr]);

  const out = {
    grid: { lonMin: LON_MIN, latMin: LAT_MIN, step: STEP, cols: COLS, rows: ROWS },
    zones,
    rle,
  };
  writeFileSync(OUT, JSON.stringify(out));
  const sz = statSync(OUT).size;
  const gz = gzipSync(readFileSync(OUT)).length;
  process.stdout.write(
    `build-tz: ${zones.length} zones, ${rle.length} RLE runs.\n` +
      `  data/tz.json: ${sz} bytes uncompressed, ${gz} bytes gzipped\n`,
  );
}

main();
