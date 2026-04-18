// Shared 1-D value-noise used to paint the stylized distant-hills
// silhouette on the horizon. Both the WebGL2 ground pass
// (src/render/webgl2/ground-pass.ts via shaders.ts) and the Canvas2D
// fallback (src/render/canvas2d/fallback.ts) sample noise at
// per-pixel (or per-column) azimuth offsets keyed on bearing, so
// rotation shifts the silhouette deterministically without popping.
//
// The formula MUST be byte-for-byte identical between TypeScript and
// GLSL: any divergence would cause the two renderer paths to draw
// different hill outlines. The GLSL body is exported as
// `GROUND_NOISE_GLSL` so it can be inlined into the fragment shader
// and kept in lockstep.
//
// Implementation: a cheap hash → smoothstep-lerp between adjacent
// integer lattice points.

/**
 * Deterministic pseudo-random scalar in [0, 1) keyed on an integer
 * lattice coordinate. Matches the GLSL `hash11` below.
 *
 * The magic constants are an arbitrary irrational-ish pair chosen so
 * successive integers produce a plausibly random sequence; they have
 * no astronomical meaning. We use `Math.fround` and bitwise-style
 * float wrap-arounds implicit in GLSL's `fract` by subtracting
 * `Math.floor` of the inner product, matching the shader's `fract`.
 */
export function hash11(n: number): number {
  const x = Math.sin(n * 127.1 + 31.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * 1-D value noise at real-valued position `x`. Returns a scalar in
 * [0, 1]. Identical to `valueNoise1D` in GLSL.
 */
export function valueNoise1D(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f); // smoothstep
  const a = hash11(i);
  const b = hash11(i + 1);
  return a + (b - a) * u;
}

/**
 * Sample the horizon silhouette height at azimuth `azRad` (radians),
 * biased by `seed`. Returns a scalar in roughly [−1, +1] — a signed
 * offset that callers multiply by an amplitude to produce the
 * pixel-space silhouette perturbation.
 *
 * Two-octave fBm: one low-frequency base (gentle rolling hills) plus
 * one higher-frequency overlay (texture on the hilltops). Identical
 * to `horizonSilhouette` in GLSL.
 */
export function horizonSilhouette(azRad: number, seed: number): number {
  // Convert azimuth to a lattice coordinate. 6 lattice points per
  // radian gives ~1 hill every ~10° which reads as "distant rolling
  // terrain" rather than sharp peaks.
  const base = valueNoise1D(azRad * 6 + seed);
  const detail = valueNoise1D(azRad * 17 + seed * 1.7);
  // Blend to a signed [−1, 1]-ish range, weighted toward the base.
  return (base * 0.75 + detail * 0.25) * 2 - 1;
}

/**
 * GLSL source of the noise helpers above. Inlined into the ground
 * fragment shader string. MUST implement the exact same formula as
 * the TS functions — keep them synchronised on every edit.
 *
 * The TS / GLSL correspondence (docs for future maintainers):
 *   hash11(n)              ↔ fract(sin(n * 127.1 + 31.7) * 43758.5453)
 *   valueNoise1D(x)        ↔ smoothstep-lerp(hash11(floor(x)), hash11(floor(x)+1), fract(x))
 *   horizonSilhouette(a,s) ↔ (valueNoise1D(a*6+s)*0.75 + valueNoise1D(a*17+s*1.7)*0.25) * 2 − 1
 */
export const GROUND_NOISE_GLSL = /* glsl */ `
float hash11(float n) {
  return fract(sin(n * 127.1 + 31.7) * 43758.5453);
}

float valueNoise1D(float x) {
  float i = floor(x);
  float f = x - i;
  float u = f * f * (3.0 - 2.0 * f);
  float a = hash11(i);
  float b = hash11(i + 1.0);
  return a + (b - a) * u;
}

float horizonSilhouette(float azRad, float seed) {
  float base = valueNoise1D(azRad * 6.0 + seed);
  float detail = valueNoise1D(azRad * 17.0 + seed * 1.7);
  return (base * 0.75 + detail * 0.25) * 2.0 - 1.0;
}
`;
