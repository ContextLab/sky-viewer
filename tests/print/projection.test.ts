// T016 — Unit tests for src/print/projection.ts.
//
// Coverage:
//   - bodyToWorldVec at zenith and at the due-east horizon.
//   - antipodalize is its own inverse.
//   - projectBodyOntoSurface for ceiling (zenith hit, horizon miss).
//   - projectBodyOntoSurface for an east-facing wall (horizon hit at
//     observer eye-height).
//   - projectionMode culls (`'aboveHorizon'`, `'antipodal'`,
//     `'continuous'`).

import { describe, expect, it } from "vitest";
import {
  antipodalize,
  bodyToWorldVec,
  deriveSurfaces,
  projectBodyOntoSurface,
} from "../../src/print/projection";
import type { Room, Surface, Vec3 } from "../../src/print/types";

const APPROX = 1e-9;

function approxEqual(a: number, b: number, tol = APPROX): boolean {
  return Math.abs(a - b) <= tol;
}

describe("bodyToWorldVec", () => {
  it("returns +z (up) at the zenith", () => {
    const v = bodyToWorldVec(90, 0);
    expect(approxEqual(v.x, 0, 1e-12)).toBe(true);
    expect(approxEqual(v.y, 0, 1e-12)).toBe(true);
    expect(approxEqual(v.z, 1, 1e-12)).toBe(true);
  });

  it("returns +x (east) at the due-east horizon", () => {
    const v = bodyToWorldVec(0, 90);
    expect(approxEqual(v.x, 1, 1e-12)).toBe(true);
    expect(approxEqual(v.y, 0, 1e-12)).toBe(true);
    expect(approxEqual(v.z, 0, 1e-12)).toBe(true);
  });

  it("returns +y (north) at the due-north horizon", () => {
    const v = bodyToWorldVec(0, 0);
    expect(approxEqual(v.x, 0, 1e-12)).toBe(true);
    expect(approxEqual(v.y, 1, 1e-12)).toBe(true);
    expect(approxEqual(v.z, 0, 1e-12)).toBe(true);
  });
});

describe("antipodalize", () => {
  it("is its own inverse for several inputs", () => {
    const cases = [
      { altDeg: 30, azDeg: 120 },
      { altDeg: -45, azDeg: 0 },
      { altDeg: 0, azDeg: 90 },
    ];
    for (const c of cases) {
      const once = antipodalize(c.altDeg, c.azDeg);
      const twice = antipodalize(once.altDeg, once.azDeg);
      expect(twice.altDeg).toBeCloseTo(c.altDeg, 12);
      expect(twice.azDeg).toBeCloseTo(c.azDeg, 12);
    }
  });

  it("flips altitude only (does not change azimuth)", () => {
    const r = antipodalize(40, 200);
    expect(r.altDeg).toBeCloseTo(-40, 12);
    expect(r.azDeg).toBeCloseTo(200, 12);
  });
});

// ---------------------------------------------------------------------------
// Helpers: build a 12×12 ft canonical room + observer at centre.
// ---------------------------------------------------------------------------

const HALF = 1828.8; // 6 ft in mm
const CEILING_MM = 2438; // 8 ft in mm
const EYE_HEIGHT_MM = 1520; // 5 ft in mm

function makeCanonicalRoom(opts: { floor?: boolean; walls?: boolean } = {}): Room {
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
      floor: opts.floor === true,
      walls: opts.walls
        ? { "wall-0": true, "wall-1": true, "wall-2": true, "wall-3": true }
        : {},
    },
  };
}

const OBSERVER_AT_CENTER: Vec3 = { x: 0, y: 0, z: EYE_HEIGHT_MM };

describe("deriveSurfaces", () => {
  it("emits ceiling, floor, and one wall per segment", () => {
    const surfaces = deriveSurfaces(makeCanonicalRoom());
    const ids = surfaces.map((s) => s.id);
    expect(ids).toContain("ceiling");
    expect(ids).toContain("floor");
    expect(ids).toContain("wall-0");
    expect(ids).toContain("wall-1");
    expect(ids).toContain("wall-2");
    expect(ids).toContain("wall-3");
  });

  it("ceiling spans the floor bbox at z = ceilingHeight", () => {
    const surfaces = deriveSurfaces(makeCanonicalRoom());
    const ceiling = surfaces.find((s) => s.id === "ceiling");
    expect(ceiling).toBeDefined();
    if (!ceiling) return;
    expect(ceiling.widthMm).toBeCloseTo(2 * HALF, 6);
    expect(ceiling.heightMm).toBeCloseTo(2 * HALF, 6);
    expect(ceiling.originPose.originMm.z).toBeCloseTo(CEILING_MM, 6);
    expect(ceiling.projectionMode).toBe("aboveHorizon");
  });

  it("floor spans the floor bbox at z = 0 with antipodal projection", () => {
    const surfaces = deriveSurfaces(makeCanonicalRoom({ floor: true }));
    const floor = surfaces.find((s) => s.id === "floor");
    expect(floor).toBeDefined();
    if (!floor) return;
    expect(floor.originPose.originMm.z).toBe(0);
    expect(floor.projectionMode).toBe("antipodal");
  });

  it("walls have height = ceilingHeight and unit u/v axes", () => {
    const surfaces = deriveSurfaces(makeCanonicalRoom({ walls: true }));
    const wall0 = surfaces.find((s) => s.id === "wall-0");
    expect(wall0).toBeDefined();
    if (!wall0) return;
    expect(wall0.heightMm).toBe(CEILING_MM);
    // Wall-0 connects vertex[0] (-HALF, -HALF) to vertex[1] (+HALF, -HALF)
    // so its u-axis points east (+x).
    expect(wall0.originPose.uAxisMm.x).toBeCloseTo(1, 6);
    expect(wall0.originPose.uAxisMm.y).toBeCloseTo(0, 6);
    // v-axis is straight up.
    expect(wall0.originPose.vAxisMm.z).toBeCloseTo(1, 6);
  });
});

describe("projectBodyOntoSurface — ceiling", () => {
  const surfaces = deriveSurfaces(makeCanonicalRoom());
  const ceiling = surfaces.find((s) => s.id === "ceiling")!;

  it("zenith body lands at the centre of the ceiling", () => {
    const v = bodyToWorldVec(90, 0);
    const hit = projectBodyOntoSurface(v, ceiling, OBSERVER_AT_CENTER);
    expect(hit).not.toBeNull();
    if (!hit) return;
    // Observer at (0,0); ceiling u-min/v-min are at -HALF, so the zenith
    // hits surface-local (HALF, HALF).
    expect(hit.uMm).toBeCloseTo(HALF, 6);
    expect(hit.vMm).toBeCloseTo(HALF, 6);
  });

  it("horizon-due-east body returns null (parallel ray)", () => {
    const v = bodyToWorldVec(0, 90);
    const hit = projectBodyOntoSurface(v, ceiling, OBSERVER_AT_CENTER);
    expect(hit).toBeNull();
  });

  it("below-horizon body returns null (aboveHorizon cull)", () => {
    const v = bodyToWorldVec(-30, 0);
    const hit = projectBodyOntoSurface(v, ceiling, OBSERVER_AT_CENTER);
    expect(hit).toBeNull();
  });
});

describe("projectBodyOntoSurface — east wall", () => {
  // Wall-1 connects vertex[1] (+HALF, -HALF) to vertex[2] (+HALF, +HALF) —
  // its outward normal points east, so it is the "East wall".
  const surfaces = deriveSurfaces(makeCanonicalRoom({ walls: true }));
  const eastWall = surfaces.find((s) => {
    if (s.kind !== "wall") return false;
    return s.label === "East wall";
  })!;

  it("projects a body just above the due-east horizon onto the wall near observer eye-height", () => {
    // Use altDeg = 0.01 (10 millidegrees above the horizon): the
    // 'aboveHorizon' projectionMode strictly requires bodyVec.z > 0,
    // and at this small angle the wall hit-point is still effectively
    // at the observer's eye-height (offset < 1 mm at 1.8 m range).
    expect(eastWall).toBeDefined();
    const v = bodyToWorldVec(0.01, 90);
    const hit = projectBodyOntoSurface(v, eastWall, OBSERVER_AT_CENTER);
    expect(hit).not.toBeNull();
    if (!hit) return;
    // Wall-1 origin is at (+HALF, -HALF, 0); u-axis runs north (+y);
    // the observer at (0,0,1520) looking due east hits the wall plane
    // at (+HALF, 0, ~1520) → surface-local u ≈ HALF, v ≈ 1520.
    expect(hit.uMm).toBeCloseTo(HALF, 1);
    expect(hit.vMm).toBeCloseTo(EYE_HEIGHT_MM, 0);
  });
});

describe("projectionMode culls", () => {
  // Build a synthetic ceiling-like surface with each projection mode for
  // direct cull testing. Ceiling pose (origin at -HALF,-HALF,CEILING; u=+x,v=+y).
  function makeSurface(mode: Surface["projectionMode"]): Surface {
    return {
      id: "test",
      kind: "ceiling",
      label: "Test",
      widthMm: 2 * HALF,
      heightMm: 2 * HALF,
      originPose: {
        originMm: { x: -HALF, y: -HALF, z: CEILING_MM },
        uAxisMm: { x: 1, y: 0, z: 0 },
        vAxisMm: { x: 0, y: 1, z: 0 },
      },
      enabled: true,
      projectionMode: mode,
    };
  }

  it("antipodal mode rejects positive-z bodies", () => {
    const surface = makeSurface("antipodal");
    const v = bodyToWorldVec(45, 0);
    const hit = projectBodyOntoSurface(v, surface, OBSERVER_AT_CENTER);
    expect(hit).toBeNull();
  });

  it("antipodal mode accepts negative-z bodies (when geometry allows)", () => {
    // Build a floor-like surface (origin at z=0, normal up) so a
    // negative-z ray actually hits it from observer at (0,0,1520).
    const floor: Surface = {
      id: "floor",
      kind: "floor",
      label: "Floor",
      widthMm: 2 * HALF,
      heightMm: 2 * HALF,
      originPose: {
        originMm: { x: -HALF, y: -HALF, z: 0 },
        uAxisMm: { x: 1, y: 0, z: 0 },
        vAxisMm: { x: 0, y: 1, z: 0 },
      },
      enabled: true,
      projectionMode: "antipodal",
    };
    const v = bodyToWorldVec(-45, 0);
    const hit = projectBodyOntoSurface(v, floor, OBSERVER_AT_CENTER);
    expect(hit).not.toBeNull();
  });

  it("continuous mode accepts both signs of z", () => {
    // Use a wall surface (vertical plane) so both upward and downward
    // rays can intersect it.
    const wall: Surface = {
      id: "wall",
      kind: "wall",
      label: "East wall",
      widthMm: 2 * HALF,
      heightMm: CEILING_MM,
      originPose: {
        originMm: { x: HALF, y: -HALF, z: 0 },
        uAxisMm: { x: 0, y: 1, z: 0 },
        vAxisMm: { x: 0, y: 0, z: 1 },
      },
      enabled: true,
      projectionMode: "continuous",
    };
    const above = bodyToWorldVec(20, 90);
    const below = bodyToWorldVec(-20, 90);
    expect(projectBodyOntoSurface(above, wall, OBSERVER_AT_CENTER)).not.toBeNull();
    expect(projectBodyOntoSurface(below, wall, OBSERVER_AT_CENTER)).not.toBeNull();
  });
});
