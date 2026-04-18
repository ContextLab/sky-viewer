// Ground pass — stylized horizon-and-below paint.
//
// Draws a single full-screen triangle pair in NDC. The fragment
// shader (src/render/webgl2/shaders.ts::GROUND_FRAG) computes a
// silhouette line from the smooth horizon NDC y plus a deterministic
// 1-D value-noise perturbation keyed on per-fragment azimuth. Above
// the silhouette fragments are discarded so the clear-colour sky
// remains; below the silhouette a vertical earth-tone gradient is
// painted, plus a thin haze band at the smooth horizon.
//
// This pass runs FIRST (before lines, stars, planets), so stars above
// the horizon are never obscured. It is the visual anchor that tells
// the viewer which way is "down".

import type { SkyState } from '../types';
import { horizonNdcY } from '../projection';
import { GROUND_VERT, GROUND_FRAG } from './shaders';
import { compileProgram, makeVAO, deleteGL } from './gl-utils';

const DEG2RAD = Math.PI / 180;

export interface GroundPassUniforms {
  bearingRad: number;
  pitchRad: number;
  fovRad: number;
  aspect: number;
  /** Drawing-buffer height in device pixels (for the haze-band width). */
  canvasHeightPx: number;
}

/**
 * Derive the ground palette from the current sky background, producing
 * a richer "dark earth" scheme that adapts to the twilight phase.
 *
 * The palette is built from four anchors:
 *   - `earthNear`: colour at the ridgeline (near-horizon). A warm
 *     atmospheric-scatter tint — the sky bg blended ~55% with a muted
 *     terracotta so hills pick up the last warm glow of the sky.
 *   - `earthMid`: desaturated earth-tone in the foreground mid-band
 *     (≈30% of the ground). Cool, slightly greenish-brown so the
 *     terrain reads as terrain and not just "floor".
 *   - `earthFar`: near-black at the bottom of the screen. Ground is
 *     dark so the sky remains the hero.
 *   - `haze`: a warm atmospheric haze colour (driven by the sky bg
 *     itself) used for the soft distance-haze gradient that covers
 *     the seam where the silhouette meets the sky.
 *
 * All returned components are in 0..1.
 */
export function groundColors(bg: { r: number; g: number; b: number }): {
  earthNear: [number, number, number];
  earthMid: [number, number, number];
  earthFar: [number, number, number];
  haze: [number, number, number];
  hazeAlpha: number;
} {
  // Anchor tones (0..255). Chosen for atmosphere: warm terracotta
  // glow up top → cool muted loam in the middle → near-black at the
  // bottom. Values stay dark-end so the ground never competes with
  // the sky for visual weight.
  const warmHorizon = { r: 54, g: 34, b: 22 }; // subtle horizon glow
  const midEarth = { r: 20, g: 18, b: 14 }; // cool dark loam
  const deepEarth = { r: 6, g: 5, b: 4 }; // near-black at the bottom

  // Near-horizon colour: 55% sky bg + 45% warm-horizon pigment. At
  // night the sky is near-black so this reduces to ~warmHorizon*0.45
  // — barely visible warmth. At day the sky is bright blue so the
  // ridgeline picks up cool blue-grey light. Both read as natural.
  const near: [number, number, number] = [
    (bg.r * 0.55 + warmHorizon.r * 0.45) / 255,
    (bg.g * 0.55 + warmHorizon.g * 0.45) / 255,
    (bg.b * 0.55 + warmHorizon.b * 0.45) / 255,
  ];
  const mid: [number, number, number] = [
    midEarth.r / 255,
    midEarth.g / 255,
    midEarth.b / 255,
  ];
  const far: [number, number, number] = [
    deepEarth.r / 255,
    deepEarth.g / 255,
    deepEarth.b / 255,
  ];
  // Haze is driven by the sky bg (so twilight haze picks up amber
  // tones, night haze is dark-blue). Add a small warm bias to simulate
  // atmospheric scattering along the line of sight.
  const haze: [number, number, number] = [
    Math.min(1, (bg.r + 30) / 255),
    Math.min(1, (bg.g + 18) / 255),
    Math.min(1, (bg.b + 10) / 255),
  ];
  // Overall haze opacity. The soft gradient fall-off is handled in
  // the fragment shader; this is the peak alpha at the horizon seam.
  return { earthNear: near, earthMid: mid, earthFar: far, haze, hazeAlpha: 0.55 };
}

/**
 * Silhouette amplitude in NDC y units. ~3% of screen height for the
 * broad-mountain fBm base; the finer hill + micro-bump octaves ride
 * on top inside the same amplitude budget (so the maximum extrusion
 * is capped while the silhouette reads as fractal, not monofrequency).
 * Since NDC y spans [−1, +1] (total 2 units), 3% of screen height
 * corresponds to `0.03 · 2 = 0.06` NDC units.
 */
export const SILHOUETTE_AMPLITUDE_NDC = 0.06;

/**
 * Seed the noise lattice by the current bearing so panning shifts
 * the silhouette smoothly (bearing in radians feeds directly into the
 * same azimuth-coordinate the fragment shader samples). We add a
 * small constant offset so seed 0 doesn't degenerate into a flat line
 * when bearing = 0.
 */
export function silhouetteSeed(bearingRad: number): number {
  return bearingRad + 11.3;
}

export class GroundPass {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly quadBuffer: WebGLBuffer;

  private readonly uHorizonY: WebGLUniformLocation | null;
  private readonly uBearing: WebGLUniformLocation | null;
  private readonly uFov: WebGLUniformLocation | null;
  private readonly uAspect: WebGLUniformLocation | null;
  private readonly uSilhouetteSeed: WebGLUniformLocation | null;
  private readonly uAmplitudeNdc: WebGLUniformLocation | null;
  private readonly uEarthNear: WebGLUniformLocation | null;
  private readonly uEarthMid: WebGLUniformLocation | null;
  private readonly uEarthFar: WebGLUniformLocation | null;
  private readonly uHazeRgb: WebGLUniformLocation | null;
  private readonly uHazeAlpha: WebGLUniformLocation | null;
  private readonly uHazeHalfPx: WebGLUniformLocation | null;
  private readonly uCanvasHeightPx: WebGLUniformLocation | null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = compileProgram(gl, GROUND_VERT, GROUND_FRAG);

    this.uHorizonY = gl.getUniformLocation(this.program, 'uHorizonY');
    this.uBearing = gl.getUniformLocation(this.program, 'uBearingRad');
    this.uFov = gl.getUniformLocation(this.program, 'uFovRad');
    this.uAspect = gl.getUniformLocation(this.program, 'uAspect');
    this.uSilhouetteSeed = gl.getUniformLocation(this.program, 'uSilhouetteSeed');
    this.uAmplitudeNdc = gl.getUniformLocation(this.program, 'uAmplitudeNdc');
    this.uEarthNear = gl.getUniformLocation(this.program, 'uEarthNear');
    this.uEarthMid = gl.getUniformLocation(this.program, 'uEarthMid');
    this.uEarthFar = gl.getUniformLocation(this.program, 'uEarthFar');
    this.uHazeRgb = gl.getUniformLocation(this.program, 'uHazeRgb');
    this.uHazeAlpha = gl.getUniformLocation(this.program, 'uHazeAlpha');
    this.uHazeHalfPx = gl.getUniformLocation(this.program, 'uHazeHalfPx');
    this.uCanvasHeightPx = gl.getUniformLocation(this.program, 'uCanvasHeightPx');

    // Full-screen quad covering NDC [−1, +1]² — two triangles.
    const quad = new Float32Array([
      -1, -1, 1, -1, 1, 1,
      -1, -1, 1, 1, -1, 1,
    ]);
    const qb = gl.createBuffer();
    if (!qb) throw new Error('GroundPass: createBuffer (quad) failed');
    this.quadBuffer = qb;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    const aCornerLoc = gl.getAttribLocation(this.program, 'aCorner');

    this.vao = makeVAO(gl, () => {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      if (aCornerLoc >= 0) {
        gl.enableVertexAttribArray(aCornerLoc);
        gl.vertexAttribPointer(aCornerLoc, 2, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(aCornerLoc, 0);
      }
    });
  }

  /**
   * Paint the ground for one frame. The caller owns the GL blend state;
   * the ground shader writes opaque RGB (alpha = 1) so blend mode is
   * irrelevant for this pass. Discarded fragments leave the clear
   * colour (sky) untouched.
   */
  draw(state: SkyState, u: GroundPassUniforms): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    const horizonY = horizonNdcY(u.pitchRad, u.fovRad, u.aspect);
    const seed = silhouetteSeed(u.bearingRad);
    const { earthNear, earthMid, earthFar, haze, hazeAlpha } =
      groundColors(state.backgroundRgb);

    gl.uniform1f(this.uHorizonY, horizonY);
    gl.uniform1f(this.uBearing, u.bearingRad);
    gl.uniform1f(this.uFov, u.fovRad);
    gl.uniform1f(this.uAspect, u.aspect);
    gl.uniform1f(this.uSilhouetteSeed, seed);
    gl.uniform1f(this.uAmplitudeNdc, SILHOUETTE_AMPLITUDE_NDC);
    gl.uniform3f(this.uEarthNear, earthNear[0], earthNear[1], earthNear[2]);
    gl.uniform3f(this.uEarthMid, earthMid[0], earthMid[1], earthMid[2]);
    gl.uniform3f(this.uEarthFar, earthFar[0], earthFar[1], earthFar[2]);
    gl.uniform3f(this.uHazeRgb, haze[0], haze[1], haze[2]);
    gl.uniform1f(this.uHazeAlpha, hazeAlpha);
    // Distance-haze band half-width in pixels (≈5% of viewport height).
    // The fragment shader uses a smoothstep falloff from the horizon
    // down into the ground so the seam where hills meet sky dissolves.
    gl.uniform1f(this.uHazeHalfPx, Math.max(12, u.canvasHeightPx * 0.05));
    gl.uniform1f(this.uCanvasHeightPx, u.canvasHeightPx);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    deleteGL(this.gl, this.program, this.vao, this.quadBuffer);
  }
}

// Re-export for unit tests / Canvas2D parity that want to bypass the
// GroundPass class (which requires a live WebGL2 context).
export const GROUND_DEG2RAD = DEG2RAD;
