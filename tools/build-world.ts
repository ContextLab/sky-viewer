/**
 * T021 — build-world.ts
 *
 * Reads Natural Earth 1:110m admin_0_countries GeoJSON
 * (`data/raw/ne_110m_admin_0_countries.geojson`), applies Douglas-Peucker
 * simplification at ~0.2° tolerance, and writes `data/world.svg` — one
 * `<path>` per country with SVG viewBox `-180 -90 360 180`.
 *
 * The SVG y-axis is flipped (latitude increases northward, SVG y increases
 * downward), so each lat value is negated to put 90°N at the top.
 *
 * No country labels, no metadata. The UI layer styles fill/stroke.
 *
 * Source: Natural Earth (public domain).
 * https://github.com/nvkelso/natural-earth-vector
 */

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';

const RAW = resolve('data/raw/ne_110m_admin_0_countries.geojson');
const OUT = resolve('data/world.svg');

const SIMPLIFY_TOL_DEG = 0.2;
const COORD_PRECISION = 2; // decimals for SVG path coords

interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: Record<string, unknown>;
    geometry:
      | { type: 'Polygon'; coordinates: number[][][] }
      | { type: 'MultiPolygon'; coordinates: number[][][][] };
  }>;
}

type Point = [number, number]; // [lon, lat]

// Douglas-Peucker in lon/lat space. Tolerance is the max perpendicular
// distance (in degrees). Keeps the first + last points.
function douglasPeucker(pts: Point[], tol: number): Point[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    let maxD = 0;
    let maxI = -1;
    const a = pts[lo]!;
    const b = pts[hi]!;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDist(pts[i]!, a, b);
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxI !== -1 && maxD > tol) {
      keep[maxI] = 1;
      stack.push([lo, maxI]);
      stack.push([maxI, hi]);
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]!);
  return out;
}

function perpDist(p: Point, a: Point, b: Point): number {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) {
    const ddx = px - ax;
    const ddy = py - ay;
    return Math.hypot(ddx, ddy);
  }
  const num = Math.abs(dy * px - dx * py + bx * ay - by * ax);
  const den = Math.hypot(dx, dy);
  return num / den;
}

function ringToPath(ring: number[][]): string {
  const pts: Point[] = ring.map(([lon, lat]) => [lon, lat] as Point);
  // Remove any closing duplicate before simplify, add back after.
  const closed = pts.length > 1 && pts[0]![0] === pts[pts.length - 1]![0] && pts[0]![1] === pts[pts.length - 1]![1];
  const toSimplify = closed ? pts.slice(0, -1) : pts;
  const simplified = douglasPeucker(toSimplify, SIMPLIFY_TOL_DEG);
  if (simplified.length < 3) return '';
  let d = '';
  for (let i = 0; i < simplified.length; i++) {
    const [lon, lat] = simplified[i]!;
    const x = lon.toFixed(COORD_PRECISION);
    const y = (-lat).toFixed(COORD_PRECISION); // flip y for SVG
    d += (i === 0 ? 'M' : 'L') + x + ' ' + y;
  }
  d += 'Z';
  return d;
}

function main(): void {
  const geo = JSON.parse(readFileSync(RAW, 'utf8')) as GeoJsonFeatureCollection;
  const paths: string[] = [];
  let ringsIn = 0;
  let ringsKept = 0;

  for (const feat of geo.features) {
    const g = feat.geometry;
    if (!g) continue;
    const polygons: number[][][][] = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    const parts: string[] = [];
    for (const poly of polygons) {
      for (const ring of poly) {
        ringsIn++;
        const d = ringToPath(ring);
        if (d) {
          parts.push(d);
          ringsKept++;
        }
      }
    }
    if (parts.length) paths.push(parts.join(''));
  }

  const svgParts: string[] = [];
  svgParts.push(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-180 -90 360 180">',
  );
  svgParts.push('<!-- Natural Earth 1:110m admin_0_countries, public domain. -->');
  for (const d of paths) {
    svgParts.push(`<path d="${d}"/>`);
  }
  svgParts.push('</svg>');
  const svg = svgParts.join('\n');
  writeFileSync(OUT, svg);

  const sz = statSync(OUT).size;
  const gz = gzipSync(svg).length;
  process.stdout.write(
    `build-world: ${paths.length} country paths, ${ringsKept}/${ringsIn} rings kept (tol=${SIMPLIFY_TOL_DEG}°).\n` +
      `  data/world.svg: ${sz} bytes uncompressed, ${gz} bytes gzipped\n`,
  );
}

main();
