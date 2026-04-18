// Shared sky → screen projection.
//
// This module is the ONE source of truth for turning an (altitude,
// azimuth) point on the celestial sphere into normalised device
// coordinates (NDC) for the current view frame. Both the Canvas2D
// fallback (src/render/canvas2d/fallback.ts) and the WebGL2 shaders
// (src/render/webgl2/shaders.ts, inlined as a GLSL function) MUST
// implement the same formula byte-for-byte so their output agrees
// to within pixel rounding. Any change here MUST be mirrored in
// STAR_VERT / LINE_VERT / PLANET_VERT in shaders.ts.
//
// Projection model
// ----------------
//
// The view is described by:
//   bearingRad — direction the viewer is facing, radians, N=0, E=π/2.
//   fovRad     — horizontal field of view, radians (spec FR-005a: 30°–180°).
//   aspect     — canvas width / canvas height.
//
// For a point at (altRad, azRad):
//   1. dAz = azRad − bearingRad, wrapped to [−π, π].
//   2. If altRad ≤ 0 AND |dAz| > π/2, the point is both below the
//      horizon AND behind the viewer → cull.
//   3. NDC x =  dAz   / (fovRad/2)    (positive right, left is −π … +π)
//      NDC y = altRad / (fovRad/(2·aspect))
//
// The y scaling uses the horizontal fov divided by aspect so circles
// on the sky remain circular on screen (pixels are square). This is
// an approximate gnomonic projection that is cheap, stable, and
// accurate enough within ±fov/2 for the MVP's accuracy tier — away
// from the view centre the distortion grows but stars don't pop
// visibly.
//
// Points with |NDC x| > 1 or |NDC y| > 1 are off-screen; callers
// should still receive the NDC (out-of-frame culling is the caller's
// job — the Canvas2D path skips them, the WebGL2 path relies on the
// hardware clipper).

/** Horizontal bounds for fovDeg per spec FR-005a. */
export const MIN_FOV_DEG = 30;
export const MAX_FOV_DEG = 180;
/** Default horizontal fov on first load per Q4 clarification. */
export const DEFAULT_FOV_DEG = 90;

const DEG2RAD = Math.PI / 180;

/**
 * Reduce an angular difference to the signed range (−π, π]. This
 * matches GLSL `mod`-based wrap used in the shader inline helper.
 */
export function wrapSignedPi(angleRad: number): number {
  const TAU = Math.PI * 2;
  let a = angleRad % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

/**
 * Project a celestial point onto screen NDC for the given view.
 * Returns `null` when the point is below the horizon and behind the
 * viewer — the one case that is ALWAYS culled regardless of FOV (the
 * other direction, "below horizon but in front", is kept so partial
 * disc cut-offs at the horizon look right). Both the WebGL2 shader
 * and the Canvas2D fallback use exactly this formula; keep them in
 * lockstep.
 */
export function projectAltAzToNdc(
  altRad: number,
  azRad: number,
  bearingRad: number,
  fovRad: number,
  aspect: number,
): { x: number; y: number } | null {
  const dAz = wrapSignedPi(azRad - bearingRad);
  // Cull: below horizon AND behind viewer → certainly invisible.
  if (altRad <= 0 && Math.abs(dAz) > Math.PI / 2) return null;
  const halfFov = fovRad * 0.5;
  const x = dAz / halfFov;
  // y scaling preserves angular proportion for square pixels; see
  // docstring at the top of the file.
  const y = altRad / (halfFov / aspect);
  return { x, y };
}

/**
 * Convert NDC `(x, y)` to CSS pixel coordinates on a canvas whose
 * visible area is `(widthCss, heightCss)`. Y is flipped because NDC
 * y+ is up but Canvas2D y+ is down.
 */
export function ndcToCssPixels(
  x: number,
  y: number,
  widthCss: number,
  heightCss: number,
): { px: number; py: number } {
  const px = (x * 0.5 + 0.5) * widthCss;
  const py = (1 - (y * 0.5 + 0.5)) * heightCss;
  return { px, py };
}

/**
 * Short-circuit version of `projectAltAzToNdc` that takes altitude
 * and azimuth already in degrees. The horizontal conversions in
 * src/astro/transforms.ts return degrees, so the renderer code that
 * consumes `SkyState.bodies` (which are in degrees) uses this
 * helper directly to avoid redundant conversions.
 */
export function projectAltAzDegToNdc(
  altDeg: number,
  azDeg: number,
  bearingRad: number,
  fovRad: number,
  aspect: number,
): { x: number; y: number } | null {
  return projectAltAzToNdc(altDeg * DEG2RAD, azDeg * DEG2RAD, bearingRad, fovRad, aspect);
}

/** Radius (CSS px) of a star of magnitude `vmag`. Matches GLSL size. */
export function starRadiusPx(vmag: number): number {
  // Matches STAR_VERT's `pointSize = clamp(6.0 * pow(2.0, (4.5 - vmag) * 0.5), 1.0, 32.0)`
  // halved, because a point sprite's "size" is the edge length, and a
  // Canvas2D `arc()` takes a radius.
  const size = 6 * Math.pow(2, (4.5 - vmag) * 0.5);
  const clamped = Math.min(32, Math.max(1, size));
  return clamped * 0.5;
}

/**
 * Look up a star's display colour from its B−V colour index (stored
 * in the catalogue as 0.01-mag units × 100, range roughly [−40, +200]).
 * Mirrors the piecewise-linear LUT used by STAR_FRAG. Returned values
 * are in 0..1 linear space; callers multiply by 255 for CSS.
 */
export function starColorFromBvIndex(bvIndexHundredths: number): { r: number; g: number; b: number } {
  const bv = bvIndexHundredths / 100; // real B−V
  // Anchors keyed by B−V — matches the LUT in STAR_FRAG.
  // -0.4 → (0.7, 0.8, 1.0) cool blue
  //  0.0 → (1.0, 1.0, 0.95) yellow-white
  // +1.5 → (1.0, 0.85, 0.7) orange
  // +2.0 → (1.0, 0.75, 0.55) red
  type Anchor = { t: number; r: number; g: number; b: number };
  const A: Anchor[] = [
    { t: -0.4, r: 0.7, g: 0.8, b: 1.0 },
    { t: 0.0, r: 1.0, g: 1.0, b: 0.95 },
    { t: 1.5, r: 1.0, g: 0.85, b: 0.7 },
    { t: 2.0, r: 1.0, g: 0.75, b: 0.55 },
  ];
  const first = A[0]!;
  const last = A[A.length - 1]!;
  if (bv <= first.t) return { r: first.r, g: first.g, b: first.b };
  if (bv >= last.t) return { r: last.r, g: last.g, b: last.b };
  for (let i = 0; i < A.length - 1; i++) {
    const lo = A[i]!;
    const hi = A[i + 1]!;
    if (bv >= lo.t && bv <= hi.t) {
      const t = (bv - lo.t) / (hi.t - lo.t);
      return {
        r: lo.r + (hi.r - lo.r) * t,
        g: lo.g + (hi.g - lo.g) * t,
        b: lo.b + (hi.b - lo.b) * t,
      };
    }
  }
  // Unreachable, but keeps noUncheckedIndexedAccess happy.
  return { r: 1, g: 1, b: 1 };
}

/**
 * Viewer-agnostic "is this altitude visible" test used by both paths
 * before even attempting projection. Matches STAR_PASS / LINE_PASS
 * culling: altitudes below −2° are never rendered regardless of
 * bearing (atmospheric refraction can lift an object at −0.5° back
 * above the true horizon, which is why we don't cut at 0°).
 */
export function isAboveHorizon(altDeg: number): boolean {
  return altDeg > -2;
}
