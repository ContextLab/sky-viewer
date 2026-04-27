// T030 — Top-level PDF builder for Print Mode.
//
// Pipeline (per contracts/print-api.md § pdf-builder):
//   1. Derive Surface[] from job.room; filter to enabled.
//   2. For each enabled surface: compute the tile grid via
//      `computeTileGrid`.
//   3. Project all visible bodies (stars + Sun + Moon + planets) onto
//      each surface; build a flat Hole[] per surface.
//   4. Bin holes into tiles via `assignHolesToTiles`.
//   5. Clip no-paint features per surface via `clipFeaturesToTiles`.
//   6. Build the canonical-order Tile[] (cover → ceiling rows/cols
//      row-major → walls in floor-plan order → floor last; blank tiles
//      included per FR-014).
//   7. Compute the preflight summary via `computePreflightSummary`.
//   8. Allocate `new jsPDF({ unit: 'mm', format: ... })`; emit cover
//      page; addPage() for each Tile and emit it.
//   9. Wrap in PdfBlob; return.
//
// SC-008: `pageCount === preflight.totalPageCount` exactly. We
// achieve this by reusing the same surface filter + same tile-grid
// computation for both `computePreflightSummary` and the actual emit
// loop — divergent code paths would silently break the invariant.
//
// `_tiles` (test-only) on the returned PdfBlob exposes the in-memory
// Tile array so unit tests can verify SC-005 (no holes inside no-paint
// features) and SC-006 (split-hole reconstruction) without re-parsing
// the PDF.

import { jsPDF } from "jspdf";
import { equatorialToHorizontal, precessStarToEpoch } from "../astro/transforms";
import type { SkyDatasets } from "../render/types";
import { emitCoverPage } from "./cover-page";
import { emitTilePage } from "./tile-page";
import {
  antipodalize,
  bodyToWorldVec,
  deriveSurfaces,
  projectBodyOntoSurface,
} from "./projection";
import { computePreflightSummary, type PreflightBody } from "./preflight";
import {
  assignHolesToTiles,
  clipFeaturesToTiles,
  computeTileGrid,
  paperToMm,
  tileKey,
  type TileGrid,
} from "./tile-grid";
import {
  classifyMagnitude,
  type ConstellationSegment,
  type FeatureCutout,
  type Hole,
  type PdfBlob,
  type PrintJob,
  type Surface,
  type Tile,
} from "./types";

/** Extension of `PdfBlob` that exposes the internal Tile array for tests. */
export interface PdfBlobWithTiles extends PdfBlob {
  /** Test-only: every Tile that was emitted, in canonical print order. */
  _tiles?: Tile[];
  /**
   * Test-only: the raw PDF bytes as an ArrayBuffer. jsdom's Blob in
   * older versions does not implement `arrayBuffer()`, so tests read
   * this field directly rather than going through the Blob.
   */
  _arrayBuffer?: ArrayBuffer;
}

/**
 * Build a PDF for the given PrintJob. Pure (does not mutate `job`).
 *
 * Returns a `Promise` because jsPDF's `output('blob')` is synchronous
 * but the contract reserves async-ness for future streaming work.
 */
export function buildPdf(
  job: PrintJob,
  datasets: SkyDatasets,
  bodies: ReadonlyArray<PreflightBody> = [],
): Promise<PdfBlobWithTiles> {
  // ---- 1. Derive surfaces, filter to enabled ------------------------------
  const allSurfaces = deriveSurfaces(
    job.room,
    job.outputOptions.blockHorizonOnWalls,
  );
  const enabled = allSurfaces.filter((s) => s.enabled);

  // ---- 2. Project all bodies once into (altDeg, azDeg) per the observation.
  const obs = job.observation;
  const utcMs = Date.parse(obs.utcInstant);
  const utcSafe = Number.isFinite(utcMs) ? utcMs : 0;
  const latRad = (obs.location.lat * Math.PI) / 180;
  const lonRad = (obs.location.lon * Math.PI) / 180;

  interface ProjBody {
    altDeg: number;
    azDeg: number;
    mag: number;
    bodyKind: Hole["bodyKind"];
    label: string;
  }
  const projBodies: ProjBody[] = [];

  // Map from HR id -> (altDeg, azDeg) for constellation-line endpoints.
  // We store it for ALL stars (regardless of magnitude class) so dim
  // line-endpoint stars are still positioned correctly.
  const starApparent = new Map<number, { altDeg: number; azDeg: number }>();

  for (const star of datasets.stars) {
    const epoch = precessStarToEpoch(
      star.raJ2000Rad,
      star.decJ2000Rad,
      star.pmRaMasPerYr,
      star.pmDecMasPerYr,
      utcSafe,
    );
    const { altDeg, azDeg } = equatorialToHorizontal(
      epoch.ra,
      epoch.dec,
      latRad,
      lonRad,
      utcSafe,
    );
    starApparent.set(star.id, { altDeg, azDeg });
    if (classifyMagnitude(star.vmag) === null) continue;
    projBodies.push({
      altDeg,
      azDeg,
      mag: star.vmag,
      bodyKind: "star",
      label: `HR-${star.id}`,
    });
  }
  for (const b of bodies) {
    if (classifyMagnitude(b.apparentMag) === null) continue;
    const bodyKind: Hole["bodyKind"] =
      b.bodyKind === "sun" ? "sun" : b.bodyKind === "moon" ? "moon" : "planet";
    projBodies.push({
      altDeg: b.altDeg,
      azDeg: b.azDeg,
      mag: b.apparentMag,
      bodyKind,
      label: b.label,
    });
  }

  const observerPos = {
    x: job.room.observerPositionMm.xMm,
    y: job.room.observerPositionMm.yMm,
    z: job.room.observerPositionMm.eyeHeightMm,
  };

  // ---- 3-5. Per-surface: project bodies, bin holes, clip features ---------
  interface SurfaceWork {
    surface: Surface;
    grid: TileGrid;
    holes: Hole[];
    holesByTile: Map<string, Hole[]>;
    featuresByTile: Map<string, FeatureCutout[]>;
    /** Constellation segments grouped by tile key (US2 / R8 / T049). */
    segmentsByTile: Map<string, ConstellationSegment[]>;
  }
  const surfaceWork: SurfaceWork[] = [];

  for (const surface of enabled) {
    const grid = computeTileGrid(surface, job.outputOptions.paper);
    const holes: Hole[] = [];

    for (const body of projBodies) {
      const cls = classifyMagnitude(body.mag);
      if (cls === null) continue;

      // Try the natural body direction.
      if (surface.projectionMode === "aboveHorizon" || surface.projectionMode === "continuous") {
        const v = bodyToWorldVec(body.altDeg, body.azDeg);
        const hit = projectBodyOntoSurface(v, surface, observerPos);
        if (hit) {
          holes.push({
            surfaceUMm: hit.uMm,
            surfaceVMm: hit.vMm,
            sizeClass: cls,
            label: body.label,
            bodyKind: body.bodyKind,
            apparentMag: body.mag,
          });
        }
      }
      // Try the antipodal twin (alt → −alt).
      if (surface.projectionMode === "antipodal" || surface.projectionMode === "continuous") {
        const ap = antipodalize(body.altDeg, body.azDeg);
        const v = bodyToWorldVec(ap.altDeg, ap.azDeg);
        const hit = projectBodyOntoSurface(v, surface, observerPos);
        if (hit) {
          holes.push({
            surfaceUMm: hit.uMm,
            surfaceVMm: hit.vMm,
            sizeClass: cls,
            label: body.label,
            bodyKind: body.bodyKind,
            apparentMag: body.mag,
          });
        }
      }
    }

    // FR-013: omit holes whose centres fall inside a no-paint feature on
    // this surface. We treat the feature outline as the spatial test.
    const noPaintFeatures = job.room.features.filter(
      (f) => f.surfaceId === surface.id && f.paint === false,
    );
    const keptHoles =
      noPaintFeatures.length === 0
        ? holes
        : holes.filter((h) => {
            for (const f of noPaintFeatures) {
              if (pointInPolygon(h.surfaceUMm, h.surfaceVMm, f.outline)) return false;
            }
            return true;
          });

    const holesByTile = assignHolesToTiles(keptHoles, surface, grid);
    const featuresByTile = clipFeaturesToTiles(job.room.features, surface, grid);

    // ---- Constellation segments (R8 / T049) -----------------------------
    // For US2 we render lines whose BOTH endpoints land on the SAME
    // surface (cross-surface seam splitting is deferred to Polish).
    const segmentsByTile = new Map<string, ConstellationSegment[]>();
    if (
      job.outputOptions.includeConstellationLines &&
      datasets.constellations.length > 0
    ) {
      const projectStarOntoSurface = (
        hr: number,
      ): { uMm: number; vMm: number } | null => {
        const ap = starApparent.get(hr);
        if (!ap) return null;
        if (
          surface.projectionMode === "aboveHorizon" ||
          surface.projectionMode === "continuous"
        ) {
          const v = bodyToWorldVec(ap.altDeg, ap.azDeg);
          const hit = projectBodyOntoSurface(v, surface, observerPos);
          if (hit) return hit;
        }
        if (
          surface.projectionMode === "antipodal" ||
          surface.projectionMode === "continuous"
        ) {
          const apTwin = antipodalize(ap.altDeg, ap.azDeg);
          const v = bodyToWorldVec(apTwin.altDeg, apTwin.azDeg);
          const hit = projectBodyOntoSurface(v, surface, observerPos);
          if (hit) return hit;
        }
        return null;
      };

      for (const cons of datasets.constellations) {
        for (const pair of cons.lines) {
          const a = projectStarOntoSurface(pair[0]);
          const b = projectStarOntoSurface(pair[1]);
          if (!a || !b) continue;
          binSegmentToTiles(a, b, grid, segmentsByTile);
        }
      }
    }

    surfaceWork.push({
      surface,
      grid,
      holes: keptHoles,
      holesByTile,
      featuresByTile,
      segmentsByTile,
    });
  }

  // ---- 6. Build canonical-order Tile[] ------------------------------------
  // Order: ceiling first, then walls in their natural index order
  // (wall-0, wall-1, ...), then floor last.
  const ordered = sortSurfacesForCanonicalOrder(surfaceWork);

  const tiles: Tile[] = [];
  let pageNumber = 2; // page 1 is the cover

  for (const work of ordered) {
    const { surface, grid, holesByTile, featuresByTile, segmentsByTile } = work;
    const { rows, cols, cellWidthMm, cellHeightMm } = grid;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const key = tileKey(r, c);
        const holes = holesByTile.get(key) ?? [];
        const featureCutouts = featuresByTile.get(key) ?? [];
        const constellationSegments = segmentsByTile.get(key) ?? [];
        const tile: Tile = {
          surfaceId: surface.id,
          row: r,
          col: c,
          pageNumber,
          tileBoundsMm: {
            uMinMm: c * cellWidthMm,
            vMinMm: r * cellHeightMm,
            uMaxMm: (c + 1) * cellWidthMm,
            vMaxMm: (r + 1) * cellHeightMm,
          },
          holes,
          featureCutouts,
          constellationSegments,
        };
        tiles.push(tile);
        pageNumber += 1;
      }
    }
  }

  // ---- 7. Preflight summary -----------------------------------------------
  // Convert ProjBody back into PreflightBody for the summary helper.
  const preflightBodies: PreflightBody[] = bodies.map((b) => ({
    altDeg: b.altDeg,
    azDeg: b.azDeg,
    apparentMag: b.apparentMag,
    bodyKind: b.bodyKind,
    label: b.label,
  }));
  const summary = computePreflightSummary(job, datasets, preflightBodies);

  // ---- 8. Build PDF -------------------------------------------------------
  const { widthMm, heightMm } = paperToMm(job.outputOptions.paper);
  const orientation: "portrait" | "landscape" = widthMm > heightMm ? "landscape" : "portrait";
  // jsPDF expects [shortSide, longSide]-ish; passing the actual dimensions
  // as a pair is robust for both presets and custom sizes.
  const format: number[] =
    orientation === "portrait" ? [widthMm, heightMm] : [heightMm, widthMm];

  const doc = new jsPDF({
    unit: "mm",
    orientation,
    format,
    compress: true,
  });

  emitCoverPage(doc, job, summary);

  for (const tile of tiles) {
    doc.addPage(format, orientation);
    const work = ordered.find((w) => w.surface.id === tile.surfaceId);
    if (!work) continue;
    emitTilePage(doc, tile, work.surface, job);
  }

  // ---- 9. Build PdfBlob ---------------------------------------------------
  // We capture the raw ArrayBuffer first; tests can read it directly via
  // the `_arrayBuffer` test-only field. The Blob is then constructed from
  // the same bytes so production code paths get a real Blob.
  const arrayBuffer = doc.output("arraybuffer");
  const blob = doc.output("blob");
  // `URL.createObjectURL` is browser-only. In jsdom (test env) it exists.
  // In node (no DOM at all) we fall back to an empty string — tests that
  // need objectUrl run in jsdom.
  let objectUrl = "";
  try {
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      objectUrl = URL.createObjectURL(blob);
    }
  } catch {
    objectUrl = "";
  }

  const pageCount = 1 + tiles.length;

  const result: PdfBlobWithTiles = {
    blob,
    objectUrl,
    pageCount,
    summary,
    _tiles: tiles,
    _arrayBuffer: arrayBuffer,
  };
  return Promise.resolve(result);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Canonical print order: ceiling first, walls in their floor-plan order
 * (wall-0, wall-1, …) — `deriveSurfaces` already returns walls in
 * vertex-index order — and the floor last.
 */
function sortSurfacesForCanonicalOrder<T extends { surface: Surface }>(
  surfaceWork: T[],
): T[] {
  function rankOf(s: Surface): number {
    if (s.kind === "ceiling") return 0;
    if (s.kind === "wall") {
      // Wall id is "wall-N" — extract N for stable ordering.
      const n = parseInt(s.id.replace(/^wall-/, ""), 10);
      return 1 + (Number.isFinite(n) ? n : 0);
    }
    if (s.kind === "floor") return 1_000_000;
    return 999;
  }
  return [...surfaceWork].sort((a, b) => rankOf(a.surface) - rankOf(b.surface));
}

/**
 * Even-odd point-in-polygon test for the polygon (uMm, vMm) ring. Used
 * to exclude holes whose centres fall inside a no-paint feature
 * (FR-013 / SC-005).
 */
function pointInPolygon(
  u: number,
  v: number,
  poly: ReadonlyArray<{ uMm: number; vMm: number }>,
): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    const intersects =
      a.vMm > v !== b.vMm > v &&
      u < ((b.uMm - a.uMm) * (v - a.vMm)) / (b.vMm - a.vMm + 1e-15) + a.uMm;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Liang-Barsky 2D line clipping against an axis-aligned rectangle.
 * Returns the clipped (a', b') segment, or null if the line lies
 * entirely outside the rect.
 */
function clipSegmentToRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  uMin: number,
  vMin: number,
  uMax: number,
  vMax: number,
): { ax: number; ay: number; bx: number; by: number } | null {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - uMin, uMax - ax, ay - vMin, vMax - ay];
  for (let i = 0; i < 4; i++) {
    const pi = p[i];
    const qi = q[i];
    if (pi === undefined || qi === undefined) return null;
    if (pi === 0) {
      if (qi < 0) return null;
      continue;
    }
    const t = qi / pi;
    if (pi < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return {
    ax: ax + t0 * dx,
    ay: ay + t0 * dy,
    bx: ax + t1 * dx,
    by: ay + t1 * dy,
  };
}

/**
 * Bin a single 2D constellation segment into the (row, col) tiles it
 * crosses, clipping the visible portion to each tile's printable
 * rectangle. Tiles outside the surface bounds are skipped.
 */
function binSegmentToTiles(
  a: { uMm: number; vMm: number },
  b: { uMm: number; vMm: number },
  grid: TileGrid,
  segmentsByTile: Map<string, ConstellationSegment[]>,
): void {
  const { rows, cols, cellWidthMm, cellHeightMm } = grid;
  const uMin = Math.min(a.uMm, b.uMm);
  const uMax = Math.max(a.uMm, b.uMm);
  const vMin = Math.min(a.vMm, b.vMm);
  const vMax = Math.max(a.vMm, b.vMm);
  const cMin = Math.max(0, Math.floor(uMin / cellWidthMm));
  const cMax = Math.min(cols - 1, Math.floor(uMax / cellWidthMm));
  const rMin = Math.max(0, Math.floor(vMin / cellHeightMm));
  const rMax = Math.min(rows - 1, Math.floor(vMax / cellHeightMm));
  for (let r = rMin; r <= rMax; r++) {
    for (let c = cMin; c <= cMax; c++) {
      const u0 = c * cellWidthMm;
      const u1 = (c + 1) * cellWidthMm;
      const v0 = r * cellHeightMm;
      const v1 = (r + 1) * cellHeightMm;
      const clipped = clipSegmentToRect(a.uMm, a.vMm, b.uMm, b.vMm, u0, v0, u1, v1);
      if (!clipped) continue;
      const dx = clipped.bx - clipped.ax;
      const dy = clipped.by - clipped.ay;
      if (dx * dx + dy * dy < 0.01) continue;
      const key = tileKey(r, c);
      let list = segmentsByTile.get(key);
      if (!list) {
        list = [];
        segmentsByTile.set(key, list);
      }
      list.push({
        aMm: { uMm: clipped.ax, vMm: clipped.ay },
        bMm: { uMm: clipped.bx, vMm: clipped.by },
      });
    }
  }
}
