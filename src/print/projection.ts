// T008–T011 — Pure projection geometry for Print Mode.
//
// All functions in this file are pure: no DOM, no globals, no
// side-effects. Tested directly with Vitest (jsdom or node).
//
// References:
//   - specs/002-stencil-template-pdf/research.md §R2 (projection),
//     §R12 (antipodal alt-flip).
//   - specs/002-stencil-template-pdf/data-model.md (Surface, Vec3).
//   - specs/002-stencil-template-pdf/contracts/print-api.md
//     (projection.ts contract).
//
// Coordinate conventions:
//   - Room-local 3D: x = East, y = North, z = Up (right-handed).
//   - Surface-local 2D: u along surface.uAxis, v along surface.vAxis.
//   - Body input: (altDeg, azDeg) where azimuth is measured from
//     North eastward (0°=N, 90°=E, 180°=S, 270°=W) — matches the
//     parent feature's `equatorialToHorizontal` convention.

import type { Room, Surface, Vec3 } from "./types";

const DEG2RAD = Math.PI / 180;

// ---------------------------------------------------------------------------
// Vector helpers (kept private — public API is the four exported funcs).
// ---------------------------------------------------------------------------

function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return v3(a.x - b.x, a.y - b.y, a.z - b.z);
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return v3(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  );
}

// ---------------------------------------------------------------------------
// T008 — bodyToWorldVec
// ---------------------------------------------------------------------------

/**
 * Convert a horizontal-frame `(altDeg, azDeg)` into a 3D unit vector
 * in room-local coords (E=+x, N=+y, U=+z). Pure spherical → cartesian.
 *
 *   x = cos(alt) · sin(az)     // east component
 *   y = cos(alt) · cos(az)     // north component
 *   z = sin(alt)               // up component
 */
export function bodyToWorldVec(altDeg: number, azDeg: number): Vec3 {
  const alt = altDeg * DEG2RAD;
  const az = azDeg * DEG2RAD;
  const cosAlt = Math.cos(alt);
  return {
    x: cosAlt * Math.sin(az),
    y: cosAlt * Math.cos(az),
    z: Math.sin(alt),
  };
}

// ---------------------------------------------------------------------------
// T009 — antipodalize
// ---------------------------------------------------------------------------

/**
 * R12: the antipodal sky has the SAME azimuth, OPPOSITE altitude. The
 * function is its own inverse (involutive).
 */
export function antipodalize(
  altDeg: number,
  azDeg: number,
): { altDeg: number; azDeg: number } {
  return { altDeg: -altDeg, azDeg };
}

// ---------------------------------------------------------------------------
// T010 — deriveSurfaces
// ---------------------------------------------------------------------------

/** 16-direction cardinal labels at 22.5° bins. Index 0 = N, 1 = NNE, … */
const CARDINAL_LABELS_16 = [
  "North",
  "North-northeast",
  "Northeast",
  "East-northeast",
  "East",
  "East-southeast",
  "Southeast",
  "South-southeast",
  "South",
  "South-southwest",
  "Southwest",
  "West-southwest",
  "West",
  "West-northwest",
  "Northwest",
  "North-northwest",
];

/** Bounding box of a 2D polygon in (xMm, yMm) — the floor polygon. */
function floorBoundingBox(
  vertices: ReadonlyArray<{ xMm: number; yMm: number }>,
): { xMin: number; xMax: number; yMin: number; yMax: number } {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const v of vertices) {
    if (v.xMm < xMin) xMin = v.xMm;
    if (v.xMm > xMax) xMax = v.xMm;
    if (v.yMm < yMin) yMin = v.yMm;
    if (v.yMm > yMax) yMax = v.yMm;
  }
  return { xMin, xMax, yMin, yMax };
}

/** Centroid of a 2D polygon (mean of vertices — adequate for label normal). */
function polygonCentroid(
  vertices: ReadonlyArray<{ xMm: number; yMm: number }>,
): { xMm: number; yMm: number } {
  if (vertices.length === 0) return { xMm: 0, yMm: 0 };
  let sx = 0;
  let sy = 0;
  for (const v of vertices) {
    sx += v.xMm;
    sy += v.yMm;
  }
  return { xMm: sx / vertices.length, yMm: sy / vertices.length };
}

/**
 * Map an outward-facing 2D normal (nx, ny) to a 16-point cardinal
 * label. Bins are 22.5° wide centred on each cardinal/intercardinal
 * direction. Returns labels like "North wall", "Northeast wall".
 */
function labelFromOutwardNormal(nx: number, ny: number): string {
  // Convert (nx, ny) to a compass bearing measured clockwise from N.
  // bearing = atan2(nx, ny). +x = E gives bearing = 90°.
  let bearingDeg = Math.atan2(nx, ny) * (180 / Math.PI);
  if (bearingDeg < 0) bearingDeg += 360;
  // Round to nearest 22.5° bin.
  const idx = Math.round(bearingDeg / 22.5) % 16;
  const cardinal = CARDINAL_LABELS_16[idx] ?? "North";
  return `${cardinal} wall`;
}

/** Length of a 2D segment. */
function segmentLength(
  a: { xMm: number; yMm: number },
  b: { xMm: number; yMm: number },
): number {
  const dx = b.xMm - a.xMm;
  const dy = b.yMm - a.yMm;
  return Math.hypot(dx, dy);
}

/**
 * Build all derived surfaces (ceiling, floor, one wall per floor
 * segment) from a Room. The order of the returned array is:
 *   [ceiling, floor, wall-0, wall-1, …, wall-(N-1)]
 *
 * `enabled` is read from `room.surfaceEnable`. `projectionMode`:
 *   - ceiling: 'aboveHorizon'
 *   - floor:   'antipodal'
 *   - walls:   'aboveHorizon' if `blockHorizonOnWalls === true` (the
 *              FR-008a default), else `'continuous'`.
 *
 * The `blockHorizonOnWalls` parameter is OPTIONAL and defaults to
 * `true` so legacy single-argument call sites continue to behave the
 * same as before US2. Production code paths (preflight, pdf-builder)
 * pass `outputOptions.blockHorizonOnWalls` explicitly.
 *
 * `widthMm` and `heightMm`:
 *   - ceiling/floor: bounding box of the floor polygon.
 *   - walls: segment length × ceiling height.
 *
 * `originPose`:
 *   - ceiling:  origin at (xMin, yMin, ceilingHeight); u=+x, v=+y.
 *   - floor:    origin at (xMin, yMin, 0);              u=+x, v=+y.
 *   - wall-N:   origin at (vertex[N].x, vertex[N].y, 0);
 *               u along segment unit-vector (vertex[N]→vertex[N+1]);
 *               v = (0, 0, 1) (up).
 */
export function deriveSurfaces(
  room: Room,
  blockHorizonOnWalls: boolean = true,
): Surface[] {
  const bbox = floorBoundingBox(room.vertices);
  const widthMm = bbox.xMax - bbox.xMin;
  const heightMm = bbox.yMax - bbox.yMin;

  const surfaces: Surface[] = [];

  // Ceiling.
  surfaces.push({
    id: "ceiling",
    kind: "ceiling",
    label: "Ceiling",
    widthMm,
    heightMm,
    originPose: {
      originMm: v3(bbox.xMin, bbox.yMin, room.ceilingHeightMm),
      uAxisMm: v3(1, 0, 0),
      vAxisMm: v3(0, 1, 0),
    },
    enabled: room.surfaceEnable.ceiling === true,
    projectionMode: "aboveHorizon",
  });

  // Floor.
  surfaces.push({
    id: "floor",
    kind: "floor",
    label: "Floor",
    widthMm,
    heightMm,
    originPose: {
      originMm: v3(bbox.xMin, bbox.yMin, 0),
      uAxisMm: v3(1, 0, 0),
      vAxisMm: v3(0, 1, 0),
    },
    enabled: room.surfaceEnable.floor === true,
    projectionMode: "antipodal",
  });

  // Walls — one per consecutive vertex pair (wrapping back to vertex 0).
  const n = room.vertices.length;
  if (n >= 2) {
    const centroid = polygonCentroid(room.vertices);
    for (let i = 0; i < n; i++) {
      const a = room.vertices[i];
      const b = room.vertices[(i + 1) % n];
      if (!a || !b) continue;
      const segLen = segmentLength(a, b);
      if (segLen <= 0) continue;
      const ux = (b.xMm - a.xMm) / segLen;
      const uy = (b.yMm - a.yMm) / segLen;
      // Outward normal candidates: rotate (ux, uy) by ±90°. The one that
      // points AWAY from the centroid is the outward normal.
      const n1 = { x: uy, y: -ux };
      const n2 = { x: -uy, y: ux };
      const midX = (a.xMm + b.xMm) / 2;
      const midY = (a.yMm + b.yMm) / 2;
      const outward = (function pickOutward() {
        const d1 = (midX + n1.x - centroid.xMm) ** 2 + (midY + n1.y - centroid.yMm) ** 2;
        const d2 = (midX + n2.x - centroid.xMm) ** 2 + (midY + n2.y - centroid.yMm) ** 2;
        return d1 >= d2 ? n1 : n2;
      })();
      const wallId = `wall-${i}`;
      const enabled = room.surfaceEnable.walls[wallId] === true;
      surfaces.push({
        id: wallId,
        kind: "wall",
        label: labelFromOutwardNormal(outward.x, outward.y),
        widthMm: segLen,
        heightMm: room.ceilingHeightMm,
        originPose: {
          originMm: v3(a.xMm, a.yMm, 0),
          uAxisMm: v3(ux, uy, 0),
          vAxisMm: v3(0, 0, 1),
        },
        enabled,
        projectionMode: blockHorizonOnWalls ? "aboveHorizon" : "continuous",
      });
    }
  }

  return surfaces;
}

// ---------------------------------------------------------------------------
// T011 — projectBodyOntoSurface
// ---------------------------------------------------------------------------

const EPSILON = 1e-9;

/**
 * Ray-cast a 3D body unit-vector from `observerPosMm` against
 * `surface.originPose`'s plane and convert the intersection (if any)
 * to surface-local 2D `(uMm, vMm)`.
 *
 * Returns `null` when:
 *   - The surface's `projectionMode === 'aboveHorizon'` and bodyVec.z ≤ 0.
 *   - The surface's `projectionMode === 'antipodal'`  and bodyVec.z ≥ 0.
 *   - The ray is parallel to the plane (denominator ≈ 0).
 *   - The ray hits behind the observer (t ≤ 0).
 *   - The hit point is outside the surface bounds [0..widthMm] × [0..heightMm].
 *
 * For `projectionMode === 'continuous'` no z-sign cull is applied.
 */
export function projectBodyOntoSurface(
  bodyVec: Vec3,
  surface: Surface,
  observerPosMm: Vec3,
): { uMm: number; vMm: number } | null {
  // 1. Projection-mode cull on body z.
  switch (surface.projectionMode) {
    case "aboveHorizon":
      if (bodyVec.z <= 0) return null;
      break;
    case "antipodal":
      if (bodyVec.z >= 0) return null;
      break;
    case "continuous":
      // No cull.
      break;
    default:
      return null;
  }

  // 2. Ray-plane intersection. Plane is defined by surface.originPose:
  //    plane normal = uAxis × vAxis;  any point on plane = origin.
  const u = surface.originPose.uAxisMm;
  const v = surface.originPose.vAxisMm;
  const origin = surface.originPose.originMm;
  const normal = cross(u, v);

  const denom = dot(normal, bodyVec);
  if (Math.abs(denom) < EPSILON) return null;

  // d = dot(normal, originPlane) − dot(normal, observer) → distance to plane
  // along the body's ray.
  const t = dot(normal, sub(origin, observerPosMm)) / denom;
  if (t <= 0) return null;

  // 3. World-space hit point, then transform to surface-local 2D by
  //    projecting the offset-from-origin onto each axis.
  const hit: Vec3 = {
    x: observerPosMm.x + bodyVec.x * t,
    y: observerPosMm.y + bodyVec.y * t,
    z: observerPosMm.z + bodyVec.z * t,
  };
  const offset = sub(hit, origin);
  // Note: we DEFINED uAxis and vAxis as unit vectors in deriveSurfaces, so
  // dot(offset, axis) gives the signed distance directly in mm.
  const uMm = dot(offset, u);
  const vMm = dot(offset, v);

  // 4. Surface-bounds cull.
  if (uMm < 0 || uMm > surface.widthMm) return null;
  if (vMm < 0 || vMm > surface.heightMm) return null;

  return { uMm, vMm };
}
