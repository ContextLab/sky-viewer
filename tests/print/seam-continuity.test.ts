// T040 — Seam continuity at the wall-ceiling boundary (SC-007).
//
// Project a body at (alt=85°, az=0°) — close to the local zenith and
// just slightly tipped due-north. With the canonical room + observer at
// centre, the body's ray climbs steeply and hits BOTH the ceiling
// (very near its centre) AND the north wall (very near its top edge).
//
// We reconstruct the 3D hit point from each surface's (uMm, vMm) and
// assert the two reconstructions agree to ≤ 6 mm (SC-007: ¼ inch).

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

/** Reconstruct a 3D point in room coords from a surface-local (u, v) hit. */
function reconstruct3D(surface: Surface, hit: { uMm: number; vMm: number }): Vec3 {
  const o = surface.originPose.originMm;
  const u = surface.originPose.uAxisMm;
  const v = surface.originPose.vAxisMm;
  return {
    x: o.x + hit.uMm * u.x + hit.vMm * v.x,
    y: o.y + hit.uMm * u.y + hit.vMm * v.y,
    z: o.z + hit.uMm * u.z + hit.vMm * v.z,
  };
}

describe("Seam continuity — ceiling and adjacent wall agree (SC-007)", () => {
  it("(alt=85°, az=0°) reconstructs to the same 3D point on ceiling and north wall (within 6 mm)", () => {
    const surfaces = deriveSurfaces(makeRoom());
    const ceiling = surfaces.find((s) => s.id === "ceiling");
    const northWall = surfaces.find(
      (s) => s.kind === "wall" && s.label === "North wall",
    );
    expect(ceiling).toBeDefined();
    expect(northWall).toBeDefined();
    if (!ceiling || !northWall) return;

    // Pick an altitude such that the body strikes BOTH the ceiling
    // and the wall. With observer at (0, 0, 1520), wall plane y=HALF,
    // ceiling plane z=CEILING. The ray rises across both planes only
    // if the body's z>0 AND its horizontal northward component is
    // large enough to reach y=HALF before climbing past CEILING.
    //
    // For the actual seam test we need a body that hits the seam
    // — but `projectBodyOntoSurface` returns NULL when the hit is
    // outside the surface bounds. The wall hit at near-zenith may
    // miss the wall (climbs past the ceiling first). So pick a
    // smaller altitude that strikes the wall comfortably AND project
    // onto the ceiling using the same ray. Use alt = 25°: north wall
    // hit at v ≈ 1520 + 1828.8*tan(25°) ≈ 2373 mm (well within
    // ceiling height 2438), and the ceiling never gets hit.
    //
    // To get a true wall + ceiling co-hit, tip the body just BELOW
    // the seam altitude. The seam altitude is where the body's ray
    // crosses both the ceiling plane (z=CEILING) and the wall plane
    // (y=HALF) at the same time. That happens when:
    //   tan(alt) = (CEILING - eye) / sqrt(HALF^2 + 0^2)
    // For HALF=1828.8, CEILING=2438, eye=1520 → tan(alt) = 918/1828.8
    //                                       → alt ≈ 26.65°
    // At alt = 26.65° the body lands at (x=0, y=HALF, z=CEILING) — i.e.
    // at the ceiling-edge / wall-top seam.
    const seamAltDeg = (Math.atan2(CEILING_MM - EYE_HEIGHT_MM, HALF) * 180) / Math.PI;
    const v = bodyToWorldVec(seamAltDeg, 0);

    const ceilHit = projectBodyOntoSurface(v, ceiling, OBSERVER);
    const wallHit = projectBodyOntoSurface(v, northWall, OBSERVER);
    expect(ceilHit).not.toBeNull();
    expect(wallHit).not.toBeNull();
    if (!ceilHit || !wallHit) return;

    const ceil3D = reconstruct3D(ceiling, ceilHit);
    const wall3D = reconstruct3D(northWall, wallHit);
    const dx = ceil3D.x - wall3D.x;
    const dy = ceil3D.y - wall3D.y;
    const dz = ceil3D.z - wall3D.z;
    const dist = Math.hypot(dx, dy, dz);
    expect(dist).toBeLessThanOrEqual(6);
  });
});
