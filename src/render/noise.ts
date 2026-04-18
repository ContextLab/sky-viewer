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
// integer lattice points, plus a 2-D hash used by the ground texture
// pass for faint pebble/grain scattering.

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
 * 2-D deterministic pseudo-random scalar in [0, 1). Matches the GLSL
 * `hash21` below. Used by the ground texture pass for stable pebble
 * scatter and 2-D micro-noise.
 */
export function hash21(x: number, y: number): number {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
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
 * Two-octave fBm: one LOW-frequency rolling-hill base (broad
 * mountain-like shapes ~every 30–40°), one MID-frequency hill layer,
 * and a fine micro-bump layer on top. The combination gives a
 * fractal silhouette that reads as distant terrain rather than a
 * single-frequency wave. Identical to `horizonSilhouette` in GLSL.
 */
export function horizonSilhouette(azRad: number, seed: number): number {
  // Octave 1: broad mountains (≈ 1 peak every ~30°).
  const mountains = valueNoise1D(azRad * 1.8 + seed * 0.37);
  // Octave 2: rolling hills (≈ 1 hill every ~10°).
  const hills = valueNoise1D(azRad * 6 + seed);
  // Octave 3: fine micro-bumps on the ridgeline.
  const detail = valueNoise1D(azRad * 17 + seed * 1.7);
  // Weighted fBm: mountains dominate, hills shape the mid-range,
  // detail adds crunch. Remap [0,1] to signed [−1, +1].
  const blend = mountains * 0.55 + hills * 0.30 + detail * 0.15;
  return blend * 2 - 1;
}

/**
 * GLSL source of the noise helpers above. Inlined into the ground
 * fragment shader string. MUST implement the exact same formula as
 * the TS functions — keep them synchronised on every edit.
 *
 * The TS / GLSL correspondence (docs for future maintainers):
 *   hash11(n)              ↔ fract(sin(n * 127.1 + 31.7) * 43758.5453)
 *   hash21(x, y)           ↔ fract(sin(x*127.1 + y*311.7) * 43758.5453)
 *   valueNoise1D(x)        ↔ smoothstep-lerp(hash11(floor(x)), hash11(floor(x)+1), fract(x))
 *   valueNoise2D(p)        ↔ bilinear smoothstep-lerp of hash21 at the four lattice corners
 *   horizonSilhouette(a,s) ↔ (noise(a*1.8+s*0.37)*0.55 + noise(a*6+s)*0.30 + noise(a*17+s*1.7)*0.15) * 2 − 1
 */
export const GROUND_NOISE_GLSL = /* glsl */ `
float hash11(float n) {
  return fract(sin(n * 127.1 + 31.7) * 43758.5453);
}

float hash21(vec2 p) {
  return fract(sin(p.x * 127.1 + p.y * 311.7) * 43758.5453);
}

float valueNoise1D(float x) {
  float i = floor(x);
  float f = x - i;
  float u = f * f * (3.0 - 2.0 * f);
  float a = hash11(i);
  float b = hash11(i + 1.0);
  return a + (b - a) * u;
}

// 2-D value noise: bilinear smoothstep-lerp of four lattice-corner
// hash21 samples. Returns [0, 1]. Used by the ground texture pass
// for subtle albedo variation.
float valueNoise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 2-octave fBm of valueNoise2D. Adds spatial variation with a tiny
// amount of structure without looking noisy-digital. Returns [0, 1].
float fbm2D(vec2 p) {
  float v = valueNoise2D(p) * 0.65;
  v += valueNoise2D(p * 2.17 + 7.3) * 0.35;
  return v;
}

float horizonSilhouette(float azRad, float seed) {
  float mountains = valueNoise1D(azRad * 1.8 + seed * 0.37);
  float hills = valueNoise1D(azRad * 6.0 + seed);
  float detail = valueNoise1D(azRad * 17.0 + seed * 1.7);
  return (mountains * 0.55 + hills * 0.30 + detail * 0.15) * 2.0 - 1.0;
}
`;
