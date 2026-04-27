// T038 — Antipodal-projection accuracy (SC-012).
//
// For an observer at the canonical room centre, run a synthetic body at
// (alt = 20°, az = 270°) — i.e. due-west, well above the horizon.
// `antipodalize` flips that to (alt = -20°, az = 270°). When fed into
// `projectBodyOntoSurface` against an `'antipodal'`-mode floor surface,
// the resulting (uMm, vMm) MUST match a hand-rolled ray-cast that
// negates only the body's z-component.
//
// The two paths are mathematically equivalent (alt → -alt is exactly
// "negate z"). Verification asserts angular agreement to ≤ 0.1° per
// SC-012, which translates to ≤ 0.05° at the projection step (R2).

import { describe, expect, it } from "vitest";
import {
  antipodalize,
  bodyToWorldVec,
  deriveSurfaces,
  projectBodyOntoSurface,
} from "../../src/print/projection";
import type { Room, Vec3 } from "../../src/print/types";

const HALF = 1828.8; // 6 ft → mm
const CEILING_MM = 2438;
const EYE_HEIGHT_MM = 1520;

const ROOM: Room = {
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
    floor: true,
    walls: { "wall-0": true, "wall-1": true, "wall-2": true, "wall-3": true },
  },
};

const OBSERVER: Vec3 = { x: 0, y: 0, z: EYE_HEIGHT_MM };

describe("Antipodal projection — SC-012", () => {
  it("antipodalize(alt, az) = (-alt, az)", () => {
    const ap = antipodalize(20, 270);
    expect(ap.altDeg).toBeCloseTo(-20, 12);
    expect(ap.azDeg).toBeCloseTo(270, 12);
  });

  it("projecting an antipodalized body matches a manual z-negated ray-cast (≤ 0.1°)", () => {
    const surfaces = deriveSurfaces(ROOM);
    const floor = surfaces.find((s) => s.id === "floor");
    expect(floor).toBeDefined();
    if (!floor) return;
    expect(floor.projectionMode).toBe("antipodal");

    // Pick a steep altitude so the antipodal twin's ray hits the
    // floor INSIDE the room rectangle. At alt=70° due-north, the
    // antipodal twin (-70°, 0°) reaches z=0 at horizontal distance
    // 1520 / tan(70°) ≈ 553 mm — well inside the 12 ft (1828.8 mm
    // half) floor.
    const ALT = 70;
    const AZ = 0;

    // Native antipodal path: antipodalize, then bodyToWorldVec.
    const ap = antipodalize(ALT, AZ);
    const vNative = bodyToWorldVec(ap.altDeg, ap.azDeg);
    const hitNative = projectBodyOntoSurface(vNative, floor, OBSERVER);
    expect(hitNative).not.toBeNull();
    if (!hitNative) return;

    // Manual path: take bodyToWorldVec(ALT, AZ) and negate z.
    const vRaw = bodyToWorldVec(ALT, AZ);
    const vManual: Vec3 = { x: vRaw.x, y: vRaw.y, z: -vRaw.z };
    const hitManual = projectBodyOntoSurface(vManual, floor, OBSERVER);
    expect(hitManual).not.toBeNull();
    if (!hitManual) return;

    // Both should agree to within numerical noise. Convert position
    // disagreement (mm) into an angular disagreement (deg).
    const range = EYE_HEIGHT_MM / Math.tan((ALT * Math.PI) / 180);
    const dx = hitNative.uMm - hitManual.uMm;
    const dy = hitNative.vMm - hitManual.vMm;
    const distMm = Math.hypot(dx, dy);
    const angDeg = (Math.atan2(distMm, range) * 180) / Math.PI;
    expect(angDeg).toBeLessThanOrEqual(0.1);
  });

  it("antipodal mode rejects positive-z bodies (no projection on the floor)", () => {
    const surfaces = deriveSurfaces(ROOM);
    const floor = surfaces.find((s) => s.id === "floor")!;
    // Above-horizon body: should NOT project onto the floor.
    const v = bodyToWorldVec(30, 90);
    expect(projectBodyOntoSurface(v, floor, OBSERVER)).toBeNull();
  });

  it("a known antipodal body lands at a manually computable floor point", () => {
    // Hand calculation: alt=20° due west (az=270°). After alt-flip:
    // (-20°, 270°). bodyToWorldVec gives:
    //    x = cos(-20°) sin(270°) = -cos(20°) ≈ -0.9396926
    //    y = cos(-20°) cos(270°) = 0
    //    z = sin(-20°)            ≈ -0.3420201
    // Observer at (0, 0, 1520). Ray hits z=0 plane at:
    //    t = 1520 / 0.3420201 ≈ 4444.78 mm
    //    x_hit = 0 + (-0.9396926) * t ≈ -4176.49
    //    y_hit = 0
    // Floor surface origin at (-1828.8, -1828.8, 0) with u=+x, v=+y.
    // Surface-local: (uMm = -4176.49 - (-1828.8), vMm = 0 - (-1828.8))
    //              = (uMm ≈ -2347.69, vMm ≈ 1828.8).
    // This is OUTSIDE the floor's u range [0, 3657.6], so the floor
    // returns null. We instead pick a body close to the local zenith
    // antipodally so the hit lands inside the floor rectangle.
    const ap = antipodalize(80, 0); // antipodal of nearly-zenith
    const v = bodyToWorldVec(ap.altDeg, ap.azDeg);
    const surfaces = deriveSurfaces(ROOM);
    const floor = surfaces.find((s) => s.id === "floor")!;
    const hit = projectBodyOntoSurface(v, floor, OBSERVER);
    expect(hit).not.toBeNull();
    if (!hit) return;
    // alt=-80 due-north → x=0, y = cos(-80°)*cos(0°) = cos(80°) ≈ 0.1736.
    // z = sin(-80°) ≈ -0.9848. t = 1520 / 0.9848 ≈ 1543.5.
    // x_hit = 0; y_hit = 0.1736 * 1543.5 ≈ 268.0 → surface-local
    // u = 0 - (-1828.8) = 1828.8; v = 268.0 - (-1828.8) = 2096.8.
    expect(hit.uMm).toBeCloseTo(1828.8, 0);
    expect(hit.vMm).toBeCloseTo(2096.8, 0);
  });
});
