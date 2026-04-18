// Planet / Sun / Moon billboard pass.
//
// Structurally identical to StarPass but with a fixed-size instance
// buffer (at most 10 instances: Sun, Moon, 8 planets) and an extra
// per-instance RGB tint + optional fixed size (for Sun/Moon discs).
//
// Planets and Sun/Moon below the horizon are culled out of the
// instance buffer, same policy as StarPass.

import type { RenderBody, SkyState, BodyId } from '../types';
import { isAboveHorizon } from '../projection';
import { PLANET_VERT, PLANET_FRAG } from './shaders';
import { compileProgram, makeVAO, deleteGL } from './gl-utils';

const DEG2RAD = Math.PI / 180;

/**
 * Per-instance layout:
 *   0: altRad
 *   1: azRad
 *   2: mag
 *   3,4,5: tint RGB (0..1)
 *   6: sizePx (0 means "use magnitude-driven size")
 */
const FLOATS_PER_INSTANCE = 7;
const MAX_BODIES = 10;

export interface PlanetPassUniforms {
  bearingRad: number;
  pitchRad: number;
  fovRad: number;
  aspect: number;
  timeSec: number;
  canvasPx: [number, number];
}

// Canonical tints per body. Kept here (not in shader) so the Canvas2D
// fallback can use the same palette via the `BODY_TINTS` export.
export const BODY_TINTS: Readonly<Record<BodyId, { r: number; g: number; b: number }>> = {
  sun: { r: 1.0, g: 0.92, b: 0.55 },
  moon: { r: 0.95, g: 0.95, b: 0.9 },
  mercury: { r: 0.82, g: 0.78, b: 0.75 },
  venus: { r: 1.0, g: 0.95, b: 0.78 },
  mars: { r: 1.0, g: 0.55, b: 0.35 },
  jupiter: { r: 0.98, g: 0.88, b: 0.72 },
  saturn: { r: 0.95, g: 0.85, b: 0.58 },
  uranus: { r: 0.7, g: 0.9, b: 0.95 },
  neptune: { r: 0.55, g: 0.72, b: 1.0 },
};

/**
 * Compute an explicit-size override in pixels for Sun/Moon based on
 * their angular diameter and the current FOV. For the eight planets
 * we return 0, which signals the shader to fall back to the magnitude
 * curve. Keeping this here (not in the shader) lets the Canvas2D
 * path reuse the same sizing rule.
 */
export function bodyBillboardSizePx(
  body: RenderBody,
  fovRad: number,
  canvasWidthPx: number,
): number {
  if (body.id !== 'sun' && body.id !== 'moon') return 0;
  const ang = body.angularDiameterArcsec;
  if (typeof ang !== 'number' || !Number.isFinite(ang) || ang <= 0) return 0;
  // Angular diameter in radians.
  const diamRad = (ang / 3600) * DEG2RAD;
  // Project onto canvas width: one canvas-width spans `fovRad` of sky.
  const px = (diamRad / fovRad) * canvasWidthPx;
  // Enforce a readable minimum so on wide FOVs the disc doesn't vanish.
  return Math.max(px, 6);
}

export class PlanetPass {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly quadBuffer: WebGLBuffer;
  private readonly instanceBuffer: WebGLBuffer;

  private readonly uBearing: WebGLUniformLocation | null;
  private readonly uPitch: WebGLUniformLocation | null;
  private readonly uFov: WebGLUniformLocation | null;
  private readonly uAspect: WebGLUniformLocation | null;
  private readonly uTime: WebGLUniformLocation | null;
  private readonly uCanvasPx: WebGLUniformLocation | null;

  private readonly instanceData = new Float32Array(MAX_BODIES * FLOATS_PER_INSTANCE);
  private instanceCount = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = compileProgram(gl, PLANET_VERT, PLANET_FRAG);

    this.uBearing = gl.getUniformLocation(this.program, 'uBearingRad');
    this.uPitch = gl.getUniformLocation(this.program, 'uPitchRad');
    this.uFov = gl.getUniformLocation(this.program, 'uFovRad');
    this.uAspect = gl.getUniformLocation(this.program, 'uAspect');
    this.uTime = gl.getUniformLocation(this.program, 'uTime');
    this.uCanvasPx = gl.getUniformLocation(this.program, 'uCanvasPx');

    const quad = new Float32Array([
      -1, -1, 1, -1, 1, 1,
      -1, -1, 1, 1, -1, 1,
    ]);
    const qb = gl.createBuffer();
    if (!qb) throw new Error('PlanetPass: createBuffer (quad) failed');
    this.quadBuffer = qb;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    const ib = gl.createBuffer();
    if (!ib) throw new Error('PlanetPass: createBuffer (instance) failed');
    this.instanceBuffer = ib;

    const aCornerLoc = gl.getAttribLocation(this.program, 'aCorner');
    const iAltAzLoc = gl.getAttribLocation(this.program, 'iAltAz');
    const iMagLoc = gl.getAttribLocation(this.program, 'iMag');
    const iTintLoc = gl.getAttribLocation(this.program, 'iTint');
    const iSizeLoc = gl.getAttribLocation(this.program, 'iSizePx');

    this.vao = makeVAO(gl, () => {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.enableVertexAttribArray(aCornerLoc);
      gl.vertexAttribPointer(aCornerLoc, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(aCornerLoc, 0);

      const stride = FLOATS_PER_INSTANCE * 4;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      if (iAltAzLoc >= 0) {
        gl.enableVertexAttribArray(iAltAzLoc);
        gl.vertexAttribPointer(iAltAzLoc, 2, gl.FLOAT, false, stride, 0);
        gl.vertexAttribDivisor(iAltAzLoc, 1);
      }
      if (iMagLoc >= 0) {
        gl.enableVertexAttribArray(iMagLoc);
        gl.vertexAttribPointer(iMagLoc, 1, gl.FLOAT, false, stride, 8);
        gl.vertexAttribDivisor(iMagLoc, 1);
      }
      if (iTintLoc >= 0) {
        gl.enableVertexAttribArray(iTintLoc);
        gl.vertexAttribPointer(iTintLoc, 3, gl.FLOAT, false, stride, 12);
        gl.vertexAttribDivisor(iTintLoc, 1);
      }
      if (iSizeLoc >= 0) {
        gl.enableVertexAttribArray(iSizeLoc);
        gl.vertexAttribPointer(iSizeLoc, 1, gl.FLOAT, false, stride, 24);
        gl.vertexAttribDivisor(iSizeLoc, 1);
      }
    });
  }

  /**
   * Upload the per-frame instance data for the bodies in
   * `state.bodies`. Bodies below the horizon are skipped (so
   * `instanceCount` ≤ 10 but may be smaller).
   */
  update(state: SkyState, canvasWidthPx: number): void {
    const fovRad = state.observation.fovDeg * DEG2RAD;
    let write = 0;
    let count = 0;
    const cap = Math.min(state.bodies.length, MAX_BODIES);
    for (let i = 0; i < cap; i++) {
      const b = state.bodies[i]!;
      if (!isAboveHorizon(b.altDeg)) continue;
      const tint = BODY_TINTS[b.id];
      const sizePx = bodyBillboardSizePx(b, fovRad, canvasWidthPx);
      this.instanceData[write] = b.altDeg * DEG2RAD;
      this.instanceData[write + 1] = b.azDeg * DEG2RAD;
      this.instanceData[write + 2] = b.apparentMag;
      this.instanceData[write + 3] = tint.r;
      this.instanceData[write + 4] = tint.g;
      this.instanceData[write + 5] = tint.b;
      this.instanceData[write + 6] = sizePx;
      write += FLOATS_PER_INSTANCE;
      count++;
    }
    this.instanceCount = count;

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.instanceData.subarray(0, count * FLOATS_PER_INSTANCE),
      gl.DYNAMIC_DRAW,
    );
  }

  draw(u: PlanetPassUniforms): void {
    if (this.instanceCount === 0) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform1f(this.uBearing, u.bearingRad);
    gl.uniform1f(this.uPitch, u.pitchRad);
    gl.uniform1f(this.uFov, u.fovRad);
    gl.uniform1f(this.uAspect, u.aspect);
    gl.uniform1f(this.uTime, u.timeSec);
    gl.uniform2f(this.uCanvasPx, u.canvasPx[0], u.canvasPx[1]);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    deleteGL(this.gl, this.program, this.vao, this.quadBuffer, this.instanceBuffer);
  }
}
