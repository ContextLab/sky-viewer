// Render-layer public types. See contracts/observation-api.md §renderer.
//
// The renderer is the ONLY module in src/render/* that other packages
// depend on directly; all WebGL2 / Canvas2D internals live behind the
// Renderer interface so the app can swap the two implementations at
// runtime via feature detection.
//
// SkyState carries ALL per-frame state needed for rendering. It is
// produced by the app composition layer each frame from the current
// Observation (date, location, direction, FOV) plus the
// playback-advanced UTC instant. SkyDatasets carry the immutable
// catalogues loaded once at startup. Neither structure is mutated by
// the renderer.

import type { Observation } from '../app/types';
import type { Star } from '../astro/stars';
import type { Constellation } from '../astro/constellations';

/** Immutable catalogues loaded once; referenced by every frame. */
export interface SkyDatasets {
  stars: Star[];
  constellations: Constellation[];
}

/** Identifier for the Sun, Moon, and the eight major planets. */
export type BodyId =
  | 'sun'
  | 'moon'
  | 'mercury'
  | 'venus'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune';

/** Sun/Moon/planet apparent horizon coordinates and rendering hints. */
export interface RenderBody {
  id: BodyId;
  altDeg: number;
  azDeg: number;
  apparentMag: number;
  /** Sun, Moon only — drives billboard size. */
  angularDiameterArcsec?: number;
  /** Moon only — illuminated fraction 0..1. */
  phase?: number;
}

/**
 * Everything the renderer needs for one frame, computed by the
 * composition layer from the Observation + playback clock.
 */
export interface SkyState {
  /** UTC instant this frame represents, in epoch ms. */
  utcMs: number;
  /** User inputs (location, bearing, fov, …) driving projection. */
  observation: Observation;
  /** Sky background colour from twilight phase (see twilight.ts). */
  backgroundRgb: { r: number; g: number; b: number };
  /** Sun, Moon, planets with apparent horizon coordinates. */
  bodies: RenderBody[];
}

/**
 * Renderer contract. Both the WebGL2 primary and Canvas2D fallback
 * implement this interface (Principle IV: progressive enhancement).
 * Callers never care which they have — they call render() each frame.
 */
export interface Renderer {
  /** CSS size change or pixel-ratio change. Sets viewport + canvas size. */
  resize(widthCss: number, heightCss: number, pixelRatio: number): void;
  /** Commit one frame. Budget: ≤8 ms desktop, ≤16 ms mobile at default fixture. */
  render(state: SkyState, datasets: SkyDatasets): void;
  /** Release GPU / 2D resources. Safe to call multiple times. */
  dispose(): void;
  /** Which implementation is active. Used by tests and diagnostics. */
  readonly kind: 'webgl2' | 'canvas2d';
}
