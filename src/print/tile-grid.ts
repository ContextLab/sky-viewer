// T012–T014 — Tile-grid layout, hole-to-tile assignment, and feature
// outline clipping for Print Mode. Pure functions; no DOM.
//
// Cell sizing (T012):
//   - Paper minus 12 mm margin on every side gives the printable area
//     used as the per-tile cell.
//   - cols = ceil(surface.widthMm / cellWidthMm)
//   - rows = ceil(surface.heightMm / cellHeightMm)
//
// Hole assignment (T013):
//   - Primary tile: floor(uMm/cellW), floor(vMm/cellH).
//   - Holes within `EDGE_TOLERANCE_MM` (½″ = 12.7 mm) of any tile
//     boundary are emitted on adjacent tiles too (FR-012, SC-006).
//
// Feature clipping (T014):
//   - Sutherland-Hodgman polygon clipping against each tile's axis-
//     aligned rectangle. Implemented inline (~30 lines).

import type { FeatureCutout, Hole, PaperSize, RoomFeature, Surface } from "./types";

/** Margin per side, mm. Matches research.md §R3 / FR-018 spec. */
export const PAGE_MARGIN_MM = 12;

/** ½″ in mm — the split-tile tolerance from FR-012 / SC-006. */
export const EDGE_TOLERANCE_MM = 12.7;

export interface TileGrid {
  rows: number;
  cols: number;
  cellWidthMm: number;
  cellHeightMm: number;
}

/** Map key for per-tile collections. Format: `${row},${col}`, 0-indexed. */
export type TileKey = string;

export function tileKey(row: number, col: number): TileKey {
  return `${row},${col}`;
}

// ---------------------------------------------------------------------------
// T012 — computeTileGrid
// ---------------------------------------------------------------------------

/** Preset paper sizes in mm, portrait orientation (width = short side). */
const PAPER_PRESETS_MM: Record<string, { widthMm: number; heightMm: number }> = {
  letter: { widthMm: 215.9, heightMm: 279.4 },
  legal: { widthMm: 215.9, heightMm: 355.6 },
  tabloid: { widthMm: 279.4, heightMm: 431.8 },
  a3: { widthMm: 297, heightMm: 420 },
  a4: { widthMm: 210, heightMm: 297 },
  a5: { widthMm: 148, heightMm: 210 },
};

export function paperToMm(paper: PaperSize): { widthMm: number; heightMm: number } {
  if (paper.kind === "preset") {
    return PAPER_PRESETS_MM[paper.preset] ?? PAPER_PRESETS_MM.letter!;
  }
  return { widthMm: paper.widthMm, heightMm: paper.heightMm };
}

/**
 * Returns `{ rows, cols, cellWidthMm, cellHeightMm }` for a Surface
 * tiled by the chosen paper at PAGE_MARGIN_MM per side.
 *
 * `cellWidthMm` and `cellHeightMm` are the printable area (paper minus
 * margins). `rows`/`cols` are at least 1 — even a degenerate-zero
 * surface emits one (blank) tile so FR-014 holds.
 */
export function computeTileGrid(surface: Surface, paper: PaperSize): TileGrid {
  const { widthMm: paperW, heightMm: paperH } = paperToMm(paper);
  const cellWidthMm = Math.max(1, paperW - 2 * PAGE_MARGIN_MM);
  const cellHeightMm = Math.max(1, paperH - 2 * PAGE_MARGIN_MM);
  const cols = Math.max(1, Math.ceil(surface.widthMm / cellWidthMm));
  const rows = Math.max(1, Math.ceil(surface.heightMm / cellHeightMm));
  return { rows, cols, cellWidthMm, cellHeightMm };
}

// ---------------------------------------------------------------------------
// T013 — assignHolesToTiles
// ---------------------------------------------------------------------------

/**
 * For each hole, determine its primary `(row, col)` from the floor
 * division of its surface coords by the cell dimensions, then also
 * emit it on adjacent tiles if it falls within EDGE_TOLERANCE_MM of
 * any tile boundary (FR-012). The same `Hole` record is referenced
 * from each adjacent tile (no copy).
 */
export function assignHolesToTiles(
  holes: ReadonlyArray<Hole>,
  surface: Surface,
  grid: TileGrid,
): Map<TileKey, Hole[]> {
  const out = new Map<TileKey, Hole[]>();
  const { rows, cols, cellWidthMm, cellHeightMm } = grid;

  function push(row: number, col: number, hole: Hole): void {
    if (row < 0 || row >= rows || col < 0 || col >= cols) return;
    const key = tileKey(row, col);
    let list = out.get(key);
    if (!list) {
      list = [];
      out.set(key, list);
    }
    // Avoid double-pushing the same hole on the same tile.
    if (!list.includes(hole)) list.push(hole);
  }

  for (const h of holes) {
    if (h.surfaceUMm < 0 || h.surfaceUMm > surface.widthMm) continue;
    if (h.surfaceVMm < 0 || h.surfaceVMm > surface.heightMm) continue;
    const cBase = Math.floor(h.surfaceUMm / cellWidthMm);
    const rBase = Math.floor(h.surfaceVMm / cellHeightMm);
    const c = Math.min(Math.max(cBase, 0), cols - 1);
    const r = Math.min(Math.max(rBase, 0), rows - 1);
    push(r, c, h);

    // Distance from the hole to each of the four candidate boundaries
    // around its primary tile.
    const uLeft = c * cellWidthMm;
    const uRight = (c + 1) * cellWidthMm;
    const vTop = r * cellHeightMm;
    const vBottom = (r + 1) * cellHeightMm;
    const nearLeft = h.surfaceUMm - uLeft <= EDGE_TOLERANCE_MM;
    const nearRight = uRight - h.surfaceUMm <= EDGE_TOLERANCE_MM;
    const nearTop = h.surfaceVMm - vTop <= EDGE_TOLERANCE_MM;
    const nearBottom = vBottom - h.surfaceVMm <= EDGE_TOLERANCE_MM;

    if (nearLeft) push(r, c - 1, h);
    if (nearRight) push(r, c + 1, h);
    if (nearTop) push(r - 1, c, h);
    if (nearBottom) push(r + 1, c, h);
    // Diagonal neighbours when within tolerance of both axes (corner case).
    if (nearLeft && nearTop) push(r - 1, c - 1, h);
    if (nearRight && nearTop) push(r - 1, c + 1, h);
    if (nearLeft && nearBottom) push(r + 1, c - 1, h);
    if (nearRight && nearBottom) push(r + 1, c + 1, h);
  }

  return out;
}

// ---------------------------------------------------------------------------
// T014 — clipFeaturesToTiles
// ---------------------------------------------------------------------------

interface Pt2D {
  uMm: number;
  vMm: number;
}

/**
 * Sutherland-Hodgman polygon clip against an axis-aligned rectangle.
 * Returns the (possibly empty) clipped polygon. Handles convex AND
 * concave subjects; produces correct results for our use case where
 * the clip window is always a rectangle (always convex).
 */
function clipPolygonToRect(
  subject: ReadonlyArray<Pt2D>,
  uMin: number,
  vMin: number,
  uMax: number,
  vMax: number,
): Pt2D[] {
  // Each clip edge is one side of the rect; the inside-test direction
  // depends on which edge we're clipping against.
  const edges: Array<{ keep: (p: Pt2D) => boolean; intersect: (a: Pt2D, b: Pt2D) => Pt2D }> = [
    {
      keep: (p) => p.uMm >= uMin,
      intersect: (a, b) => intersectVertical(a, b, uMin),
    },
    {
      keep: (p) => p.uMm <= uMax,
      intersect: (a, b) => intersectVertical(a, b, uMax),
    },
    {
      keep: (p) => p.vMm >= vMin,
      intersect: (a, b) => intersectHorizontal(a, b, vMin),
    },
    {
      keep: (p) => p.vMm <= vMax,
      intersect: (a, b) => intersectHorizontal(a, b, vMax),
    },
  ];

  let output: Pt2D[] = subject.map((p) => ({ uMm: p.uMm, vMm: p.vMm }));
  for (const edge of edges) {
    if (output.length === 0) break;
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (!cur || !prev) continue;
      const curIn = edge.keep(cur);
      const prevIn = edge.keep(prev);
      if (curIn) {
        if (!prevIn) output.push(edge.intersect(prev, cur));
        output.push(cur);
      } else if (prevIn) {
        output.push(edge.intersect(prev, cur));
      }
    }
  }
  return output;
}

function intersectVertical(a: Pt2D, b: Pt2D, uClip: number): Pt2D {
  const t = (uClip - a.uMm) / (b.uMm - a.uMm);
  return { uMm: uClip, vMm: a.vMm + t * (b.vMm - a.vMm) };
}

function intersectHorizontal(a: Pt2D, b: Pt2D, vClip: number): Pt2D {
  const t = (vClip - a.vMm) / (b.vMm - a.vMm);
  return { uMm: a.uMm + t * (b.uMm - a.uMm), vMm: vClip };
}

/**
 * For each NO-PAINT feature on the given surface, clip its outline
 * against every tile rect that it overlaps and emit a FeatureCutout
 * keyed by TileKey. PAINT features are skipped (they don't produce
 * cutouts on the stencil).
 */
export function clipFeaturesToTiles(
  features: ReadonlyArray<RoomFeature>,
  surface: Surface,
  grid: TileGrid,
): Map<TileKey, FeatureCutout[]> {
  const out = new Map<TileKey, FeatureCutout[]>();
  const { rows, cols, cellWidthMm, cellHeightMm } = grid;

  for (const f of features) {
    if (f.surfaceId !== surface.id) continue;
    if (f.paint) continue;
    if (f.outline.length < 3) continue;

    // Determine the bounding rect of the feature in surface-local coords
    // and only clip against tiles that overlap it.
    let uMin = Infinity;
    let uMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const p of f.outline) {
      if (p.uMm < uMin) uMin = p.uMm;
      if (p.uMm > uMax) uMax = p.uMm;
      if (p.vMm < vMin) vMin = p.vMm;
      if (p.vMm > vMax) vMax = p.vMm;
    }
    const cMin = Math.max(0, Math.floor(uMin / cellWidthMm));
    const cMax = Math.min(cols - 1, Math.floor(uMax / cellWidthMm));
    const rMin = Math.max(0, Math.floor(vMin / cellHeightMm));
    const rMax = Math.min(rows - 1, Math.floor(vMax / cellHeightMm));

    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        const u0 = c * cellWidthMm;
        const u1 = (c + 1) * cellWidthMm;
        const v0 = r * cellHeightMm;
        const v1 = (r + 1) * cellHeightMm;
        const clipped = clipPolygonToRect(f.outline, u0, v0, u1, v1);
        if (clipped.length < 3) continue;
        const key = tileKey(r, c);
        let list = out.get(key);
        if (!list) {
          list = [];
          out.set(key, list);
        }
        list.push({ featureId: f.id, clippedOutline: clipped });
      }
    }
  }

  return out;
}
