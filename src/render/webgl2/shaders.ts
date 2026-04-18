// GLSL ES 300 source strings for the WebGL2 renderer.
//
// All three vertex shaders share an inlined projection helper,
// `projectAltAz`. Its math MUST stay in lockstep with the TypeScript
// `projectAltAzToNdc` in src/render/projection.ts — the parity of
// Canvas2D and WebGL2 output depends on it. If you change one, change
// the other in the same commit.
//
// All three fragment shaders output into a single RGBA framebuffer
// with additive blending (for stars / planets) or straight alpha (for
// lines), composited over `uBackground` cleared at frame start.
//
// The ground pass (GROUND_VERT / GROUND_FRAG) runs FIRST to paint the
// horizon-and-below region; its noise helpers are shared with the
// Canvas2D fallback via src/render/noise.ts — see GROUND_NOISE_GLSL.

import { GROUND_NOISE_GLSL } from '../noise';

// A mini GLSL helper shared by every vertex shader. Produces a gl_Position
// and a per-vertex visibility flag (w = 0 → clipped) matching the TS
// formula. We emit the helper as a #define-less plain function inlined
// into each shader string.
const PROJECTION_GLSL = /* glsl */ `
// Wrap an angle difference to (−π, π].
float wrapSignedPi(float a) {
  const float TAU = 6.28318530717958647692;
  float m = mod(a, TAU);
  if (m > 3.14159265358979323846) m -= TAU;
  else if (m <= -3.14159265358979323846) m += TAU;
  return m;
}

// Project (altRad, azRad) → NDC for the current view. Mirrors
// src/render/projection.ts::projectAltAzToNdc byte-for-byte.
// Returns vec3(x, y, w) where w = 0 indicates a culled vertex
// (below-horizon + behind-viewer), otherwise w = 1.
vec3 projectAltAz(float altRad, float azRad, float bearingRad, float pitchRad, float fovRad, float aspect) {
  float dAz = wrapSignedPi(azRad - bearingRad);
  // Below horizon AND behind viewer → cull.
  float culled = step(0.0, -altRad) * step(1.5707963267948966, abs(dAz));
  float halfFov = fovRad * 0.5;
  float x = dAz / halfFov;
  float y = (altRad - pitchRad) / (halfFov / aspect);
  // w = 1 − culled (so w=0 when culled, w=1 otherwise).
  return vec3(x, y, 1.0 - culled);
}
`;

/* ===========================================================
 * STAR PASS
 * =========================================================== */

export const STAR_VERT = /* glsl */ `#version 300 es
precision highp float;
${PROJECTION_GLSL}

// Per-vertex — unit quad corner (one of 6 triangle vertices): −1..+1.
in vec2 aCorner;

// Per-instance — apparent alt/az in radians, visual magnitude,
// and B−V colour-index in 0.01-mag units (stored as signed integer
// ×100 in the catalogue; uploaded as a float here for simplicity).
in vec2 iAltAz;
in float iMag;
in float iBvIndex;

uniform float uBearingRad;
uniform float uPitchRad;
uniform float uFovRad;
uniform float uAspect;
uniform float uTime;
uniform vec2 uCanvasPx; // width, height in device pixels.

out vec2 vCorner;
out vec3 vColor;
out float vMagnitudeFalloff;

// Piecewise-linear colour LUT keyed on real B−V (not the ×100 form).
// Matches src/render/projection.ts::starColorFromBvIndex.
vec3 colorFromBv(float bv) {
  // Anchors: (-0.4, (0.7,0.8,1.0)), (0.0, (1.0,1.0,0.95)),
  //          (1.5, (1.0,0.85,0.7)), (2.0, (1.0,0.75,0.55)).
  if (bv <= -0.4) return vec3(0.7, 0.8, 1.0);
  if (bv <= 0.0) {
    float t = (bv + 0.4) / 0.4;
    return mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 1.0, 0.95), t);
  }
  if (bv <= 1.5) {
    float t = bv / 1.5;
    return mix(vec3(1.0, 1.0, 0.95), vec3(1.0, 0.85, 0.7), t);
  }
  if (bv <= 2.0) {
    float t = (bv - 1.5) / 0.5;
    return mix(vec3(1.0, 0.85, 0.7), vec3(1.0, 0.75, 0.55), t);
  }
  return vec3(1.0, 0.75, 0.55);
}

void main() {
  vec3 proj = projectAltAz(iAltAz.x, iAltAz.y, uBearingRad, uPitchRad, uFovRad, uAspect);

  // Star point sprite size in pixels, magnitude-driven.
  float size = clamp(6.0 * pow(2.0, (4.5 - iMag) * 0.5), 1.0, 32.0);
  // Twinkle — modulate by a per-star phase.
  float twinkle = 1.0 + 0.08 * sin(uTime * 3.0 + iMag * 7.0 + iAltAz.x * 11.0);
  size *= twinkle;

  // Offset in NDC: corner × (sizeInPx / halfCanvasPx). Canvas Y axis
  // is already handled by the NDC convention (up = +y).
  vec2 ndcPerPx = 2.0 / uCanvasPx;
  vec2 offsetNdc = aCorner * size * 0.5 * ndcPerPx;

  gl_Position = vec4((proj.xy + offsetNdc) * proj.z, 0.0, 1.0);
  // When culled, proj.z = 0 and every corner collapses to the origin,
  // producing zero-area triangles that the rasterizer discards.

  vCorner = aCorner;
  vColor = colorFromBv(iBvIndex / 100.0);
  // Dimmer stars have shallower alpha so the skyfield has depth.
  vMagnitudeFalloff = clamp(1.0 - (iMag - 1.0) * 0.12, 0.2, 1.0);
}
`;

export const STAR_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vCorner;
in vec3 vColor;
in float vMagnitudeFalloff;

out vec4 fragColor;

void main() {
  float r = length(vCorner);
  // Soft disc: bright core falling to transparent at the unit radius.
  float core = smoothstep(1.0, 0.0, r);
  float halo = smoothstep(1.0, 0.7, r * 1.1);
  float alpha = core * halo;
  fragColor = vec4(vColor, alpha) * vMagnitudeFalloff;
}
`;

/* ===========================================================
 * LINE PASS (constellation figures)
 * =========================================================== */

export const LINE_VERT = /* glsl */ `#version 300 es
precision highp float;
${PROJECTION_GLSL}

// One vertex per endpoint; two consecutive vertices form a line.
in vec2 aAltAz;

uniform float uBearingRad;
uniform float uPitchRad;
uniform float uFovRad;
uniform float uAspect;

void main() {
  vec3 proj = projectAltAz(aAltAz.x, aAltAz.y, uBearingRad, uPitchRad, uFovRad, uAspect);
  gl_Position = vec4(proj.xy * proj.z, 0.0, 1.0);
}
`;

export const LINE_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform vec4 uLineColor;
out vec4 fragColor;

void main() {
  fragColor = uLineColor;
}
`;

/* ===========================================================
 * PLANET PASS (sun, moon, planet billboards)
 * =========================================================== */

export const PLANET_VERT = /* glsl */ `#version 300 es
precision highp float;
${PROJECTION_GLSL}

in vec2 aCorner;

// Per-instance — alt/az in radians, visual magnitude, and a body-tint
// RGB (uploaded per instance because planets have distinct colours).
in vec2 iAltAz;
in float iMag;
in vec3 iTint;
in float iSizePx;

uniform float uBearingRad;
uniform float uPitchRad;
uniform float uFovRad;
uniform float uAspect;
uniform float uTime;
uniform vec2 uCanvasPx;

out vec2 vCorner;
out vec3 vColor;
out float vMagnitudeFalloff;

void main() {
  vec3 proj = projectAltAz(iAltAz.x, iAltAz.y, uBearingRad, uPitchRad, uFovRad, uAspect);

  // Base size scales with magnitude like stars but with a larger floor
  // (planets are visible discs, not points). Sun/Moon override via
  // iSizePx > 0 which bypasses the magnitude-driven path.
  float magSize = clamp(10.0 * pow(2.0, (0.0 - iMag) * 0.35), 3.0, 24.0);
  float size = iSizePx > 0.5 ? iSizePx : magSize;

  vec2 ndcPerPx = 2.0 / uCanvasPx;
  vec2 offsetNdc = aCorner * size * 0.5 * ndcPerPx;

  gl_Position = vec4((proj.xy + offsetNdc) * proj.z, 0.0, 1.0);

  vCorner = aCorner;
  vColor = iTint;
  vMagnitudeFalloff = 1.0;
}
`;

export const PLANET_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vCorner;
in vec3 vColor;
in float vMagnitudeFalloff;

out vec4 fragColor;

void main() {
  float r = length(vCorner);
  // Slightly harder disc than a star — planets read as bodies, not
  // twinkling points.
  float core = smoothstep(1.0, 0.25, r);
  float halo = smoothstep(1.0, 0.85, r * 1.05);
  float alpha = core * halo;
  fragColor = vec4(vColor, alpha) * vMagnitudeFalloff;
}
`;

/* ===========================================================
 * GROUND PASS (stylized horizon + gradient below)
 * ===========================================================
 *
 * A single full-screen quad whose fragment shader:
 *   - Computes the per-fragment azimuth from its NDC x.
 *   - Perturbs the horizon NDC y by a 1-D value-noise silhouette.
 *   - Discards fragments above the silhouette (sky shows through).
 *   - Below the silhouette, blends two earth tones vertically.
 *   - Strokes a thin haze line at the smooth horizon NDC y.
 *
 * Runs BEFORE stars / lines / planets. See renderer.ts.
 */

export const GROUND_VERT = /* glsl */ `#version 300 es
precision highp float;

// Per-vertex corner of a full-screen quad in NDC, −1..+1.
in vec2 aCorner;

out vec2 vNdc;

void main() {
  vNdc = aCorner;
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`;

export const GROUND_FRAG = /* glsl */ `#version 300 es
precision highp float;
${GROUND_NOISE_GLSL}

in vec2 vNdc;

uniform float uHorizonY;       // NDC y of the smooth horizon line.
uniform float uBearingRad;     // Camera heading; shifts the silhouette.
uniform float uFovRad;         // Horizontal field of view.
uniform float uAspect;         // canvas width / height.
uniform float uSilhouetteSeed; // Stable per-view-seed (bearing-driven).
uniform float uAmplitudeNdc;   // Silhouette vertical amplitude (NDC units).
uniform vec3 uEarthNear;       // Ground colour near the horizon (0..1).
uniform vec3 uEarthMid;        // Ground colour in the mid-band (0..1).
uniform vec3 uEarthFar;        // Ground colour at the screen bottom (0..1).
uniform vec3 uHazeRgb;         // Distance-haze tint (0..1).
uniform float uHazeAlpha;      // Peak haze alpha at the horizon seam.
uniform float uHazeHalfPx;     // Half-width of the haze band, in pixels.
uniform float uCanvasHeightPx; // Drawing-buffer height in pixels (for px→NDC).

out vec4 fragColor;

void main() {
  // Per-fragment azimuth offset from the view centre. vNdc.x spans
  // [−1, +1] across the screen, and the horizontal field of view is
  // uFovRad, so the angular half-width per NDC-unit is uFovRad/2.
  float az = uBearingRad + vNdc.x * (uFovRad * 0.5);

  // Silhouette NDC y: horizon shifted by fractal noise × amplitude.
  float silY = uHorizonY + horizonSilhouette(az, uSilhouetteSeed) * uAmplitudeNdc;

  // Above silhouette → let the sky clear-colour show through.
  if (vNdc.y > silY) {
    discard;
  }

  // --- BASE GRADIENT -------------------------------------------------
  // Three-stop gradient (near, mid, far). t runs 0 at the ridgeline
  // to 1 at the screen bottom. The mid band sits at t ~= 0.35 so
  // the warm horizon glow fades off quickly, ceding the bulk of the
  // ground to the cool earth tone and near-black floor.
  float denom = max(silY + 1.0, 1e-4);
  float t = clamp((silY - vNdc.y) / denom, 0.0, 1.0);
  vec3 ground;
  if (t < 0.35) {
    ground = mix(uEarthNear, uEarthMid, smoothstep(0.0, 0.35, t));
  } else {
    ground = mix(uEarthMid, uEarthFar, smoothstep(0.35, 1.0, t));
  }

  // --- PROCEDURAL TEXTURE --------------------------------------------
  // 2-D fBm keyed on (azimuth, depth-below-horizon). Panning shifts
  // the noise horizontally in lock-step with the silhouette — no
  // pop. Depth component uses (silY - vNdc.y) so the pattern scales
  // naturally with ground distance. Amplitude is tiny (≈ ±5% of the
  // base colour) so the texture reads as "surface variance" rather
  // than "grainy".
  float depth = silY - vNdc.y;
  // Scale: ~12 azimuth-lattice points per FOV, ~8 depth-lattice
  // points per unit. Combined with fbm2D's 2-octave average this
  // produces soft mottled patches roughly 4–8° wide.
  vec2 texUv = vec2(az * 6.0, depth * 22.0);
  float nMacro = fbm2D(texUv);
  // Signed variance centred at 0.
  float macroVar = (nMacro - 0.5) * 2.0;
  ground *= (1.0 + macroVar * 0.10);

  // Stable 1-D azimuth shading — a broad cross-axis gradient so
  // different facets of the hills catch light differently as the
  // user pans. Adds depth without adding visual noise.
  float azShade = valueNoise1D(az * 1.3 + uSilhouetteSeed * 0.21);
  ground *= mix(0.85, 1.08, azShade);

  // Fine pebble-grain highlights — 2-D hash keyed to discrete cells.
  // Cells with hash > 0.985 light up as "pebbles". Amplitude is
  // capped at +4% per channel so they're visible but never sparkly.
  // Pebble density fades to zero in the upper 15% of the ground so
  // the ridgeline stays clean (distant objects have no local detail).
  float pebbleFade = smoothstep(0.0, 0.18, depth);
  vec2 pebbleCell = floor(vec2(az * 180.0, depth * 260.0));
  float pebbleHash = hash21(pebbleCell);
  float pebble = step(0.985, pebbleHash) * pebbleFade;
  ground += vec3(0.055, 0.040, 0.028) * pebble;

  // --- DISTANCE HAZE -------------------------------------------------
  // A soft atmospheric haze gradient strongest at the horizon seam,
  // fading over ~uHazeHalfPx pixels downward. Covers the silhouette
  // boundary and hides per-fragment aliasing. Only applied BELOW the
  // smooth horizon (above is already sky).
  float ndcPerPx = 2.0 / uCanvasHeightPx;
  float halfBand = uHazeHalfPx * ndcPerPx;
  // Distance from the smooth horizon, measured downward (positive =
  // deeper into the ground). Clamp at 0 so above-horizon fragments
  // don't overshoot.
  float distBelow = max(uHorizonY - vNdc.y, 0.0);
  float hazeT = smoothstep(halfBand, 0.0, distBelow);
  // Haze is strongest right at the seam. Use screen blend to lift
  // the ground towards the haze tint without just overpainting.
  vec3 withHaze = mix(ground, uHazeRgb, hazeT * uHazeAlpha);

  // Guard against negative / super-bright channels from the cumulative
  // multipliers above.
  vec3 colour = clamp(withHaze, vec3(0.0), vec3(1.0));

  fragColor = vec4(colour, 1.0);
}
`;
