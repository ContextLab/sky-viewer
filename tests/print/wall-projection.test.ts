// T039 — Wall-projection geometry.
//
// For a wall facing north, project a body at (alt = 10°, az = 0°) — i.e.
// 10° above the horizon, due north. With the canonical 12 × 12 ft room
// and the observer at the centre, the north wall is 6 ft (1828.8 mm)
// in front of the observer; the body's ray hits the wall at:
//
//   horizontal distance = 1828.8 mm (room half-width)
//   vertical rise       = 1828.8 * tan(10°) ≈ 322.5 mm above eye-height
//   v on wall (from floor) = 1520 + 322.5 ≈ 1842.5 mm
//   u on wall = wall midpoint = 1828.8 mm (wall length / 2 for 12 ft)
//
// We then test the same body at (alt = -10°, az = 0°) under
// 'continuous' projection mode and assert the hit lands BELOW the
// horizon line (vMm < eyeHeightMm).

import { describe, expect, it } from "vitest";
import {
  bodyToWorldVec,
  deriveSurfaces,
  projectBodyOntoSurface,
} from "../../src/print/projection";
import type { Room, Surface, Vec3 } from "../../src/print/types";

const HALF = 1828.8;
const CEILING_MM = 2438;
const EYE_HEIGHT_MM = 1520;

function makeRoom(): Room {
  return {
    vertices: [
      { xMm: -HALF, yMm: -HALF },
      { xMm: HALF, yMm: -HALF },
      { xMm: HALF, yMm: HALF },
      { xMm: -HALF, yMm: HALF },
    ],
    ceilingHeightMm: CEILING_MM,
    observerPositionMm: { xMm: 0, yMm: 0, eyeHeightMm: EYE_HEIGHT_MM },
    features: [],
    surfaceEnable: {
      ceiling: true,
      floor: false,
      walls: { "wall-0": true, "wall-1": true, "wall-2": true, "wall-3": true },
    },
  };
}

const OBSERVER: Vec3 = { x: 0, y: 0, z: EYE_HEIGHT_MM };

function findNorthWall(surfaces: Surface[]): Surface {
  // The "North wall" is the one whose outward normal points +y. With
  // CCW vertex order [SW, SE, NE, NW], the segment from NE→NW (wall-2)
  // has outward normal +y. labelFromOutwardNormal gives "North wall".
  const found = surfaces.find((s) => s.kind === "wall" && s.label === "North wall");
  if (!found) throw new Error("test fixture: no North wall");
  return found;
}

describe("Wall projection — above-horizon body lands at expected u/v", () => {
  it("body at (alt=10°, az=0°) hits the north wall above eye-height", () => {
    // blockHorizonOnWalls=true → walls are 'aboveHorizon'.
    const surfaces = deriveSurfaces(makeRoom(), true);
    const northWall = findNorthWall(surfaces);
    expect(northWall.projectionMode).toBe("aboveHorizon");

    const v = bodyToWorldVec(10, 0);
    const hit = projectBodyOntoSurface(v, northWall, OBSERVER);
    expect(hit).not.toBeNull();
    if (!hit) return;

    // wall midpoint (u = wallLength/2 = HALF; for our 12 ft room walls
    // are 12 ft long → wallLength/2 = HALF).
    expect(hit.uMm).toBeCloseTo(HALF, 0);

    // v above eye-height by 1828.8 * tan(10°) ≈ 322.5 mm.
    const expectedVMm = EYE_HEIGHT_MM + HALF * Math.tan((10 * Math.PI) / 180);
    expect(hit.vMm).toBeCloseTo(expectedVMm, 0);
    expect(hit.vMm).toBeGreaterThan(EYE_HEIGHT_MM);
  });

  it("body at (alt=-10°, az=0°) is rejected on aboveHorizon walls", () => {
    const surfaces = deriveSurfaces(makeRoom(), true);
    const northWall = findNorthWall(surfaces);
    const v = bodyToWorldVec(-10, 0);
    expect(projectBodyOntoSurface(v, northWall, OBSERVER)).toBeNull();
  });

  it("body at (alt=-10°, az=0°) on a continuous wall lands BELOW eye-height", () => {
    // blockHorizonOnWalls=false → walls are 'continuous'.
    const surfaces = deriveSurfaces(makeRoom(), false);
    const northWall = findNorthWall(surfaces);
    expect(northWall.projectionMode).toBe("continuous");

    const v = bodyToWorldVec(-10, 0);
    const hit = projectBodyOntoSurface(v, northWall, OBSERVER);
    expect(hit).not.toBeNull();
    if (!hit) return;
    expect(hit.uMm).toBeCloseTo(HALF, 0);
    // v below eye-height by 1828.8 * tan(10°).
    const expectedVMm = EYE_HEIGHT_MM - HALF * Math.tan((10 * Math.PI) / 180);
    expect(hit.vMm).toBeCloseTo(expectedVMm, 0);
    expect(hit.vMm).toBeLessThan(EYE_HEIGHT_MM);
  });
});
