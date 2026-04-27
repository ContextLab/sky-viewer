// T015 — Pre-flight summary computation.
//
// Pure function: takes a PrintJob + the immutable star/constellation
// catalogues and returns a `PreflightSummary` describing what the PDF
// will contain. SC-008 requires this to match the eventual `buildPdf`
// output exactly, so the same projection/tile-grid pipeline is reused.
//
// Bodies considered:
//   - All stars in `datasets.stars` brighter than the magnitude cutoff
//     (MAGNITUDE_BOUNDS.pin, currently 6).
//   - The Sun, Moon, and 7 classical planets are passed in via the
//     `bodies` parameter (computed by the caller from the parent
//     feature's astronomy modules); for tests the array can be empty
//     and we still return correct counts for the star portion.
//
// Hole-class counts are the union across all enabled surfaces; a
// single bright star above the horizon produces one hole on the
// ceiling, AND (when the floor is enabled) one antipodal hole on the
// floor — both contribute. This matches the pdf-builder's behaviour
// (US2 / T047) and makes the totals additive.

import { equatorialToHorizontal, precessStarToEpoch } from "../astro/transforms";
import type { SkyDatasets } from "../render/types";
import {
  antipodalize,
  bodyToWorldVec,
  deriveSurfaces,
  projectBodyOntoSurface,
} from "./projection";
import { computeTileGrid } from "./tile-grid";
import {
  classifyMagnitude,
  type Hole,
  type PreflightSummary,
  type PrintJob,
  type SizeClass,
  type Surface,
} from "./types";

/** External body record (Sun, Moon, planets). Mirrors `RenderBody`. */
export interface PreflightBody {
  altDeg: number;
  azDeg: number;
  apparentMag: number;
  bodyKind: "sun" | "moon" | "planet";
  label: string;
}

/**
 * Project all bodies (stars + Sun/Moon/planets) onto every enabled
 * surface; tally tile pages, holes by class, and paint area.
 *
 * `bodies` defaults to an empty array — tests can synthesise their own
 * inputs without depending on the live ephemeris.
 */
export function computePreflightSummary(
  job: PrintJob,
  datasets: SkyDatasets,
  bodies: ReadonlyArray<PreflightBody> = [],
): PreflightSummary {
  const surfaces = deriveSurfaces(job.room).filter((s) => s.enabled);
  const observerPosMm = {
    x: job.room.observerPositionMm.xMm,
    y: job.room.observerPositionMm.yMm,
    z: job.room.observerPositionMm.eyeHeightMm,
  };

  // Resolve observer location for star alt/az.
  const obs = job.observation;
  const utcMs = Date.parse(obs.utcInstant);
  const latRad = (obs.location.lat * Math.PI) / 180;
  const lonRad = (obs.location.lon * Math.PI) / 180;
  const utcSafe = Number.isFinite(utcMs) ? utcMs : 0;

  // Pre-compute (altDeg, azDeg) for every star whose magnitude is in range.
  // We do this once (per job) and reuse across all surfaces; the dominant
  // cost is the per-star astronomy reduction, not the per-surface ray-cast.
  interface ProjectableBody {
    altDeg: number;
    azDeg: number;
    mag: number;
    bodyKind: Hole["bodyKind"];
    label: string;
  }
  const projectable: ProjectableBody[] = [];

  for (const star of datasets.stars) {
    const sizeClass = classifyMagnitude(star.vmag);
    if (sizeClass === null) continue;
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
    projectable.push({
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
    projectable.push({
      altDeg: b.altDeg,
      azDeg: b.azDeg,
      mag: b.apparentMag,
      bodyKind,
      label: b.label,
    });
  }

  // Tile-page counter: every enabled surface contributes rows × cols
  // pages, even blank ones (FR-014, SC-013).
  let tilePageCount = 0;
  // Per-class hole tallies across all enabled surfaces.
  const counts: Record<SizeClass, number> = { pencil: 0, largeNail: 0, smallNail: 0, pin: 0 };
  let totalHoles = 0;

  for (const surface of surfaces) {
    const grid = computeTileGrid(surface, job.outputOptions.paper);
    tilePageCount += grid.rows * grid.cols;
    for (const body of projectable) {
      const hits = projectBodyForSurface(body.altDeg, body.azDeg, surface, observerPosMm);
      for (const _hit of hits) {
        const cls = classifyMagnitude(body.mag);
        if (cls === null) continue;
        counts[cls] += 1;
        totalHoles += 1;
      }
    }
  }

  const surfaceCount = surfaces.length;
  const coverPageCount = 1 as const;
  const totalPageCount = tilePageCount + coverPageCount;
  const paperSheetCount = totalPageCount;

  const estimatedPaintAreaSqMm = computePaintArea(job, surfaces);

  return {
    surfaceCount,
    tilePageCount,
    coverPageCount,
    totalPageCount,
    totalHoles,
    holeCountsByClass: counts,
    paperSheetCount,
    estimatedPaintAreaSqMm,
  };
}

/**
 * Run the body through the surface's projection mode AND its
 * antipodal twin (when applicable) so a single sky position can
 * contribute both an above-horizon and an antipodal hit. Returns a
 * (possibly empty) list of surface-local hits.
 *
 * In `'aboveHorizon'` mode: only the natural (alt, az) is tried.
 * In `'antipodal'`     mode: only the antipodalized (alt, az) is tried.
 * In `'continuous'`   mode: both passes are tried.
 */
function projectBodyForSurface(
  altDeg: number,
  azDeg: number,
  surface: Surface,
  observerPos: { x: number; y: number; z: number },
): Array<{ uMm: number; vMm: number }> {
  const out: Array<{ uMm: number; vMm: number }> = [];
  if (surface.projectionMode === "aboveHorizon") {
    const v = bodyToWorldVec(altDeg, azDeg);
    const hit = projectBodyOntoSurface(v, surface, observerPos);
    if (hit) out.push(hit);
  } else if (surface.projectionMode === "antipodal") {
    const ap = antipodalize(altDeg, azDeg);
    const v = bodyToWorldVec(ap.altDeg, ap.azDeg);
    const hit = projectBodyOntoSurface(v, surface, observerPos);
    if (hit) out.push(hit);
  } else {
    // 'continuous': both above and below horizon contribute.
    const v1 = bodyToWorldVec(altDeg, azDeg);
    const h1 = projectBodyOntoSurface(v1, surface, observerPos);
    if (h1) out.push(h1);
    const ap = antipodalize(altDeg, azDeg);
    const v2 = bodyToWorldVec(ap.altDeg, ap.azDeg);
    const h2 = projectBodyOntoSurface(v2, surface, observerPos);
    if (h2) out.push(h2);
  }
  return out;
}

/**
 * Sum of `widthMm × heightMm` across enabled surfaces, minus the area
 * of all NO-PAINT features placed on those surfaces. Approximate (uses
 * the surface bounding rectangle, not the floor polygon — matches
 * `Surface.widthMm/heightMm` definition in deriveSurfaces).
 */
function computePaintArea(job: PrintJob, surfaces: ReadonlyArray<Surface>): number {
  let totalArea = 0;
  for (const s of surfaces) {
    totalArea += s.widthMm * s.heightMm;
  }
  // Subtract no-paint feature areas (shoelace).
  for (const f of job.room.features) {
    if (f.paint) continue;
    const surface = surfaces.find((s) => s.id === f.surfaceId);
    if (!surface) continue;
    totalArea -= polygonArea(f.outline);
  }
  return Math.max(0, totalArea);
}

function polygonArea(pts: ReadonlyArray<{ uMm: number; vMm: number }>): number {
  if (pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (!a || !b) continue;
    s += a.uMm * b.vMm - b.uMm * a.vMm;
  }
  return Math.abs(s) / 2;
}
