// @vitest-environment node
// T022 — Verify cover-page legend draws holes at the spec'd diameters.
//
// Strategy: build a one-page PDF that contains ONLY the cover page
// (no tile pages — we feed an empty PrintJob with all surfaces
// disabled so `buildPdf` adds zero `addPage` calls; this leaves only
// page 1, the cover, in the output PDF). Parse with `pdf-parse`,
// inspect the rendered text content for the size legend labels and
// the formatted observation. The four hole-circle diameters are
// asserted via the diameter strings printed under each circle ("6 mm",
// "4 mm", "2.5 mm", "1 mm") — `pdf-parse` exposes them robustly,
// whereas extracting the actual `circle` operator radii from the raw
// stream is brittle. The cover-page module is small enough that a
// text-only assertion is sufficient: if the labels render at the right
// values, the circles are placed via the same constant
// (`HOLE_DIAMETERS_MM`).

import { describe, expect, it } from "vitest";
import canonical from "./fixtures/canonical-ceiling.json";
import { buildPdf } from "../../src/print/pdf-builder";
import { HOLE_DIAMETERS_MM, type PrintJob } from "../../src/print/types";
import type { Constellation } from "../../src/astro/constellations";
import type { Star } from "../../src/astro/stars";

// `pdf-parse` is CJS; import via createRequire to satisfy ESM tooling.
import { createRequire } from "module";
const requireCjs = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse: (b: Buffer) => Promise<{ numpages: number; text: string }> =
  requireCjs("pdf-parse/lib/pdf-parse.js");

const EMPTY_DATASETS = { stars: [] as Star[], constellations: [] as Constellation[] };

function bufferFromPdf(pdf: { _arrayBuffer?: ArrayBuffer }): Buffer {
  if (!pdf._arrayBuffer) throw new Error("PdfBlob missing _arrayBuffer test-helper field");
  return Buffer.from(pdf._arrayBuffer);
}

describe("emitCoverPage (T022)", () => {
  // Hole diameter strings the legend must render under each circle.
  const expectedDiameterStrings = [
    `${HOLE_DIAMETERS_MM.pencil} mm`, // "6 mm"
    `${HOLE_DIAMETERS_MM.largeNail} mm`, // "4 mm"
    `${HOLE_DIAMETERS_MM.smallNail} mm`, // "2.5 mm"
    `${HOLE_DIAMETERS_MM.pin} mm`, // "1 mm"
  ];

  it("includes the four hole-size labels at exact spec'd diameters", async () => {
    const job = canonical as unknown as PrintJob;
    const pdf = await buildPdf(job, EMPTY_DATASETS);
    const parsed = await pdfParse(bufferFromPdf(pdf));

    expect(parsed.text).toMatch(/Pencil/);
    expect(parsed.text).toMatch(/Large nail/);
    expect(parsed.text).toMatch(/Small nail/);
    expect(parsed.text).toMatch(/Pin/);

    for (const ds of expectedDiameterStrings) {
      expect(parsed.text).toContain(ds);
    }
  });

  it("includes the canonical observation location label", async () => {
    const job = canonical as unknown as PrintJob;
    const pdf = await buildPdf(job, EMPTY_DATASETS);
    const parsed = await pdfParse(bufferFromPdf(pdf));
    // Default canonical fixture's location label is "Moore Hall ...".
    expect(parsed.text).toMatch(/Moore Hall/);
  });

  it("includes step-by-step instructions (cut, align, tape, spray, peel)", async () => {
    const job = canonical as unknown as PrintJob;
    const pdf = await buildPdf(job, EMPTY_DATASETS);
    const parsed = await pdfParse(bufferFromPdf(pdf));
    // The instructions block is keyed to verbs that appear in capital letters.
    expect(parsed.text).toMatch(/CUT/);
    expect(parsed.text).toMatch(/ALIGN/);
    expect(parsed.text).toMatch(/TAPE/);
    expect(parsed.text).toMatch(/SPRAY/);
    expect(parsed.text).toMatch(/PEEL/);
  });
});
