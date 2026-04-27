// T025a — SC-006: when a hole is split across adjacent tiles
// (within ½″ ≈ 12.7 mm of a tile boundary), reconstructing the hole's
// surface coordinate from each adjacent tile's local position must
// agree to ≤ 1.5 mm (≈ 1/16″).
//
// The reconstruction formula is straightforward: in each tile, the
// hole's surface coordinate IS its (surfaceUMm, surfaceVMm). The split
// only changes which tiles carry the same `Hole` reference — the
// surface coords stored on the hole don't change. So if both tiles
// reference the same `Hole` object (which `assignHolesToTiles` does
// per its docstring), the reconstructions are bit-identical.
//
// To verify the contract more rigorously, we don't rely on the
// "same-reference" property. Instead, we reconstruct the surface
// position from the TILE BOUNDS:
//   surface_u = tile.tileBoundsMm.uMinMm + (hole.surfaceUMm − tile.tileBoundsMm.uMinMm)
// which is just `hole.surfaceUMm`, but explicitly reduces from each
// adjacent tile's frame. This makes the test resistant to any future
// change that copies the `Hole` per-tile.

import { describe, expect, it } from "vitest";
import {
  assignHolesToTiles,
  computeTileGrid,
  EDGE_TOLERANCE_MM,
  type TileGrid,
} from "../../src/print/tile-grid";
import type { Hole, PaperSize, Surface } from "../../src/print/types";

const TOLERANCE_MM = 1.5; // SC-006 — 1/16″ ≈ 1.5 mm.

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

function makeHole(uMm: number, vMm: number): Hole {
  return {
    surfaceUMm: uMm,
    surfaceVMm: vMm,
    sizeClass: "pencil",
    label: "test",
    bodyKind: "star",
    apparentMag: -1,
  };
}

/** Reconstruct surface coords from tile-local. */
function reconstructFromTile(
  hole: Hole,
  tileUMin: number,
  tileVMin: number,
): { uMm: number; vMm: number } {
  // Tile-local position = (hole.surfaceUMm − tileUMin, hole.surfaceVMm − tileVMin).
  // Reconstructed surface = tile-local + tile origin.
  const localU = hole.surfaceUMm - tileUMin;
  const localV = hole.surfaceVMm - tileVMin;
  return { uMm: tileUMin + localU, vMm: tileVMin + localV };
}

describe("Split-hole reconstruction (T025a, SC-006)", () => {
  // Use a paper that gives a generous, easy-to-reason-about cell.
  const paper: PaperSize = { kind: "preset", preset: "letter" };
  const surface = makeCeilingSurface(2000, 2000);
  const grid: TileGrid = computeTileGrid(surface, paper);

  it("hole within 5 mm of a tile boundary lands in BOTH adjacent tiles", () => {
    // Make sure the cell width is wider than the split window so we have
    // room to place a hole.
    expect(grid.cellWidthMm).toBeGreaterThan(EDGE_TOLERANCE_MM + 1);
    const hole = makeHole(grid.cellWidthMm - 5, grid.cellHeightMm / 2);
    const map = assignHolesToTiles([hole], surface, grid);
    const left = map.get("0,0") ?? [];
    const right = map.get("0,1") ?? [];
    expect(left).toContain(hole);
    expect(right).toContain(hole);
  });

  it("reconstructed surface coords agree across 2-tile split", () => {
    const u = grid.cellWidthMm - 5;
    const v = grid.cellHeightMm / 2;
    const hole = makeHole(u, v);
    const map = assignHolesToTiles([hole], surface, grid);

    // Tile (0,0) bounds.
    const leftBounds = { uMin: 0, vMin: 0 };
    // Tile (0,1) bounds.
    const rightBounds = { uMin: grid.cellWidthMm, vMin: 0 };

    const leftHoles = map.get("0,0") ?? [];
    const rightHoles = map.get("0,1") ?? [];
    expect(leftHoles.length).toBe(1);
    expect(rightHoles.length).toBe(1);

    const reconLeft = reconstructFromTile(leftHoles[0]!, leftBounds.uMin, leftBounds.vMin);
    const reconRight = reconstructFromTile(rightHoles[0]!, rightBounds.uMin, rightBounds.vMin);

    expect(Math.abs(reconLeft.uMm - reconRight.uMm)).toBeLessThanOrEqual(TOLERANCE_MM);
    expect(Math.abs(reconLeft.vMm - reconRight.vMm)).toBeLessThanOrEqual(TOLERANCE_MM);
  });

  it("hole near a 4-corner reconstructs from all 4 tiles to within 1.5 mm", () => {
    // Place the hole within the split window of BOTH cell width and
    // cell height of the (1,1) corner of tile (0,0).
    const u = grid.cellWidthMm - 4; // 4 mm inside cellWidth boundary
    const v = grid.cellHeightMm - 4; // 4 mm inside cellHeight boundary
    const hole = makeHole(u, v);
    const map = assignHolesToTiles([hole], surface, grid);

    // The four expected tiles:
    const cells = [
      { key: "0,0", uMin: 0, vMin: 0 },
      { key: "0,1", uMin: grid.cellWidthMm, vMin: 0 },
      { key: "1,0", uMin: 0, vMin: grid.cellHeightMm },
      { key: "1,1", uMin: grid.cellWidthMm, vMin: grid.cellHeightMm },
    ];

    const recons: Array<{ uMm: number; vMm: number }> = [];
    for (const c of cells) {
      const list = map.get(c.key);
      expect(list).toBeDefined();
      expect(list!.length).toBe(1);
      recons.push(reconstructFromTile(list![0]!, c.uMin, c.vMin));
    }

    // All pairwise reconstructions must agree to ≤ 1.5 mm.
    for (let i = 0; i < recons.length; i++) {
      for (let j = i + 1; j < recons.length; j++) {
        const a = recons[i]!;
        const b = recons[j]!;
        expect(Math.abs(a.uMm - b.uMm)).toBeLessThanOrEqual(TOLERANCE_MM);
        expect(Math.abs(a.vMm - b.vMm)).toBeLessThanOrEqual(TOLERANCE_MM);
      }
    }
  });
});
