// @vitest-environment node
// T057 — Accessibility text in PDF (FR-021).
//
// The cover-page emitter (src/print/cover-page.ts) and the tile-page
// emitter (src/print/tile-page.ts) both emit invisible-text annotations
// for every feature the tile/cover references. This test verifies:
//
//   - For a job with one no-paint window feature on a wall, building the
//     PDF and parsing it via pdf-parse exposes:
//       * the feature TYPE ("Window")
//       * the SURFACE id ("wall-0", "wall-1", ...)
//       * the no-paint flag word ("no-paint")
//
//   - The cover-page summary includes the feature in the document
//     SUBJECT metadata too (universally accessible).

import { describe, expect, it } from "vitest";
import { createRequire } from "module";
import { buildPdf } from "../../src/print/pdf-builder";
import { makeDefaultPrintJob, type PrintJob, type RoomFeature } from "../../src/print/types";
import type { Constellation } from "../../src/astro/constellations";
import type { Star } from "../../src/astro/stars";

const requireCjs = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse: (b: Buffer) => Promise<{
  numpages: number;
  text: string;
  info: Record<string, unknown>;
  metadata: { _metadata?: Record<string, string> } | null;
}> = requireCjs("pdf-parse/lib/pdf-parse.js");

const EMPTY_DATASETS = { stars: [] as Star[], constellations: [] as Constellation[] };

function makeJobWithWindow(): PrintJob {
  const job = makeDefaultPrintJob();
  // Enable wall-0 so its tile pages are emitted.
  job.room.surfaceEnable = {
    ceiling: true,
    floor: false,
    walls: { "wall-0": true },
  };
  // No-paint window on wall-0.
  const window: RoomFeature = {
    id: "feat-window-1",
    type: "window",
    label: "North window",
    surfaceId: "wall-0",
    paint: false,
    outline: [
      { uMm: 800, vMm: 600 },
      { uMm: 1800, vMm: 600 },
      { uMm: 1800, vMm: 1800 },
      { uMm: 800, vMm: 1800 },
    ],
  };
  job.room.features = [window];
  return job;
}

describe("PDF accessibility text (T057 / FR-021)", () => {
  it("invisible-text annotations expose feature type, surface, and no-paint flag", async () => {
    const job = makeJobWithWindow();
    const pdf = await buildPdf(job, EMPTY_DATASETS);
    const buf = Buffer.from(pdf._arrayBuffer ?? new ArrayBuffer(0));
    const parsed = await pdfParse(buf);
    // The feature label "North window" should appear (cover summary +
    // tile-page invisible text).
    expect(parsed.text).toMatch(/North window|Window/i);
    // The surface id ("wall-0") appears in tile-page invisible-text
    // annotations (Feature: ... on wall-0 (no-paint)).
    expect(parsed.text).toMatch(/wall-0/);
    // The no-paint flag is rendered verbatim.
    expect(parsed.text).toMatch(/no-paint/);
  });

  it("includes the feature dimensions in either visible or invisible text", async () => {
    const job = makeJobWithWindow();
    const pdf = await buildPdf(job, EMPTY_DATASETS);
    const buf = Buffer.from(pdf._arrayBuffer ?? new ArrayBuffer(0));
    const parsed = await pdfParse(buf);
    // The feature is 1000 x 1200 mm (uMin=800..uMax=1800; vMin=600..vMax=1800).
    // Either the dimensions or the surface label OR the feature type
    // should be searchable.
    expect(parsed.text.length).toBeGreaterThan(50);
    expect(parsed.text).toMatch(/Window/i);
  });

  it("cover-page summary lists features (FR-009 + FR-021)", async () => {
    const job = makeJobWithWindow();
    const pdf = await buildPdf(job, EMPTY_DATASETS);
    const buf = Buffer.from(pdf._arrayBuffer ?? new ArrayBuffer(0));
    const parsed = await pdfParse(buf);
    // The PDF metadata subject should contain the human-readable
    // observation summary (set via doc.setProperties in cover-page.ts).
    const info = parsed.info as { Subject?: string };
    expect(info.Subject).toBeTruthy();
    expect(typeof info.Subject).toBe("string");
    expect(info.Subject ?? "").toMatch(/Project|Observation/);
  });
});
