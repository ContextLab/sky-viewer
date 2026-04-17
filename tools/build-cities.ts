/**
 * T022 — build-cities.ts
 *
 * Reads `data/raw/cities15000.txt` (GeoNames cities ≥ 15k population,
 * tab-separated). Keeps { name, asciiName, country, lat, lon, population }
 * per row, sorts by descending population, and writes `data/cities.json`.
 *
 * If the full ~33k-row file blows the 40 KB gzipped budget after stringify,
 * we top-slice (most-populous first) until it fits.
 *
 * GeoNames TSV column layout (1-based):
 *   1  geonameid
 *   2  name
 *   3  asciiname
 *   4  alternatenames
 *   5  latitude
 *   6  longitude
 *   7  feature class
 *   8  feature code
 *   9  country code
 *  10  cc2
 *  11  admin1 code
 *  12  admin2 code
 *  13  admin3 code
 *  14  admin4 code
 *  15  population
 *  16  elevation
 *  17  dem
 *  18  timezone
 *  19  modification date
 *
 * Source: GeoNames (CC BY 4.0). https://www.geonames.org/
 */

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';

const RAW = resolve('data/raw/cities15000.txt');
const OUT = resolve('data/cities.json');

const GZ_BUDGET = 40 * 1024; // 40 KB gzipped

interface City {
  name: string;
  asciiName: string;
  country: string;
  lat: number;
  lon: number;
  population: number;
}

function parseRow(line: string): City | null {
  const f = line.split('\t');
  if (f.length < 19) return null;
  const name = f[1];
  const asciiName = f[2];
  const latStr = f[4];
  const lonStr = f[5];
  const country = f[8];
  const popStr = f[14];
  if (!name || !asciiName) return null;
  const lat = Number(latStr);
  const lon = Number(lonStr);
  const population = Number(popStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!country) return null;
  return {
    name,
    asciiName,
    country,
    lat: Math.round(lat * 1e4) / 1e4,
    lon: Math.round(lon * 1e4) / 1e4,
    population: Number.isFinite(population) ? population : 0,
  };
}

function main(): void {
  const text = readFileSync(RAW, 'utf8');
  const lines = text.split('\n');
  const cities: City[] = [];
  for (const l of lines) {
    if (!l) continue;
    const c = parseRow(l);
    if (c) cities.push(c);
  }
  cities.sort((a, b) => b.population - a.population);

  // Binary-search for the largest prefix that fits the gzip budget.
  let lo = 1;
  let hi = cities.length;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const slice = cities.slice(0, mid);
    const gz = gzipSync(Buffer.from(JSON.stringify(slice))).length;
    if (gz <= GZ_BUDGET) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const kept = cities.slice(0, best);
  writeFileSync(OUT, JSON.stringify(kept));
  const sz = statSync(OUT).size;
  const gz = gzipSync(readFileSync(OUT)).length;
  process.stdout.write(
    `build-cities: parsed ${cities.length} cities, kept ${kept.length} (fits ${GZ_BUDGET} B gzipped budget).\n` +
      `  data/cities.json: ${sz} bytes uncompressed, ${gz} bytes gzipped\n`,
  );
}

main();
