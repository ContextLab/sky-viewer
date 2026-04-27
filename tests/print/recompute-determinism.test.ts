// @vitest-environment node
// T052 — Determinism of buildPdf for the same job.
//
// US3 promises "edit, re-Compute, see exactly the changes". That only
// holds if buildPdf for the SAME job is deterministic — same page count,
// same hole counts by class, ideally byte-identical bytes. We assert
// the first two strictly and the third as a soft check (jsPDF can vary
// in cosmetic ways like timestamp metadata; we accept ±100 bytes).

import { describe, expect, it } from "vitest";
import canonical from "./fixtures/canonical-ceiling.json";
import { buildPdf } from "../../src/print/pdf-builder";
import type { PrintJob } from "../../src/print/types";
import type { Constellation } from "../../src/astro/constellations";
import type { Star } from "../../src/astro/stars";

const EMPTY_DATASETS = { stars: [] as Star[], constellations: [] as Constellation[] };

describe("buildPdf determinism (T052 / FR-019 + US3)", () => {
  it("produces identical pageCount and hole-count summary for the same input", async () => {
    const job = canonical as unknown as PrintJob;
    const pdf1 = await buildPdf(job, EMPTY_DATASETS);
    const pdf2 = await buildPdf(job, EMPTY_DATASETS);

    expect(pdf1.pageCount).toBe(pdf2.pageCount);
    expect(pdf1.summary.totalPageCount).toBe(pdf2.summary.totalPageCount);
    expect(pdf1.summary.tilePageCount).toBe(pdf2.summary.tilePageCount);
    expect(pdf1.summary.totalHoles).toBe(pdf2.summary.totalHoles);
    expect(pdf1.summary.holeCountsByClass.pencil).toBe(pdf2.summary.holeCountsByClass.pencil);
    expect(pdf1.summary.holeCountsByClass.largeNail).toBe(pdf2.summary.holeCountsByClass.largeNail);
    expect(pdf1.summary.holeCountsByClass.smallNail).toBe(pdf2.summary.holeCountsByClass.smallNail);
    expect(pdf1.summary.holeCountsByClass.pin).toBe(pdf2.summary.holeCountsByClass.pin);
    expect(pdf1.summary.surfaceCount).toBe(pdf2.summary.surfaceCount);
    expect(pdf1.summary.paperSheetCount).toBe(pdf2.summary.paperSheetCount);
  });

  it("produces nearly byte-identical PDFs (within 100 bytes) for the same input", async () => {
    const job = canonical as unknown as PrintJob;
    const pdf1 = await buildPdf(job, EMPTY_DATASETS);
    const pdf2 = await buildPdf(job, EMPTY_DATASETS);

    // jsPDF embeds a /CreationDate metadata stamp by default; the
    // resulting byte counts should still match within a small budget
    // (the timestamp has fixed length unless we cross a minute boundary
    // mid-test — extremely unlikely for two synchronous builds).
    const diff = Math.abs(pdf1.blob.size - pdf2.blob.size);
    expect(diff).toBeLessThanOrEqual(100);
  });

  it("recomputing after a no-op modification yields the same output", async () => {
    const job = canonical as unknown as PrintJob;
    // Round-trip the job through JSON to simulate the persistence cycle.
    const cloned = JSON.parse(JSON.stringify(job)) as PrintJob;

    const pdf1 = await buildPdf(job, EMPTY_DATASETS);
    const pdf2 = await buildPdf(cloned, EMPTY_DATASETS);
    expect(pdf1.pageCount).toBe(pdf2.pageCount);
    expect(pdf1.summary.totalHoles).toBe(pdf2.summary.totalHoles);
  });
});
