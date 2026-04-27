// T028 — Cover-page emitter for Print Mode PDFs.
//
// References:
//   - specs/002-stencil-template-pdf/spec.md FR-009 (cover page contents),
//     FR-021 (a11y).
//   - specs/002-stencil-template-pdf/contracts/print-api.md § cover-page.
//   - specs/002-stencil-template-pdf/research.md §R4 (hole sizes),
//     §R9 (greyscale legibility).
//
// Layout:
//   - Title block at the top.
//   - 7-field observation/job summary block (FR-009).
//   - 4-circle hole-size legend, each labelled with its tool name +
//     diameter in mm. Each circle has a 'F' filled disc plus a thin 'S'
//     ring for B&W legibility (R9).
//   - Numbered step-by-step instructions block (cut → align → tape →
//     spray → peel).
//   - Accessibility: PDF metadata (`setProperties`) carries the full
//     accessible-text version; a separate invisible-text section emits
//     each summary field as a `doc.text(..., 0, -1)` call so screen
//     readers and `pdf-parse` extraction recover them (FR-021).
//
// All measurements are in millimetres (jsPDF created with `unit: 'mm'`).
// All drawing is greyscale-safe (black text + black strokes + black fills).

import { jsPDF } from "jspdf";
import { paperToMm, PAGE_MARGIN_MM } from "./tile-grid";
import {
  HOLE_DIAMETERS_MM,
  type PreflightSummary,
  type PrintJob,
  type SizeClass,
  type Surface,
} from "./types";
import { deriveSurfaces } from "./projection";

const SIZE_LABELS: Record<SizeClass, string> = {
  pencil: "Pencil",
  largeNail: "Large nail",
  smallNail: "Small nail",
  pin: "Pin",
};

const SIZE_ORDER: ReadonlyArray<SizeClass> = ["pencil", "largeNail", "smallNail", "pin"];

const PROJECT_TITLE = "Sky-Viewer Stencil — Print Job";

// 16-point compass for the bearing → cardinal label mapping.
const COMPASS_LABELS: ReadonlyArray<string> = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];

function bearingToCardinal(bearingDeg: number): string {
  let d = ((bearingDeg % 360) + 360) % 360;
  const idx = Math.round(d / 22.5) % 16;
  return COMPASS_LABELS[idx] ?? "N";
}

function formatUtcOffset(offsetMin: number): string {
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const hh = h.toString().padStart(2, "0");
  const mm = m.toString().padStart(2, "0");
  return `UTC${sign}${hh}:${mm}`;
}

function paperLabel(job: PrintJob): string {
  const p = job.outputOptions.paper;
  if (p.kind === "preset") {
    // Capitalize: "letter" -> "Letter".
    return p.preset.charAt(0).toUpperCase() + p.preset.slice(1);
  }
  return `Custom ${p.widthMm.toFixed(1)} × ${p.heightMm.toFixed(1)} mm`;
}

function unitsLabel(job: PrintJob): string {
  return job.outputOptions.displayUnits === "imperial" ? "Imperial (in/ft)" : "Metric (mm/m)";
}

function lengthInUserUnits(mm: number, units: "imperial" | "metric"): string {
  if (units === "imperial") {
    const inches = mm / 25.4;
    return `${inches.toFixed(1)} in`;
  }
  return `${mm.toFixed(0)} mm`;
}

function enabledSurfaceLabels(job: PrintJob): string {
  const surfaces = deriveSurfaces(job.room).filter((s: Surface) => s.enabled);
  if (surfaces.length === 0) return "(none)";
  return surfaces.map((s) => s.label).join(", ");
}

/**
 * Build the 7 cover-page summary lines that FR-009 requires. Returned
 * as a flat array (each element is one line) so the visible-text
 * renderer and the invisible-text a11y emitter can iterate the same
 * data without drift.
 */
function buildSummaryLines(job: PrintJob, summary: PreflightSummary): string[] {
  const obs = job.observation;
  const cardinal = bearingToCardinal(obs.bearingDeg);
  const utcOffset = formatUtcOffset(obs.utcOffsetMinutes);
  const locLabel = obs.location.label
    ? obs.location.label
    : `${obs.location.lat.toFixed(4)}°, ${obs.location.lon.toFixed(4)}°`;

  const units = job.outputOptions.displayUnits;
  const observerX = lengthInUserUnits(job.room.observerPositionMm.xMm, units);
  const observerY = lengthInUserUnits(job.room.observerPositionMm.yMm, units);
  const eyeHeight = lengthInUserUnits(job.room.observerPositionMm.eyeHeightMm, units);

  const c = summary.holeCountsByClass;

  return [
    // 1. Title (handled separately by the renderer; included here for a11y).
    `Project: ${PROJECT_TITLE}`,
    // 2. Observation.
    `Observation: ${locLabel}, ${obs.localDate} ${obs.localTime} ${obs.timeZone} (${utcOffset}), facing ${cardinal} (${obs.bearingDeg.toFixed(0)}°)`,
    // 3. Surfaces selected.
    `Surfaces: ${enabledSurfaceLabels(job)}`,
    // 4. Observer position.
    `Observer position: x=${observerX}, y=${observerY}, eye height=${eyeHeight}`,
    // 5. Page/hole counts.
    `Total tile pages: ${summary.tilePageCount}`,
    `Total holes: ${summary.totalHoles} (Pencil: ${c.pencil}, Large nail: ${c.largeNail}, Small nail: ${c.smallNail}, Pin: ${c.pin})`,
    // 6. Paper + units.
    `Paper: ${paperLabel(job)} — Units: ${unitsLabel(job)}`,
    // 7. Flags.
    `Block horizon on walls: ${job.outputOptions.blockHorizonOnWalls ? "ON" : "OFF"} — Include constellation lines: ${job.outputOptions.includeConstellationLines ? "ON" : "OFF"}`,
  ];
}

const INSTRUCTIONS: ReadonlyArray<string> = [
  "1. CUT each hole with the matching tool (use the legend below to size your tools).",
  "2. ALIGN adjacent tile pages by their corner alignment marks (1/8 in / 3 mm overlap).",
  "3. TAPE the pages onto your surface (painter's tape works well on most ceilings).",
  "4. SPRAY paint over the assembled stencil from ~30 cm (12 in) using even passes.",
  "5. PEEL the paper down once dry. Trim any dotted cut lines around fixtures.",
];

/**
 * Emit the cover page (page 1) of the print job's PDF onto `doc`.
 *
 * Caller responsibilities:
 *   - Pass a `jsPDF` whose first page already exists (the constructor
 *     allocates page 1). This emitter does NOT call `addPage`.
 *   - Set the desired paper size at construction time.
 */
export function emitCoverPage(
  doc: jsPDF,
  job: PrintJob,
  summary: PreflightSummary,
): void {
  const { widthMm: pageW, heightMm: pageH } = paperToMm(job.outputOptions.paper);
  const margin = PAGE_MARGIN_MM;
  const contentLeft = margin;
  const contentRight = pageW - margin;
  const contentWidth = contentRight - contentLeft;

  // Set up greyscale-safe defaults. (jsPDF accepts a single grayscale
  // value via its string overload; numeric values require 3-channel RGB.)
  doc.setDrawColor("0");
  doc.setFillColor("0");

  // ---- 1. Title block ------------------------------------------------------
  let y = margin + 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(PROJECT_TITLE, contentLeft, y);
  y += 8;

  // Underline.
  doc.setLineWidth(0.4);
  doc.line(contentLeft, y, contentRight, y);
  y += 6;

  // ---- 2. Summary block (FR-009 fields 2..7) -------------------------------
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const summaryLines = buildSummaryLines(job, summary);
  // Render lines 2..end visibly (skip line 0, which is the project title we
  // already drew above as a heading).
  for (let i = 1; i < summaryLines.length; i++) {
    const line = summaryLines[i] ?? "";
    // jsPDF doesn't word-wrap by default; use splitTextToSize for safety.
    const wrapped = doc.splitTextToSize(line, contentWidth);
    for (const ln of wrapped) {
      doc.text(ln, contentLeft, y);
      y += 5;
    }
  }
  y += 4;

  // ---- 3. Hole-size legend -------------------------------------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Hole-size legend (1:1 calibration)", contentLeft, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  // Layout: place the 4 circles in a single row, evenly spaced. Each cell
  // gets ~contentWidth/4 of horizontal space; the circle sits at the cell's
  // horizontal centre with the label below.
  const cellWidth = contentWidth / 4;
  const circleY = y + 8; // give vertical space for the largest (Pencil = 6 mm) circle
  const labelY = circleY + 10; // two lines of label below
  const diamY = labelY + 4;

  for (let i = 0; i < SIZE_ORDER.length; i++) {
    const cls = SIZE_ORDER[i];
    if (!cls) continue;
    const diameter = HOLE_DIAMETERS_MM[cls];
    const radius = diameter / 2;
    const cx = contentLeft + i * cellWidth + cellWidth / 2;

    // Filled disc + outer ring (R9: greyscale legibility).
    doc.circle(cx, circleY, radius, "F");
    doc.setLineWidth(0.2);
    doc.circle(cx, circleY, radius + 0.3, "S");

    // Tool name centred below.
    const labelText = SIZE_LABELS[cls];
    const diamText = `${diameter} mm`;
    const labelWidth = doc.getTextWidth(labelText);
    const diamWidth = doc.getTextWidth(diamText);
    doc.text(labelText, cx - labelWidth / 2, labelY);
    doc.text(diamText, cx - diamWidth / 2, diamY);
  }
  y = diamY + 6;

  // ---- 4. Step-by-step instructions ---------------------------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Instructions", contentLeft, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  for (const step of INSTRUCTIONS) {
    const wrapped = doc.splitTextToSize(step, contentWidth);
    for (const ln of wrapped) {
      doc.text(ln, contentLeft, y);
      y += 5;
    }
    y += 1;
  }

  // ---- 5. Accessibility (FR-021) ------------------------------------------
  // Set PDF metadata so screen readers / assistive tech expose the
  // observation summary as document properties.
  const a11ySubject = summaryLines.join(" | ");
  doc.setProperties({
    title: PROJECT_TITLE,
    subject: a11ySubject,
    author: "Sky-Viewer",
    creator: "Sky-Viewer Print Mode",
    keywords: "stencil, sky, stars, planetarium, print",
  });

  // Invisible-text annotations: emit each summary line as text positioned
  // off-page (negative y). jsPDF still writes the operator stream, so
  // pdf-parse and screen readers recover the strings.
  doc.setFontSize(1);
  for (const line of summaryLines) {
    doc.text(line, 0, -1);
  }
  // Restore body font size in case downstream callers extend page 1.
  doc.setFontSize(10);

  // Drawing-color reset is a no-op since we never changed it; pageH is
  // referenced to silence the unused-binding lint without polluting the
  // emitted stream.
  void pageH;
}
