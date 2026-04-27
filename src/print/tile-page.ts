// T029 — Tile-page emitter for Print Mode PDFs.
//
// References:
//   - specs/002-stencil-template-pdf/spec.md FR-010 (page contents),
//     FR-021 (a11y).
//   - specs/002-stencil-template-pdf/contracts/print-api.md § tile-page.
//   - specs/002-stencil-template-pdf/research.md §R9 (greyscale legibility).
//
// One emit produces ONE tile page, drawn onto whatever the current
// active page on `doc` is. The pdf-builder is responsible for adding a
// page (`doc.addPage()`) before calling this emitter for any tile
// after the cover page.
//
// Layout (page coords are mm; jsPDF created with `unit: 'mm'`):
//   - Margin = PAGE_MARGIN_MM (12 mm) on every side.
//   - Header band: page label + paint-side indicator at the top.
//   - Body: holes drawn at their tile-local (uMm − tile.uMin, vMm − tile.vMin)
//     coords, offset by the page margin.
//   - Corner alignment marks: small L-shapes 5 mm from each corner of the
//     printable area.
//   - Feature cutouts: dotted polylines (3 mm dash / 1.5 mm gap) with an
//     inline label per polygon.

import { jsPDF } from "jspdf";
import { paperToMm, PAGE_MARGIN_MM } from "./tile-grid";
import {
  HOLE_DIAMETERS_MM,
  type PrintJob,
  type RoomFeature,
  type Surface,
  type Tile,
} from "./types";

/** Length of each leg of the corner alignment L-marks. */
const ALIGN_MARK_LEG_MM = 6;

/** Inset of the alignment-mark corner from the printable rect's corner. */
const ALIGN_MARK_INSET_MM = 5;

/** Dotted-line pattern for no-paint feature cutouts (R9). */
const FEATURE_DASH_PATTERN: ReadonlyArray<number> = [3, 1.5];

const FEATURE_TYPE_LABELS: Record<RoomFeature["type"], string> = {
  lightFixture: "Light fixture",
  recessedLight: "Recessed light",
  window: "Window",
  door: "Door",
  closet: "Closet",
  other: "Feature",
};

function paintSideIndicatorText(surface: Surface): string {
  // ASCII-only — jsPDF's default Helvetica encoding breaks on Unicode
  // arrows (↑↓→), inserting spurious whitespace between every glyph
  // and harming both visual quality and pdf-parse text extraction.
  // We encode the side directionally with words instead.
  switch (surface.kind) {
    case "ceiling":
      return "Paint side UP (faces ceiling)";
    case "floor":
      return "Paint side DOWN (faces floor)";
    case "wall":
      return "Paint side OUT (faces wall)";
    default:
      return "Paint side: faces surface";
  }
}

function findFeatureById(job: PrintJob, id: string): RoomFeature | null {
  for (const f of job.room.features) if (f.id === id) return f;
  return null;
}

/** Compute polygon centroid in surface-local (u, v) coords. */
function polygonCentroid(
  pts: ReadonlyArray<{ uMm: number; vMm: number }>,
): { uMm: number; vMm: number } {
  if (pts.length === 0) return { uMm: 0, vMm: 0 };
  let su = 0;
  let sv = 0;
  for (const p of pts) {
    su += p.uMm;
    sv += p.vMm;
  }
  return { uMm: su / pts.length, vMm: sv / pts.length };
}

/**
 * Emit one tile page onto the active page of `doc`. The caller is
 * responsible for adding the page itself; this function only draws.
 */
export function emitTilePage(
  doc: jsPDF,
  tile: Tile,
  surface: Surface,
  job: PrintJob,
): void {
  const { widthMm: pageW, heightMm: pageH } = paperToMm(job.outputOptions.paper);
  const margin = PAGE_MARGIN_MM;

  // Printable rectangle (the area the tile occupies on the page).
  const printLeft = margin;
  const printTop = margin;
  const printRight = pageW - margin;
  const printBottom = pageH - margin;
  const printWidth = printRight - printLeft;

  // Map surface-local (u, v) to PDF-page (x, y). The tile's (uMin, vMin)
  // anchors at (printLeft, printTop). Y is page-down so v increases
  // downward — this matches jsPDF's coordinate system.
  function uToX(uMm: number): number {
    return printLeft + (uMm - tile.tileBoundsMm.uMinMm);
  }
  function vToY(vMm: number): number {
    return printTop + (vMm - tile.tileBoundsMm.vMinMm);
  }

  // Greyscale-safe defaults. (jsPDF: numeric setFillColor requires 3
  // channels; pass a string for single-channel greyscale.)
  doc.setDrawColor("0");
  doc.setFillColor("0");
  doc.setLineDashPattern([], 0);

  // ---- 1. Header band ------------------------------------------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  const pageLabel = `${surface.label} — row ${tile.row + 1}, col ${tile.col + 1}`;
  doc.text(pageLabel, printLeft, margin - 4);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const pageNumText = `Page ${tile.pageNumber}`;
  const pnWidth = doc.getTextWidth(pageNumText);
  doc.text(pageNumText, printRight - pnWidth, margin - 4);

  // Paint-side indicator: render at the very top edge above the printable rect
  // (still inside the unprintable margin band but readable).
  const paintText = paintSideIndicatorText(surface);
  // Centre it.
  const ptW = doc.getTextWidth(paintText);
  doc.text(paintText, printLeft + (printWidth - ptW) / 2, margin - 4);

  // ---- 2. Corner alignment marks ------------------------------------------
  doc.setLineWidth(0.3);
  doc.setLineDashPattern([], 0);
  drawCornerMark(doc, printLeft + ALIGN_MARK_INSET_MM, printTop + ALIGN_MARK_INSET_MM, "tl");
  drawCornerMark(doc, printRight - ALIGN_MARK_INSET_MM, printTop + ALIGN_MARK_INSET_MM, "tr");
  drawCornerMark(doc, printLeft + ALIGN_MARK_INSET_MM, printBottom - ALIGN_MARK_INSET_MM, "bl");
  drawCornerMark(
    doc,
    printRight - ALIGN_MARK_INSET_MM,
    printBottom - ALIGN_MARK_INSET_MM,
    "br",
  );

  // ---- 3. Feature cutouts (dotted polylines) -------------------------------
  if (tile.featureCutouts.length > 0) {
    doc.setLineWidth(0.4);
    doc.setLineDashPattern(FEATURE_DASH_PATTERN as number[], 0);
    for (const fc of tile.featureCutouts) {
      const poly = fc.clippedOutline;
      if (poly.length < 2) continue;
      // Draw closed polyline: P0 → P1 → … → P0.
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        if (!a || !b) continue;
        doc.line(uToX(a.uMm), vToY(a.vMm), uToX(b.uMm), vToY(b.vMm));
      }

      // Label inline at the centroid.
      const centroid = polygonCentroid(poly);
      const feature = findFeatureById(job, fc.featureId);
      const featureLabel = feature
        ? feature.label || FEATURE_TYPE_LABELS[feature.type]
        : "Feature";
      doc.setLineDashPattern([], 0); // text rendering ignores dash but reset for cleanliness
      doc.setFontSize(8);
      doc.text(featureLabel, uToX(centroid.uMm), vToY(centroid.vMm));
      // Re-enable dash for next feature.
      doc.setLineDashPattern(FEATURE_DASH_PATTERN as number[], 0);
    }
    // Reset dash for subsequent draws.
    doc.setLineDashPattern([], 0);
  }

  // ---- 4. Constellation segments (optional) -------------------------------
  if (tile.constellationSegments.length > 0) {
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([1, 1], 0);
    for (const seg of tile.constellationSegments) {
      doc.line(uToX(seg.aMm.uMm), vToY(seg.aMm.vMm), uToX(seg.bMm.uMm), vToY(seg.bMm.vMm));
    }
    doc.setLineDashPattern([], 0);
  }

  // ---- 5. Holes ------------------------------------------------------------
  doc.setLineWidth(0.15);
  for (const h of tile.holes) {
    const cx = uToX(h.surfaceUMm);
    const cy = vToY(h.surfaceVMm);
    const radius = HOLE_DIAMETERS_MM[h.sizeClass] / 2;

    // Filled disc.
    doc.setFillColor("0");
    doc.circle(cx, cy, radius, "F");
    // Thin outer ring for B&W contrast (R9).
    doc.setDrawColor("0");
    doc.circle(cx, cy, radius + 0.25, "S");
    // Star labels intentionally omitted from printouts (per user
    // feedback): names clutter the stencil and aren't useful when the
    // user is cutting the holes by hand.
  }

  // ---- 6. Accessibility annotations (FR-021) ------------------------------
  // Emit the tile's structured info as invisible text so pdf-parse and
  // screen readers can recover it.
  doc.setFontSize(1);
  doc.text(
    `${pageLabel} | Page ${tile.pageNumber} | Holes: ${tile.holes.length} | Cutouts: ${tile.featureCutouts.length}`,
    0,
    -1,
  );
  for (const fc of tile.featureCutouts) {
    const feature = findFeatureById(job, fc.featureId);
    if (!feature) continue;
    const paintFlag = feature.paint ? "paint" : "no-paint";
    doc.text(
      `Feature: ${FEATURE_TYPE_LABELS[feature.type]} '${feature.label}' on ${feature.surfaceId} (${paintFlag})`,
      0,
      -1,
    );
  }
  doc.setFontSize(10);
}

/** Draw a small L-shaped corner alignment mark at (x, y). */
function drawCornerMark(
  doc: jsPDF,
  x: number,
  y: number,
  corner: "tl" | "tr" | "bl" | "br",
): void {
  const L = ALIGN_MARK_LEG_MM;
  switch (corner) {
    case "tl":
      doc.line(x, y, x + L, y);
      doc.line(x, y, x, y + L);
      break;
    case "tr":
      doc.line(x, y, x - L, y);
      doc.line(x, y, x, y + L);
      break;
    case "bl":
      doc.line(x, y, x + L, y);
      doc.line(x, y, x, y - L);
      break;
    case "br":
      doc.line(x, y, x - L, y);
      doc.line(x, y, x, y - L);
      break;
  }
}
