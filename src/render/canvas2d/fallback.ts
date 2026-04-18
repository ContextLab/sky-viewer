// Canvas2D renderer — the no-WebGL fallback.
//
// Goals (per FR-012, SC-004, research.md R7):
//   1. Still be legible on devices without WebGL2.
//   2. Use the SAME projection as the WebGL2 path so both outputs
//      agree to within pixel rounding. Both paths import
//      `projectAltAzDegToNdc` from src/render/projection.ts.
//   3. Stay under ~16 ms for ~500 stars at magnitude ≤ 4.5.
//
// Simplifications relative to the WebGL2 path (all explicitly
// mentioned in research.md R7):
//   - Cut-off magnitude is 4.5 instead of 6.5 (fewer stars → less fill).
//   - No twinkle, no blur, no additive-blend halos.
//   - Constellation lines are straight strokes.
//   - Planets and Sun/Moon are drawn as Unicode glyphs with a tinted
//     fillStyle so they read distinctly.

import { precessStarToEpoch } from '../../astro/stars';
import { equatorialToHorizontal } from '../../astro/transforms';
import type { Renderer, SkyDatasets, SkyState, BodyId } from '../types';
import {
  projectAltAzDegToNdc,
  ndcToCssPixels,
  starRadiusPx,
  starColorFromBvIndex,
  isAboveHorizon,
} from '../projection';
import { BODY_TINTS, bodyBillboardSizePx } from '../webgl2/planet-pass';

const DEG2RAD = Math.PI / 180;

/** Magnitude cutoff below which Canvas2D doesn't bother drawing. */
const CANVAS2D_MAG_LIMIT = 4.5;

/** Unicode glyphs for each body, per spec's fallback plan. */
const BODY_GLYPH: Readonly<Record<BodyId, string>> = {
  sun: '\u2609',    // ☉
  moon: '\u263D',   // ☽
  mercury: '\u263F', // ☿
  venus: '\u2640',   // ♀
  mars: '\u2642',    // ♂
  jupiter: '\u2643', // ♃
  saturn: '\u2644',  // ♄
  uranus: '\u2645',  // ♅
  neptune: '\u2646', // ♆
};

/**
 * Build a `Renderer` backed by a Canvas2D context. The canvas is
 * sized according to `resize()`; until `resize()` is called we use
 * the canvas's current backing-store dimensions.
 */
export function createCanvas2DRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctxMaybe = canvas.getContext('2d', { alpha: false });
  if (!ctxMaybe) {
    throw new Error('createCanvas2DRenderer: canvas.getContext("2d") returned null');
  }
  // Alias to a non-null const so closures below capture a narrowed type.
  const ctx: CanvasRenderingContext2D = ctxMaybe;

  let cssWidth = canvas.clientWidth || canvas.width;
  let cssHeight = canvas.clientHeight || canvas.height;
  let pixelRatio = (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;

  function resize(nextCssWidth: number, nextCssHeight: number, nextPixelRatio: number): void {
    cssWidth = Math.max(1, Math.floor(nextCssWidth));
    cssHeight = Math.max(1, Math.floor(nextCssHeight));
    pixelRatio = Math.max(1, nextPixelRatio);
    canvas.width = Math.floor(cssWidth * pixelRatio);
    canvas.height = Math.floor(cssHeight * pixelRatio);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    // Reset the transform then scale by pixel ratio so subsequent
    // draw calls can use CSS-pixel coordinates directly.
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  function renderOne(state: SkyState, datasets: SkyDatasets): void {
    const obs = state.observation;
    const bearingRad = obs.bearingDeg * DEG2RAD;
    const fovRad = obs.fovDeg * DEG2RAD;
    const aspect = cssWidth / cssHeight;

    // 1. Clear with the twilight-driven sky colour.
    const bg = state.backgroundRgb;
    ctx.fillStyle = `rgb(${bg.r}, ${bg.g}, ${bg.b})`;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    // Pre-compute per-star apparent alt/az once, since both the star
    // pass and the line pass consume them.
    const latRad = obs.location.lat * DEG2RAD;
    const lonRad = obs.location.lon * DEG2RAD;
    type Projected = { altDeg: number; azDeg: number; vmag: number; bv: number };
    const projById = new Map<number, Projected>();
    for (let i = 0; i < datasets.stars.length; i++) {
      const s = datasets.stars[i]!;
      // Skip faint stars up-front for Canvas2D perf.
      if (s.vmag > CANVAS2D_MAG_LIMIT) continue;
      const app = precessStarToEpoch(
        s.raJ2000Rad,
        s.decJ2000Rad,
        s.pmRaMasPerYr,
        s.pmDecMasPerYr,
        state.utcMs,
      );
      const h = equatorialToHorizontal(app.ra, app.dec, latRad, lonRad, state.utcMs);
      projById.set(s.id, { altDeg: h.altDeg, azDeg: h.azDeg, vmag: s.vmag, bv: s.bvIndex });
    }

    // 2. Stars. `projById` was already magnitude-filtered.
    for (const p of projById.values()) {
      if (!isAboveHorizon(p.altDeg)) continue;
      const ndc = projectAltAzDegToNdc(p.altDeg, p.azDeg, bearingRad, fovRad, aspect);
      if (!ndc) continue;
      if (Math.abs(ndc.x) > 1.05 || Math.abs(ndc.y) > 1.05) continue;
      const { px, py } = ndcToCssPixels(ndc.x, ndc.y, cssWidth, cssHeight);
      const radius = starRadiusPx(p.vmag);
      const c = starColorFromBvIndex(p.bv);
      ctx.fillStyle = `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Constellation lines. The line pass reuses apparent alt/az for
    //    endpoints drawn in the star pass; for lines referencing stars
    //    we dropped (magnitude > 4.5) we still need their alt/az, so we
    //    lazily fill them in as needed.
    const lineCache = projById; // alias — same structure, adds on demand
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(180, 200, 240, 0.35)';
    ctx.beginPath();
    for (let i = 0; i < datasets.constellations.length; i++) {
      const c = datasets.constellations[i]!;
      for (let j = 0; j < c.lines.length; j++) {
        const [hr1, hr2] = c.lines[j]!;
        let a = lineCache.get(hr1);
        let b = lineCache.get(hr2);
        if (!a) {
          const s = datasets.stars.find((x) => x.id === hr1);
          if (!s) continue;
          const app = precessStarToEpoch(
            s.raJ2000Rad,
            s.decJ2000Rad,
            s.pmRaMasPerYr,
            s.pmDecMasPerYr,
            state.utcMs,
          );
          const h = equatorialToHorizontal(app.ra, app.dec, latRad, lonRad, state.utcMs);
          a = { altDeg: h.altDeg, azDeg: h.azDeg, vmag: s.vmag, bv: s.bvIndex };
          lineCache.set(hr1, a);
        }
        if (!b) {
          const s = datasets.stars.find((x) => x.id === hr2);
          if (!s) continue;
          const app = precessStarToEpoch(
            s.raJ2000Rad,
            s.decJ2000Rad,
            s.pmRaMasPerYr,
            s.pmDecMasPerYr,
            state.utcMs,
          );
          const h = equatorialToHorizontal(app.ra, app.dec, latRad, lonRad, state.utcMs);
          b = { altDeg: h.altDeg, azDeg: h.azDeg, vmag: s.vmag, bv: s.bvIndex };
          lineCache.set(hr2, b);
        }
        if (!isAboveHorizon(a.altDeg) && !isAboveHorizon(b.altDeg)) continue;
        const pa = projectAltAzDegToNdc(a.altDeg, a.azDeg, bearingRad, fovRad, aspect);
        const pb = projectAltAzDegToNdc(b.altDeg, b.azDeg, bearingRad, fovRad, aspect);
        if (!pa || !pb) continue;
        const A = ndcToCssPixels(pa.x, pa.y, cssWidth, cssHeight);
        const B = ndcToCssPixels(pb.x, pb.y, cssWidth, cssHeight);
        ctx.moveTo(A.px, A.py);
        ctx.lineTo(B.px, B.py);
      }
    }
    ctx.stroke();

    // 4. Sun, Moon, planets as Unicode glyphs tinted per body.
    const canvasWidthPx = cssWidth * pixelRatio;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < state.bodies.length; i++) {
      const body = state.bodies[i]!;
      if (!isAboveHorizon(body.altDeg)) continue;
      const ndc = projectAltAzDegToNdc(body.altDeg, body.azDeg, bearingRad, fovRad, aspect);
      if (!ndc) continue;
      if (Math.abs(ndc.x) > 1.05 || Math.abs(ndc.y) > 1.05) continue;
      const { px, py } = ndcToCssPixels(ndc.x, ndc.y, cssWidth, cssHeight);

      // Size: Sun/Moon use their angular-diameter-driven pixel size;
      // planets get a flat readable size.
      const sizePx = bodyBillboardSizePx(body, fovRad, canvasWidthPx);
      const renderSize =
        sizePx > 0 ? Math.max(sizePx / pixelRatio, 10) : 14;
      const tint = BODY_TINTS[body.id];
      ctx.fillStyle = `rgb(${Math.round(tint.r * 255)}, ${Math.round(tint.g * 255)}, ${Math.round(tint.b * 255)})`;
      ctx.font = `${Math.round(renderSize)}px system-ui, "Segoe UI Symbol", "Apple Color Emoji", sans-serif`;
      ctx.fillText(BODY_GLYPH[body.id], px, py);
    }
  }

  function dispose(): void {
    // Canvas2D has no GPU resources to release. Clear the canvas so a
    // subsequent `getContext('webgl2')` call isn't blocked by the 2d
    // context holding on to state visually.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // Initialise with a resize to the canvas's current element size so
  // the first call to render() draws into a correctly-sized backing
  // store even if the caller forgets the explicit resize.
  resize(cssWidth, cssHeight, pixelRatio);

  const renderer: Renderer = {
    kind: 'canvas2d',
    resize,
    render: renderOne,
    dispose,
  };
  return renderer;
}
