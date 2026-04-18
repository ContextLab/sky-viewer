// Constellation line-figure pass.
//
// For each Constellation.lines entry (a pair of star HR ids), emit
// two vertices carrying the two stars' apparent (alt, az). The GPU
// draws them with gl.LINES. Lines with ANY endpoint below the horizon
// are culled on the CPU side (cheap) — straddling the horizon would
// otherwise draw a visible segment running through the ground region,
// which reads as a perspective glitch once the ground pass paints the
// horizon silhouette on top of the pre-rendered sky.

import type { Star } from '../../astro/stars';
import { precessStarToEpoch } from '../../astro/stars';
import { equatorialToHorizontal } from '../../astro/transforms';
import type { Constellation } from '../../astro/constellations';
import type { Observation } from '../../app/types';
import { isAboveHorizon } from '../projection';
import { LINE_VERT, LINE_FRAG } from './shaders';
import { compileProgram, makeVAO, deleteGL } from './gl-utils';

const DEG2RAD = Math.PI / 180;
const FLOATS_PER_VERTEX = 2; // altRad, azRad

export interface LinePassUniforms {
  bearingRad: number;
  pitchRad: number;
  fovRad: number;
  aspect: number;
  color: [number, number, number, number];
}

export class LinePass {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buffer: WebGLBuffer;

  private readonly uBearing: WebGLUniformLocation | null;
  private readonly uPitch: WebGLUniformLocation | null;
  private readonly uFov: WebGLUniformLocation | null;
  private readonly uAspect: WebGLUniformLocation | null;
  private readonly uColor: WebGLUniformLocation | null;

  private vertexData: Float32Array = new Float32Array(0);
  private vertexCount = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = compileProgram(gl, LINE_VERT, LINE_FRAG);

    this.uBearing = gl.getUniformLocation(this.program, 'uBearingRad');
    this.uPitch = gl.getUniformLocation(this.program, 'uPitchRad');
    this.uFov = gl.getUniformLocation(this.program, 'uFovRad');
    this.uAspect = gl.getUniformLocation(this.program, 'uAspect');
    this.uColor = gl.getUniformLocation(this.program, 'uLineColor');

    const b = gl.createBuffer();
    if (!b) throw new Error('LinePass: createBuffer failed');
    this.buffer = b;

    const aAltAzLoc = gl.getAttribLocation(this.program, 'aAltAz');
    this.vao = makeVAO(gl, () => {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      if (aAltAzLoc >= 0) {
        gl.enableVertexAttribArray(aAltAzLoc);
        gl.vertexAttribPointer(aAltAzLoc, 2, gl.FLOAT, false, 0, 0);
      }
    });
  }

  /**
   * Compute apparent alt/az for each star referenced by any
   * constellation line, then emit two vertices per kept line. Cache
   * the alt/az per star so we don't recompute it for the same HR
   * that appears in multiple lines.
   */
  update(
    observation: Observation,
    constellations: Constellation[],
    stars: Star[],
    utcMs: number,
  ): void {
    const latRad = observation.location.lat * DEG2RAD;
    const lonRad = observation.location.lon * DEG2RAD;

    // Build an id→Star lookup once per frame; cheap compared to the
    // per-star cost we're already paying in StarPass.
    const byId = new Map<number, Star>();
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i]!;
      byId.set(s.id, s);
    }

    // Cache the apparent alt/az for each HR we touch so we don't redo
    // precession + proper motion + horizontal conversion for the same
    // endpoint across multiple line segments.
    const cache = new Map<number, { altDeg: number; azDeg: number }>();
    const getAltAz = (hr: number): { altDeg: number; azDeg: number } | null => {
      const cached = cache.get(hr);
      if (cached) return cached;
      const s = byId.get(hr);
      if (!s) return null;
      const app = precessStarToEpoch(
        s.raJ2000Rad,
        s.decJ2000Rad,
        s.pmRaMasPerYr,
        s.pmDecMasPerYr,
        utcMs,
      );
      const h = equatorialToHorizontal(app.ra, app.dec, latRad, lonRad, utcMs);
      cache.set(hr, h);
      return h;
    };

    // Worst-case size: 4 floats per line segment (2 verts × 2 floats).
    let totalSegs = 0;
    for (let i = 0; i < constellations.length; i++) {
      totalSegs += constellations[i]!.lines.length;
    }
    const maxFloats = totalSegs * 2 * FLOATS_PER_VERTEX;
    if (this.vertexData.length < maxFloats) {
      this.vertexData = new Float32Array(maxFloats);
    }

    let write = 0;
    let verts = 0;
    for (let i = 0; i < constellations.length; i++) {
      const c = constellations[i]!;
      for (let j = 0; j < c.lines.length; j++) {
        const [hr1, hr2] = c.lines[j]!;
        const a = getAltAz(hr1);
        const b = getAltAz(hr2);
        if (!a || !b) continue;
        // Cull: ANY endpoint below the horizon → skip. We can't let
        // lines straddle the horizon because the rasterized segment
        // below the horizon would show as bright pixels overlapping
        // the ground silhouette (the ground pass cannot depth-cull
        // lines that are drawn after it).
        if (!isAboveHorizon(a.altDeg) || !isAboveHorizon(b.altDeg)) continue;
        this.vertexData[write] = a.altDeg * DEG2RAD;
        this.vertexData[write + 1] = a.azDeg * DEG2RAD;
        this.vertexData[write + 2] = b.altDeg * DEG2RAD;
        this.vertexData[write + 3] = b.azDeg * DEG2RAD;
        write += 4;
        verts += 2;
      }
    }
    this.vertexCount = verts;

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.vertexData.subarray(0, verts * FLOATS_PER_VERTEX),
      gl.DYNAMIC_DRAW,
    );
  }

  draw(u: LinePassUniforms): void {
    if (this.vertexCount === 0) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform1f(this.uBearing, u.bearingRad);
    gl.uniform1f(this.uPitch, u.pitchRad);
    gl.uniform1f(this.uFov, u.fovRad);
    gl.uniform1f(this.uAspect, u.aspect);
    gl.uniform4f(this.uColor, u.color[0], u.color[1], u.color[2], u.color[3]);
    gl.drawArrays(gl.LINES, 0, this.vertexCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    deleteGL(this.gl, this.program, this.vao, this.buffer);
  }
}
