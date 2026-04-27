// T024 — End-to-end check that `buildPdf` produces a real, parseable
// PDF whose page count exactly matches the preflight summary (SC-008,
// FR-014).
//
// We use a small synthetic star catalogue (10 anchor stars near the
// local zenith for the canonical fixture) to keep the test fast; the
// page-count invariant doesn't depend on how many stars project to
// holes — it depends only on `rows × cols + 1`.

import { describe, expect, it } from "vitest";
import canonical from "./fixtures/canonical-ceiling.json";
import { buildPdf } from "../../src/print/pdf-builder";
import { computePreflightSummary } from "../../src/print/preflight";
import type { PrintJob } from "../../src/print/types";
import type { Constellation } from "../../src/astro/constellations";
import type { Star } from "../../src/astro/stars";

const DEG2RAD = Math.PI / 180;

function syntheticStars(): Star[] {
  const ra = 6.5 * 15 * DEG2RAD;
  const dec = 43.7 * DEG2RAD;
  const mags = [-1.5, 0.5, 1.5, 2.5, 3.5, 4.5, 5.5, -0.5, 1.0, 2.0];
  return mags.map((vmag, idx) => ({
    id: 2000 + idx,
    raJ2000Rad: ra + (idx - 5) * 0.05,
    decJ2000Rad: dec + (idx - 5) * 0.02,
    pmRaMasPerYr: 0,
    pmDecMasPerYr: 0,
    vmag,
    bvIndex: 0,
  }));
}

const DATASETS = {
  stars: syntheticStars(),
  constellations: [] as Constellation[],
};

function head(pdf: { _arrayBuffer?: ArrayBuffer }, n: number): string {
  if (!pdf._arrayBuffer) throw new Error("PdfBlob missing _arrayBuffer test-helper field");
  return Buffer.from(pdf._arrayBuffer).subarray(0, n).toString("ascii");
}

describe("buildPdf canonical pipeline (T024)", () => {
  const job = canonical as unknown as PrintJob;

  it("returns a Blob whose first 5 bytes are %PDF-", async () => {
    const pdf = await buildPdf(job, DATASETS);
    expect(head(pdf, 5)).toBe("%PDF-");
  });

  it("pageCount equals 1 (cover) + tilePageCount (FR-014)", async () => {
    const pdf = await buildPdf(job, DATASETS);
    expect(pdf.pageCount).toBe(1 + pdf.summary.tilePageCount);
  });

  it("pageCount equals preflight.totalPageCount exactly (SC-008)", async () => {
    const preflight = computePreflightSummary(job, DATASETS);
    const pdf = await buildPdf(job, DATASETS);
    expect(pdf.pageCount).toBe(preflight.totalPageCount);
  });

  it("exposes the internal Tile array for testability", async () => {
    const pdf = await buildPdf(job, DATASETS);
    expect(Array.isArray(pdf._tiles)).toBe(true);
    // tiles.length should equal pageCount − 1 (every tile is a page after
    // the cover, FR-014).
    expect(pdf._tiles!.length).toBe(pdf.pageCount - 1);
  });
});
