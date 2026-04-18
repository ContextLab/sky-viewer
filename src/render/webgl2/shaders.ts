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
vec3 projectAltAz(float altRad, float azRad, float bearingRad, float fovRad, float aspect) {
  float dAz = wrapSignedPi(azRad - bearingRad);
  // Below horizon AND behind viewer → cull.
  float culled = step(0.0, -altRad) * step(1.5707963267948966, abs(dAz));
  float halfFov = fovRad * 0.5;
  float x = dAz / halfFov;
  float y = altRad / (halfFov / aspect);
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
  vec3 proj = projectAltAz(iAltAz.x, iAltAz.y, uBearingRad, uFovRad, uAspect);

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
uniform float uFovRad;
uniform float uAspect;

void main() {
  vec3 proj = projectAltAz(aAltAz.x, aAltAz.y, uBearingRad, uFovRad, uAspect);
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
uniform float uFovRad;
uniform float uAspect;
uniform float uTime;
uniform vec2 uCanvasPx;

out vec2 vCorner;
out vec3 vColor;
out float vMagnitudeFalloff;

void main() {
  vec3 proj = projectAltAz(iAltAz.x, iAltAz.y, uBearingRad, uFovRad, uAspect);

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
