// T025 — Verify SC-005: when a no-paint feature is placed on a
// surface, NO hole's centre falls inside the feature's footprint.
//
// We construct a PrintJob from the canonical fixture, add a single
// no-paint "lightFixture" rectangle at the centre of the ceiling, and
// run a synthetic-stars dataset designed to produce many candidate
// holes (some of which would land inside the fixture without the
// FR-013 cull). Then we walk the emitted Tile[] and assert no hole's
// (surfaceUMm, surfaceVMm) is inside the fixture rectangle.
//
// We also confirm that at least one tile carries a `featureCutouts`
// entry referencing the fixture's `id` — i.e. the dotted-cut-line
// label IS rendered on overlapping tile pages.

import { describe, expect, it } from "vitest";
import canonical from "./fixtures/canonical-ceiling.json";
import { buildPdf } from "../../src/print/pdf-builder";
import { deriveSurfaces } from "../../src/print/projection";
import type { PrintJob, RoomFeature } from "../../src/print/types";
import type { Constellation } from "../../src/astro/constellations";
import type { Star } from "../../src/astro/stars";

const DEG2RAD = Math.PI / 180;

function makeFixtureRect(
  surfaceWidthMm: number,
  surfaceHeightMm: number,
  fixtureSizeMm: number,
): RoomFeature {
  // Place the fixture OFF-CENTRE so it covers stars near the local
  // zenith (which project to the ceiling centre for the canonical
  // observation) without consuming the entire ceiling. Centre-of-fixture
  // sits at (1/4 ceiling width, 1/4 ceiling height) — i.e. one quadrant.
  const cu = surfaceWidthMm * 0.25;
  const cv = surfaceHeightMm * 0.25;
  const half = fixtureSizeMm / 2;
  return {
    id: "fixture-1",
    type: "lightFixture",
    label: "Ceiling fan",
    surfaceId: "ceiling",
    paint: false,
    outline: [
      { uMm: cu - half, vMm: cv - half },
      { uMm: cu + half, vMm: cv - half },
      { uMm: cu + half, vMm: cv + half },
      { uMm: cu - half, vMm: cv + half },
    ],
  };
}

/** Even-odd point-in-rect test for the test (axis-aligned shortcut). */
function pointInRect(
  u: number,
  v: number,
  rect: ReadonlyArray<{ uMm: number; vMm: number }>,
): boolean {
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const p of rect) {
    if (p.uMm < uMin) uMin = p.uMm;
    if (p.uMm > uMax) uMax = p.uMm;
    if (p.vMm < vMin) vMin = p.vMm;
    if (p.vMm > vMax) vMax = p.vMm;
  }
  return u >= uMin && u <= uMax && v >= vMin && v <= vMax;
}

/** A handful of bright synthetic stars near the local zenith — likely
 *  to land both inside AND outside the (off-centre) fixture rectangle. */
function syntheticDatasets(): { stars: Star[]; constellations: Constellation[] } {
  const ra = 6.5 * 15 * DEG2RAD;
  const dec = 43.7 * DEG2RAD;
  // 25 stars in a 5x5 grid spread WIDELY in RA/Dec so they project
  // across the full ceiling, not just at the centre. With the canonical
  // 12 ft ceiling at 8 ft height + 5 ft eye height, the projection
  // distance is 3 ft, so a 0.15 rad offset projects ~14 cm — covers
  // most of the 3.7 m ceiling.
  const stars: Star[] = [];
  for (let i = 0; i < 25; i++) {
    const dx = ((i % 5) - 2) * 0.15;
    const dy = (Math.floor(i / 5) - 2) * 0.15;
    stars.push({
      id: 3000 + i,
      raJ2000Rad: ra + dx,
      decJ2000Rad: dec + dy,
      pmRaMasPerYr: 0,
      pmDecMasPerYr: 0,
      vmag: -1 + (i % 4),
      bvIndex: 0,
    });
  }
  return { stars, constellations: [] };
}

describe("Feature cutout (T025) — no-paint fixture excludes interior holes (SC-005)", () => {
  it("no hole's centre falls inside the no-paint fixture footprint", async () => {
    // Build a job with one no-paint fixture on the centre of the ceiling.
    const baseline = canonical as unknown as PrintJob;
    const surfaces = deriveSurfaces(baseline.room);
    const ceiling = surfaces.find((s) => s.id === "ceiling");
    expect(ceiling).toBeTruthy();
    const fixture = makeFixtureRect(ceiling!.widthMm, ceiling!.heightMm, 800);

    const job: PrintJob = {
      ...baseline,
      room: {
        ...baseline.room,
        features: [fixture],
      },
    };

    const pdf = await buildPdf(job, syntheticDatasets());
    expect(pdf._tiles).toBeDefined();

    // Walk every hole on every tile and confirm none of them sit inside
    // the fixture footprint.
    let holeCount = 0;
    for (const tile of pdf._tiles!) {
      if (tile.surfaceId !== "ceiling") continue;
      for (const h of tile.holes) {
        holeCount += 1;
        const inside = pointInRect(h.surfaceUMm, h.surfaceVMm, fixture.outline);
        expect(inside).toBe(false);
      }
    }
    // Sanity: with 25 synthetic stars + a small fixture, the surface
    // should still contain SOME holes — otherwise the assertion above
    // is vacuously satisfied.
    expect(holeCount).toBeGreaterThan(0);
  });

  it("at least one tile carries a feature cutout for the fixture", async () => {
    const baseline = canonical as unknown as PrintJob;
    const surfaces = deriveSurfaces(baseline.room);
    const ceiling = surfaces.find((s) => s.id === "ceiling")!;
    const fixture = makeFixtureRect(ceiling.widthMm, ceiling.heightMm, 800);
    const job: PrintJob = {
      ...baseline,
      room: { ...baseline.room, features: [fixture] },
    };

    const pdf = await buildPdf(job, syntheticDatasets());
    let cutoutCount = 0;
    for (const tile of pdf._tiles!) {
      for (const fc of tile.featureCutouts) {
        if (fc.featureId === fixture.id) cutoutCount += 1;
      }
    }
    expect(cutoutCount).toBeGreaterThan(0);
  });
});
