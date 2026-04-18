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
  horizonNdcY,
} from '../projection';
import { BODY_TINTS, bodyBillboardSizePx } from '../webgl2/planet-pass';
import {
  groundColors,
  silhouetteSeed,
  SILHOUETTE_AMPLITUDE_NDC,
} from '../webgl2/ground-pass';
import { horizonSilhouette, hash21, valueNoise1D } from '../noise';

const DEG2RAD = Math.PI / 180;

/** Magnitude cutoff below which Canvas2D doesn't bother drawing. */
const CANVAS2D_MAG_LIMIT = 4.5;

/**
 * Paint the stylized ground for the Canvas2D fallback. Mirrors the
 * WebGL2 GROUND_FRAG: 2-octave fBm silhouette + 3-stop dark-earth
 * gradient + a cross-azimuth shading band + sparse pebble highlights
 * + a soft atmospheric distance haze at the horizon seam.
 *
 * This is a simplified version of the shader — the Canvas2D path
 * samples noise per CSS pixel column (too slow to run fbm2D), so we
 * approximate the GL shader's spatial texture by scattering stable
 * dots at the same (az, depth) cells the shader uses.
 *
 * Sampling strategy: 1° azimuth steps smooth-interpolated. At FOV=90°
 * this yields ~90 control points across the canvas, which is cheap
 * yet visually indistinguishable from per-pixel sampling for our
 * 0.06-NDC-amplitude silhouette.
 */
function drawGround(
  ctx: CanvasRenderingContext2D,
  bg: { r: number; g: number; b: number },
  bearingRad: number,
  pitchRad: number,
  fovRad: number,
  aspect: number,
  cssWidth: number,
  cssHeight: number,
): void {
  const horizonY = horizonNdcY(pitchRad, fovRad, aspect);
  // Entire screen is sky — nothing to paint.
  if (horizonY >= 1 + SILHOUETTE_AMPLITUDE_NDC) return;

  const { earthNear, earthMid, earthFar, haze, hazeAlpha } = groundColors(bg);
  const seed = silhouetteSeed(bearingRad);

  // Smooth-horizon pixel y.
  const smoothHorizonCssY =
    ndcToCssPixels(0, horizonY, cssWidth, cssHeight).py;

  // Silhouette polyline: sample at ~1° az steps across the horizontal
  // field of view. Always include the screen edges so the polygon
  // closes cleanly.
  const stepAzRad = Math.PI / 180;
  const halfFov = fovRad * 0.5;
  const stepsPerHalf = Math.max(2, Math.ceil(halfFov / stepAzRad));
  const totalSteps = stepsPerHalf * 2;
  type Pt = { x: number; y: number };
  const silhouette: Pt[] = [];
  for (let i = 0; i <= totalSteps; i++) {
    // ndcX from −1 (left) to +1 (right).
    const ndcX = -1 + (2 * i) / totalSteps;
    const az = bearingRad + ndcX * halfFov;
    const silNdcY =
      horizonY +
      horizonSilhouette(az, seed) * SILHOUETTE_AMPLITUDE_NDC;
    const { px, py } = ndcToCssPixels(ndcX, silNdcY, cssWidth, cssHeight);
    silhouette.push({ x: px, y: py });
  }

  // Clip to the ground region (polyline → bottom corners → close).
  ctx.save();
  ctx.beginPath();
  const first = silhouette[0]!;
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < silhouette.length; i++) {
    const pt = silhouette[i]!;
    ctx.lineTo(pt.x, pt.y);
  }
  ctx.lineTo(cssWidth, cssHeight);
  ctx.lineTo(0, cssHeight);
  ctx.closePath();
  ctx.clip();

  // --- BASE GRADIENT (3 stops: near → mid → far) ---------------------
  // Start at the smooth horizon so the silhouette above it still
  // fills with the near colour; end at the screen bottom.
  const gradStartY = Math.min(smoothHorizonCssY, cssHeight);
  const gradient = ctx.createLinearGradient(0, gradStartY, 0, cssHeight);
  const fmt = (c: [number, number, number]): string =>
    `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;
  gradient.addColorStop(0, fmt(earthNear));
  gradient.addColorStop(0.35, fmt(earthMid));
  gradient.addColorStop(1, fmt(earthFar));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  // --- AZIMUTH SHADING BANDS -----------------------------------------
  // Broad alpha overlays tied to 1-D noise on azimuth so panning makes
  // different swathes of ground read as lit / shadowed. Cheap: 12
  // vertical strips shaded per-column by valueNoise1D.
  const stripCount = 18;
  for (let s = 0; s < stripCount; s++) {
    const xNdcA = -1 + (2 * s) / stripCount;
    const xNdcB = -1 + (2 * (s + 1)) / stripCount;
    const azMid = bearingRad + ((xNdcA + xNdcB) * 0.5) * halfFov;
    const shade = valueNoise1D(azMid * 1.3 + seed * 0.21); // [0,1]
    // Signed variance, centred: -0.5..+0.5 → alpha overlay of
    // black (darken) or white (lighten).
    const variance = shade - 0.5;
    const alpha = Math.abs(variance) * 0.12;
    if (alpha < 0.005) continue;
    const colour = variance < 0 ? 'rgba(0,0,0,' : 'rgba(255,255,255,';
    ctx.fillStyle = `${colour}${alpha.toFixed(3)})`;
    const xA = ((xNdcA + 1) * 0.5) * cssWidth;
    const xB = ((xNdcB + 1) * 0.5) * cssWidth;
    ctx.fillRect(xA, 0, xB - xA + 1, cssHeight);
  }

  // --- PEBBLE / GRAIN HIGHLIGHTS -------------------------------------
  // Stable scatter of 1-pixel highlights using the same hash21 grid the
  // shader uses. Fade out near the ridge (so the silhouette stays
  // clean). Capped at ~400 pebbles per frame for performance.
  ctx.fillStyle = 'rgba(210, 180, 140, 0.35)'; // warm pebble tint
  const pebbleCols = 120;
  const pebbleRows = 40;
  const azRange = fovRad;
  const azBase = bearingRad - halfFov;
  for (let ci = 0; ci < pebbleCols; ci++) {
    for (let ri = 0; ri < pebbleRows; ri++) {
      const h = hash21(ci + 97, ri + 13);
      if (h < 0.985) continue;
      // Map (ci, ri) back to (az, depth-below-horizon in NDC).
      const az = azBase + (ci / pebbleCols) * azRange;
      const ndcX = -1 + (2 * ci) / pebbleCols;
      // depth in NDC below the smooth horizon.
      const depthNdc = (ri / pebbleRows) * (horizonY + 1);
      const silNdcY =
        horizonY + horizonSilhouette(az, seed) * SILHOUETTE_AMPLITUDE_NDC;
      const fragNdcY = silNdcY - depthNdc;
      if (fragNdcY < -1) continue;
      // Pebble fade: depth > 0.02 ndc (≈1% of screen height) before
      // pebbles start appearing.
      if (depthNdc < 0.02) continue;
      const { px, py } = ndcToCssPixels(ndcX, fragNdcY, cssWidth, cssHeight);
      ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
    }
  }

  // --- DISTANCE HAZE -------------------------------------------------
  // Soft atmospheric haze band at the smooth horizon, fading downward
  // over ~5% of screen height. Drawn last so it overlays the texture.
  const hazePx = Math.max(12, cssHeight * 0.05);
  const hazeGrad = ctx.createLinearGradient(
    0,
    smoothHorizonCssY,
    0,
    smoothHorizonCssY + hazePx,
  );
  const hr = Math.round(haze[0] * 255);
  const hg = Math.round(haze[1] * 255);
  const hb = Math.round(haze[2] * 255);
  hazeGrad.addColorStop(0, `rgba(${hr}, ${hg}, ${hb}, ${hazeAlpha})`);
  hazeGrad.addColorStop(1, `rgba(${hr}, ${hg}, ${hb}, 0)`);
  ctx.fillStyle = hazeGrad;
  ctx.fillRect(0, smoothHorizonCssY, cssWidth, hazePx);

  ctx.restore();
}

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
    const pitchRad = obs.pitchDeg * DEG2RAD;
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
      const ndc = projectAltAzDegToNdc(p.altDeg, p.azDeg, bearingRad, pitchRad, fovRad, aspect);
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
    //    lazily fill them in as needed. Gated by the Constellation lines
    //    layer toggle (obs.layers.constellationLines).
    const lineCache = projById; // alias — same structure, adds on demand
    if (obs.layers.constellationLines) {
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
        // Cull: ANY endpoint below horizon → skip. Straddling lines
        // would otherwise paint through the ground silhouette (same
        // reasoning as the WebGL2 line pass).
        if (!isAboveHorizon(a.altDeg) || !isAboveHorizon(b.altDeg)) continue;
        // Drop wrap-around lines (endpoints on opposite sides of observer).
        let dAz = Math.abs(a.azDeg - b.azDeg);
        if (dAz > 180) dAz = 360 - dAz;
        if (dAz > 90) continue;
        const pa = projectAltAzDegToNdc(a.altDeg, a.azDeg, bearingRad, pitchRad, fovRad, aspect);
        const pb = projectAltAzDegToNdc(b.altDeg, b.azDeg, bearingRad, pitchRad, fovRad, aspect);
        if (!pa || !pb) continue;
        const A = ndcToCssPixels(pa.x, pa.y, cssWidth, cssHeight);
        const B = ndcToCssPixels(pb.x, pb.y, cssWidth, cssHeight);
        ctx.moveTo(A.px, A.py);
        ctx.lineTo(B.px, B.py);
      }
    }
    ctx.stroke();
    } // end if (obs.layers.constellationLines)

    // 4. Sun, Moon, planets as Unicode glyphs tinted per body.
    const canvasWidthPx = cssWidth * pixelRatio;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < state.bodies.length; i++) {
      const body = state.bodies[i]!;
      if (!isAboveHorizon(body.altDeg)) continue;
      const ndc = projectAltAzDegToNdc(body.altDeg, body.azDeg, bearingRad, pitchRad, fovRad, aspect);
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

    // 5. Ground LAST — overdraws any stars/lines/planets that would
    //    otherwise show through the ground (the user sees a solid
    //    terrain, not perspective ghosts). Matches the WebGL2 render
    //    order in src/render/renderer.ts.
    drawGround(ctx, bg, bearingRad, pitchRad, fovRad, aspect, cssWidth, cssHeight);
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
