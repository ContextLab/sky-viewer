// T017 — Unit tests for src/print/tile-grid.ts.
//
// Coverage:
//   - computeTileGrid for a 3 × 3 m ceiling on Letter and on a custom
//     paper size.
//   - assignHolesToTiles: hole well within a tile lands in only one
//     tile; hole near a boundary lands in two adjacent tiles.
//   - clipFeaturesToTiles: a feature spanning 2 tiles produces 2
//     cutouts.

import { describe, expect, it } from "vitest";
import {
  assignHolesToTiles,
  clipFeaturesToTiles,
  computeTileGrid,
  paperToMm,
  tileKey,
} from "../../src/print/tile-grid";
import type { Hole, PaperSize, RoomFeature, Surface } from "../../src/print/types";

function makeCeilingSurface(widthMm: number, heightMm: number): Surface {
  return {
    id: "ceiling",
    kind: "ceiling",
    label: "Ceiling",
    widthMm,
    heightMm,
    originPose: {
      originMm: { x: 0, y: 0, z: 2438 },
      uAxisMm: { x: 1, y: 0, z: 0 },
      vAxisMm: { x: 0, y: 1, z: 0 },
    },
    enabled: true,
    projectionMode: "aboveHorizon",
  };
}

describe("computeTileGrid — Letter", () => {
  const surface = makeCeilingSurface(3000, 3000);
  const paper: PaperSize = { kind: "preset", preset: "letter" };
  const grid = computeTileGrid(surface, paper);

  it("uses paper minus 12 mm margin per side", () => {
    const { widthMm, heightMm } = paperToMm(paper);
    expect(grid.cellWidthMm).toBeCloseTo(widthMm - 24, 6); // 215.9 − 24 = 191.9
    expect(grid.cellHeightMm).toBeCloseTo(heightMm - 24, 6); // 279.4 − 24 = 255.4
  });

  it("computes rows/cols by ceil(surfaceDim / cellDim)", () => {
    expect(grid.cols).toBe(Math.ceil(3000 / grid.cellWidthMm));
    expect(grid.rows).toBe(Math.ceil(3000 / grid.cellHeightMm));
    // Sanity: for Letter and a 3×3 m ceiling, cols = 16, rows = 12.
    expect(grid.cols).toBe(16);
    expect(grid.rows).toBe(12);
  });
});

describe("computeTileGrid — custom 300×400 mm", () => {
  const surface = makeCeilingSurface(1000, 1000);
  const paper: PaperSize = { kind: "custom", widthMm: 300, heightMm: 400 };
  const grid = computeTileGrid(surface, paper);

  it("subtracts 12 mm margins per side", () => {
    expect(grid.cellWidthMm).toBe(276);
    expect(grid.cellHeightMm).toBe(376);
  });
});

describe("assignHolesToTiles", () => {
  const surface = makeCeilingSurface(800, 800);
  const paper: PaperSize = { kind: "custom", widthMm: 224, heightMm: 224 };
  // cell = 200×200 mm, 4×4 grid.
  const grid = computeTileGrid(surface, paper);

  function makeHole(uMm: number, vMm: number, label = "test"): Hole {
    return {
      surfaceUMm: uMm,
      surfaceVMm: vMm,
      sizeClass: "smallNail",
      label,
      bodyKind: "star",
      apparentMag: 2,
    };
  }

  it("assigns a centred hole to a single tile", () => {
    const h = makeHole(100, 100); // dead-centre of tile (0,0)
    const result = assignHolesToTiles([h], surface, grid);
    expect(result.size).toBe(1);
    const list = result.get(tileKey(0, 0));
    expect(list).toBeDefined();
    expect(list?.length).toBe(1);
  });

  it("assigns a hole near a vertical boundary to BOTH adjacent tiles", () => {
    const h = makeHole(195, 100); // 5 mm from u=200 boundary (well within 12.7 mm)
    const result = assignHolesToTiles([h], surface, grid);
    expect(result.has(tileKey(0, 0))).toBe(true);
    expect(result.has(tileKey(0, 1))).toBe(true);
  });

  it("assigns a hole within tolerance of a corner to all 4 adjacent tiles", () => {
    const h = makeHole(195, 195); // 5 mm from both boundaries
    const result = assignHolesToTiles([h], surface, grid);
    expect(result.has(tileKey(0, 0))).toBe(true);
    expect(result.has(tileKey(0, 1))).toBe(true);
    expect(result.has(tileKey(1, 0))).toBe(true);
    expect(result.has(tileKey(1, 1))).toBe(true);
  });

  it("ignores holes outside the surface bounds", () => {
    const h = makeHole(-10, 100);
    const result = assignHolesToTiles([h], surface, grid);
    expect(result.size).toBe(0);
  });
});

describe("clipFeaturesToTiles", () => {
  const surface = makeCeilingSurface(800, 800);
  // Custom paper that yields exact 200×200 mm cells (224 − 24 = 200).
  const paper: PaperSize = { kind: "custom", widthMm: 224, heightMm: 224 };
  const grid = computeTileGrid(surface, paper);

  it("splits a feature spanning 2 cols × 1 row into 2 cutouts", () => {
    // Rectangle from (150, 50) to (350, 150): straddles the u=200 boundary.
    const feature: RoomFeature = {
      id: "f1",
      type: "window",
      label: "Window",
      surfaceId: "ceiling",
      paint: false,
      outline: [
        { uMm: 150, vMm: 50 },
        { uMm: 350, vMm: 50 },
        { uMm: 350, vMm: 150 },
        { uMm: 150, vMm: 150 },
      ],
    };
    const result = clipFeaturesToTiles([feature], surface, grid);
    expect(result.has(tileKey(0, 0))).toBe(true);
    expect(result.has(tileKey(0, 1))).toBe(true);
    const left = result.get(tileKey(0, 0))!;
    const right = result.get(tileKey(0, 1))!;
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    expect(left.length).toBe(1);
    expect(right.length).toBe(1);
    // Left clipped polygon should fit in u ∈ [150, 200] and v ∈ [50, 150].
    for (const p of left[0]!.clippedOutline) {
      expect(p.uMm).toBeGreaterThanOrEqual(150 - 1e-9);
      expect(p.uMm).toBeLessThanOrEqual(200 + 1e-9);
    }
    // Right clipped polygon should fit in u ∈ [200, 350] and v ∈ [50, 150].
    for (const p of right[0]!.clippedOutline) {
      expect(p.uMm).toBeGreaterThanOrEqual(200 - 1e-9);
      expect(p.uMm).toBeLessThanOrEqual(350 + 1e-9);
    }
  });

  it("skips PAINT features (no cutout produced)", () => {
    const feature: RoomFeature = {
      id: "f1",
      type: "lightFixture",
      label: "Light",
      surfaceId: "ceiling",
      paint: true,
      outline: [
        { uMm: 50, vMm: 50 },
        { uMm: 150, vMm: 50 },
        { uMm: 150, vMm: 150 },
        { uMm: 50, vMm: 150 },
      ],
    };
    const result = clipFeaturesToTiles([feature], surface, grid);
    expect(result.size).toBe(0);
  });
});
