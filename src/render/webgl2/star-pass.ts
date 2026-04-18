// Star instanced pass.
//
// Draws one instanced unit quad per star. Per-frame we compute each
// star's apparent (alt, az) using src/astro (precession + proper
// motion + equatorial→horizontal), pack into a Float32Array, stream
// into a WebGL buffer, and issue `drawArraysInstanced`. Stars below
// the horizon (altDeg < isAboveHorizon threshold) are compacted out
// of the instance buffer, keeping `instanceCount` tight so the
// rasterizer never even considers them.

import type { Star } from '../../astro/stars';
import { precessStarToEpoch } from '../../astro/stars';
import { equatorialToHorizontal } from '../../astro/transforms';
import type { Observation } from '../../app/types';
import { isAboveHorizon } from '../projection';
import { STAR_VERT, STAR_FRAG } from './shaders';
import { compileProgram, makeVAO, deleteGL } from './gl-utils';

const DEG2RAD = Math.PI / 180;

/** Per-instance float layout: alt, az, mag, bv → 4 floats. */
const FLOATS_PER_INSTANCE = 4;

export interface StarPassUniforms {
  bearingRad: number;
  fovRad: number;
  aspect: number;
  timeSec: number;
  canvasPx: [number, number];
}

/**
 * Instanced star renderer. One instance per visible star per frame.
 * The VAO binds a static unit-quad vertex buffer (6 verts × 2 floats)
 * alongside a dynamic instance buffer that is rewritten every call
 * to `update()`.
 */
export class StarPass {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly quadBuffer: WebGLBuffer;
  private readonly instanceBuffer: WebGLBuffer;

  // Uniform locations cached at compile time.
  private readonly uBearing: WebGLUniformLocation | null;
  private readonly uFov: WebGLUniformLocation | null;
  private readonly uAspect: WebGLUniformLocation | null;
  private readonly uTime: WebGLUniformLocation | null;
  private readonly uCanvasPx: WebGLUniformLocation | null;

  private instanceData: Float32Array = new Float32Array(0);
  private instanceCount = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = compileProgram(gl, STAR_VERT, STAR_FRAG);

    this.uBearing = gl.getUniformLocation(this.program, 'uBearingRad');
    this.uFov = gl.getUniformLocation(this.program, 'uFovRad');
    this.uAspect = gl.getUniformLocation(this.program, 'uAspect');
    this.uTime = gl.getUniformLocation(this.program, 'uTime');
    this.uCanvasPx = gl.getUniformLocation(this.program, 'uCanvasPx');

    // Static unit quad — 6 vertices, 2 floats each, −1..+1 corners.
    // Triangle layout:   (−1,−1)-(1,−1)-(1,1)   (−1,−1)-(1,1)-(−1,1)
    const quad = new Float32Array([
      -1, -1, 1, -1, 1, 1,
      -1, -1, 1, 1, -1, 1,
    ]);
    const qb = gl.createBuffer();
    if (!qb) throw new Error('StarPass: gl.createBuffer failed for quad');
    this.quadBuffer = qb;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    const ib = gl.createBuffer();
    if (!ib) throw new Error('StarPass: gl.createBuffer failed for instance');
    this.instanceBuffer = ib;

    const aCornerLoc = gl.getAttribLocation(this.program, 'aCorner');
    const iAltAzLoc = gl.getAttribLocation(this.program, 'iAltAz');
    const iMagLoc = gl.getAttribLocation(this.program, 'iMag');
    const iBvLoc = gl.getAttribLocation(this.program, 'iBvIndex');

    this.vao = makeVAO(gl, () => {
      // aCorner — per-vertex, from quadBuffer.
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.enableVertexAttribArray(aCornerLoc);
      gl.vertexAttribPointer(aCornerLoc, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(aCornerLoc, 0);

      // Per-instance attributes — iAltAz, iMag, iBvIndex share a
      // single interleaved buffer with stride = 4 floats.
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
      if (iBvLoc >= 0) {
        gl.enableVertexAttribArray(iBvLoc);
        gl.vertexAttribPointer(iBvLoc, 1, gl.FLOAT, false, stride, 12);
        gl.vertexAttribDivisor(iBvLoc, 1);
      }
    });
  }

  /**
   * Recompute per-frame per-star apparent alt/az for the current
   * observation and upload to the GPU. Compacts away stars below
   * the horizon. Called exactly once per frame before `draw()`.
   */
  update(observation: Observation, stars: Star[], utcMs: number): void {
    const latRad = observation.location.lat * DEG2RAD;
    const lonRad = observation.location.lon * DEG2RAD;

    // Allocate/resize CPU buffer to hold the worst case (every star
    // visible). We'll write `instanceCount` × FLOATS_PER_INSTANCE
    // floats and upload that subrange.
    const maxFloats = stars.length * FLOATS_PER_INSTANCE;
    if (this.instanceData.length < maxFloats) {
      this.instanceData = new Float32Array(maxFloats);
    }

    let write = 0;
    let count = 0;
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i]!;
      // Apply precession + proper motion for the current epoch.
      const app = precessStarToEpoch(
        s.raJ2000Rad,
        s.decJ2000Rad,
        s.pmRaMasPerYr,
        s.pmDecMasPerYr,
        utcMs,
      );
      const h = equatorialToHorizontal(app.ra, app.dec, latRad, lonRad, utcMs);
      if (!isAboveHorizon(h.altDeg)) continue;
      this.instanceData[write] = h.altDeg * DEG2RAD;
      this.instanceData[write + 1] = h.azDeg * DEG2RAD;
      this.instanceData[write + 2] = s.vmag;
      this.instanceData[write + 3] = s.bvIndex;
      write += FLOATS_PER_INSTANCE;
      count++;
    }

    this.instanceCount = count;

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    // Orphan + replace the buffer to avoid synchronisation stalls.
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.instanceData.subarray(0, count * FLOATS_PER_INSTANCE),
      gl.DYNAMIC_DRAW,
    );
  }

  /** Binds program + VAO and issues one instanced draw call. */
  draw(u: StarPassUniforms): void {
    if (this.instanceCount === 0) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform1f(this.uBearing, u.bearingRad);
    gl.uniform1f(this.uFov, u.fovRad);
    gl.uniform1f(this.uAspect, u.aspect);
    gl.uniform1f(this.uTime, u.timeSec);
    gl.uniform2f(this.uCanvasPx, u.canvasPx[0], u.canvasPx[1]);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    deleteGL(gl, this.program, this.vao, this.quadBuffer, this.instanceBuffer);
  }
}
