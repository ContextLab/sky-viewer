// Renderer factory.
//
// Feature-detects WebGL2. If present, constructs the WebGL2 renderer
// (StarPass + LinePass + PlanetPass behind a shared GL context).
// Otherwise returns the Canvas2D fallback.
//
// Both implementations satisfy the `Renderer` interface; callers
// can't and shouldn't care which one they got.

import type { Renderer, SkyState, SkyDatasets } from './types';
import { createCanvas2DRenderer } from './canvas2d/fallback';
import { StarPass } from './webgl2/star-pass';
import { PlanetPass } from './webgl2/planet-pass';
import { LinePass } from './webgl2/line-pass';

const DEG2RAD = Math.PI / 180;

/**
 * Decide between WebGL2 and Canvas2D at runtime. WebGL2 context
 * creation is wrapped in try/catch because some sandboxed environments
 * (including older iOS Safari in private mode) throw rather than
 * returning null.
 */
export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', {
      antialias: true,
      premultipliedAlpha: true,
      alpha: false,
    });
  } catch {
    gl = null;
  }
  if (gl) {
    try {
      return createWebGL2Renderer(canvas, gl);
    } catch (err) {
      // If any pass fails to compile (e.g. driver quirk), fall back
      // to Canvas2D rather than rendering a blank screen. The error
      // is intentionally not rethrown: Principle IV, progressive
      // enhancement.
      console.warn('createRenderer: WebGL2 init failed, falling back to Canvas2D', err);
    }
  }
  return createCanvas2DRenderer(canvas);
}

/**
 * Build the WebGL2 renderer from a live context. Owns the three
 * passes, the shared canvas sizing, and the global GL state
 * (blending, viewport). Not exported beyond this module — callers go
 * through `createRenderer`.
 */
function createWebGL2Renderer(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext): Renderer {
  const starPass = new StarPass(gl);
  const linePass = new LinePass(gl);
  const planetPass = new PlanetPass(gl);

  let cssWidth = canvas.clientWidth || canvas.width || 1;
  let cssHeight = canvas.clientHeight || canvas.height || 1;
  let pixelRatio = (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;

  const t0 = (globalThis as { performance?: Performance }).performance?.now() ?? Date.now();

  function resize(nextCssWidth: number, nextCssHeight: number, nextPixelRatio: number): void {
    cssWidth = Math.max(1, Math.floor(nextCssWidth));
    cssHeight = Math.max(1, Math.floor(nextCssHeight));
    pixelRatio = Math.max(1, nextPixelRatio);
    canvas.width = Math.floor(cssWidth * pixelRatio);
    canvas.height = Math.floor(cssHeight * pixelRatio);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function render(state: SkyState, datasets: SkyDatasets): void {
    const obs = state.observation;
    const bearingRad = obs.bearingDeg * DEG2RAD;
    const pitchRad = obs.pitchDeg * DEG2RAD;
    const fovRad = obs.fovDeg * DEG2RAD;
    const aspect = cssWidth / cssHeight;
    const nowSec =
      ((globalThis as { performance?: Performance }).performance?.now() ?? Date.now()) - t0;

    // Keep the viewport in sync in case the client forgot to call resize().
    if (gl.drawingBufferWidth !== canvas.width || gl.drawingBufferHeight !== canvas.height) {
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    // 1. Clear with the twilight-driven sky colour. WebGL expects
    //    clear-color components in 0..1.
    const bg = state.backgroundRgb;
    gl.clearColor(bg.r / 255, bg.g / 255, bg.b / 255, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // 2. Additive blending for stars and planets (so overlapping
    //    discs brighten rather than cut out). Constellation lines use
    //    the same state — straight rgba over the background looks
    //    fine because the alpha channel is low.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    const canvasPx: [number, number] = [canvas.width, canvas.height];
    const commonUniforms = {
      bearingRad,
      pitchRad,
      fovRad,
      aspect,
      timeSec: nowSec / 1000,
      canvasPx,
    };

    // 3. Constellation lines first so stars draw on top of them.
    linePass.update(obs, datasets.constellations, datasets.stars, state.utcMs);
    linePass.draw({
      bearingRad,
      pitchRad,
      fovRad,
      aspect,
      color: [0.7, 0.78, 0.95, 0.35],
    });

    // 4. Stars.
    starPass.update(obs, datasets.stars, state.utcMs);
    starPass.draw(commonUniforms);

    // 5. Planets (drawn last so they sit atop stars).
    planetPass.update(state, canvas.width);
    planetPass.draw(commonUniforms);
  }

  function dispose(): void {
    starPass.dispose();
    linePass.dispose();
    planetPass.dispose();
  }

  resize(cssWidth, cssHeight, pixelRatio);

  const renderer: Renderer = {
    kind: 'webgl2',
    resize,
    render,
    dispose,
  };
  return renderer;
}
