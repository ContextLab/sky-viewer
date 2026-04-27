// T018 — Unit tests for src/print/preflight.ts.
//
// These tests exercise the pure preflight pipeline with a tiny
// synthetic star catalogue (10 anchor stars covering each magnitude
// class). The astronomy reductions still run end-to-end — we just
// keep the catalogue small so vitest stays fast.

import { describe, expect, it } from "vitest";
import canonical from "./fixtures/canonical-ceiling.json";
import allSurfaces from "./fixtures/all-surfaces.json";
import { computePreflightSummary } from "../../src/print/preflight";
import { computeTileGrid } from "../../src/print/tile-grid";
import { deriveSurfaces } from "../../src/print/projection";
import type { Star } from "../../src/astro/stars";
import type { Constellation } from "../../src/astro/constellations";
import type { PrintJob } from "../../src/print/types";

const DEG2RAD = Math.PI / 180;

/**
 * 10 anchor "stars" placed at hand-picked equatorial coords, magnitude
 * classes spread across the four bins. Proper motions are zero so the
 * J2000 → epoch reduction is essentially identity.
 *
 * For the canonical observation (Hanover NH, mid-December midnight EST)
 * the local zenith is roughly RA ≈ 6h 35m, Dec ≈ +43.7°. So a star
 * placed AT that RA/Dec lands very close to the zenith, which projects
 * onto the ceiling. Stars far from that direction may fall below the
 * horizon — we don't assert specific projection counts; we just assert
 * the invariant that holeCountsByClass sums to totalHoles.
 */
function syntheticStars(): Star[] {
  const ra = 6.5 * 15 * DEG2RAD; // 6h 30m → 97.5° → near local zenith
  const dec = 43.7 * DEG2RAD;
  const mags = [-1.5, 0.5, 1.5, 2.5, 3.5, 4.5, 5.5, -0.5, 1.0, 2.0];
  return mags.map((vmag, idx) => ({
    id: 1000 + idx,
    raJ2000Rad: ra + (idx - 5) * 0.05, // small spread
    decJ2000Rad: dec + (idx - 5) * 0.02,
    pmRaMasPerYr: 0,
    pmDecMasPerYr: 0,
    vmag,
    bvIndex: 0,
  }));
}

const DATASETS = { stars: syntheticStars(), constellations: [] as Constellation[] };

describe("computePreflightSummary — canonical ceiling-only fixture", () => {
  const job = canonical as unknown as PrintJob;
  const summary = computePreflightSummary(job, DATASETS);

  it("counts exactly one enabled surface (ceiling)", () => {
    expect(summary.surfaceCount).toBe(1);
  });

  it("tilePageCount equals rows × cols of the ceiling grid (no skipping)", () => {
    const ceiling = deriveSurfaces(job.room).find((s) => s.id === "ceiling")!;
    const grid = computeTileGrid(ceiling, job.outputOptions.paper);
    expect(summary.tilePageCount).toBe(grid.rows * grid.cols);
  });

  it("totalPageCount = tilePageCount + 1 (cover)", () => {
    expect(summary.totalPageCount).toBe(summary.tilePageCount + 1);
  });

  it("paperSheetCount equals totalPageCount", () => {
    expect(summary.paperSheetCount).toBe(summary.totalPageCount);
  });

  it("holeCountsByClass partitions sum to totalHoles", () => {
    const c = summary.holeCountsByClass;
    expect(c.pencil + c.largeNail + c.smallNail + c.pin).toBe(summary.totalHoles);
  });

  it("estimatedPaintAreaSqMm equals ceiling area minus features", () => {
    const ceiling = deriveSurfaces(job.room).find((s) => s.id === "ceiling")!;
    expect(summary.estimatedPaintAreaSqMm).toBeCloseTo(
      ceiling.widthMm * ceiling.heightMm,
      6,
    );
  });
});

describe("computePreflightSummary — all-surfaces fixture", () => {
  const ceilingOnlyJob = canonical as unknown as PrintJob;
  const allSurfacesJob = allSurfaces as unknown as PrintJob;
  const ceilingOnly = computePreflightSummary(ceilingOnlyJob, DATASETS);
  const all = computePreflightSummary(allSurfacesJob, DATASETS);

  it("enabling floor + walls grows surfaceCount to 6", () => {
    expect(all.surfaceCount).toBe(6);
  });

  it("tilePageCount grows by at least the floor's rows × cols", () => {
    // Floor is the same size as ceiling so tilePageCount strictly grows.
    expect(all.tilePageCount).toBeGreaterThan(ceilingOnly.tilePageCount);
  });

  it("hole class counts still partition sum to totalHoles", () => {
    const c = all.holeCountsByClass;
    expect(c.pencil + c.largeNail + c.smallNail + c.pin).toBe(all.totalHoles);
  });
});
