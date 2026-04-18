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
 * Derive the two ground-gradient colours plus the haze colour from
 * the current sky background. The near-horizon colour is a 50/50 mix
 * of the sky bg and a muted earth tone (22, 18, 14); the far-bottom
 * colour is a deeper earth tone (12, 10, 8). Haze is a very desaturated
 * light blue at low alpha (per spec). Returned components are 0..1.
 */
export function groundColors(bg: { r: number; g: number; b: number }): {
  earthNear: [number, number, number];
  earthFar: [number, number, number];
  haze: [number, number, number];
  hazeAlpha: number;
} {
  // Palette constants (0..255, spec-defined).
  const mutedEarth = { r: 22, g: 18, b: 14 };
  const deepEarth = { r: 12, g: 10, b: 8 };
  const haze = { r: 200, g: 210, b: 230 };

  const near: [number, number, number] = [
    ((bg.r + mutedEarth.r) * 0.5) / 255,
    ((bg.g + mutedEarth.g) * 0.5) / 255,
    ((bg.b + mutedEarth.b) * 0.5) / 255,
  ];
  const far: [number, number, number] = [
    deepEarth.r / 255,
    deepEarth.g / 255,
    deepEarth.b / 255,
  ];
  const hazeRgb: [number, number, number] = [haze.r / 255, haze.g / 255, haze.b / 255];
  return { earthNear: near, earthFar: far, haze: hazeRgb, hazeAlpha: 0.15 };
}

/**
 * Silhouette amplitude in NDC y units. The spec calls for ~1–2% of
 * screen height; since NDC y spans [−1, +1] (total 2 units), 1.5% of
 * screen height corresponds to `0.015 · 2 = 0.03` NDC units.
 */
export const SILHOUETTE_AMPLITUDE_NDC = 0.03;

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
    const { earthNear, earthFar, haze, hazeAlpha } = groundColors(state.backgroundRgb);

    gl.uniform1f(this.uHorizonY, horizonY);
    gl.uniform1f(this.uBearing, u.bearingRad);
    gl.uniform1f(this.uFov, u.fovRad);
    gl.uniform1f(this.uAspect, u.aspect);
    gl.uniform1f(this.uSilhouetteSeed, seed);
    gl.uniform1f(this.uAmplitudeNdc, SILHOUETTE_AMPLITUDE_NDC);
    gl.uniform3f(this.uEarthNear, earthNear[0], earthNear[1], earthNear[2]);
    gl.uniform3f(this.uEarthFar, earthFar[0], earthFar[1], earthFar[2]);
    gl.uniform3f(this.uHazeRgb, haze[0], haze[1], haze[2]);
    gl.uniform1f(this.uHazeAlpha, hazeAlpha);
    // 1-pixel-ish haze band (half-width); softens into the ground.
    gl.uniform1f(this.uHazeHalfPx, 1.5);
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
