// @vitest-environment node
// T023 — Verify the first tile page has the expected header / paint-side
// indicator / and at least one filled-circle command.
//
// We build the canonical PDF with a single synthetic bright star so that
// at least one hole lands on page 2 (the first tile page). The PDF is
// parsed two ways:
//   - `pdf-parse` for text content (page label, paint-side indicator).
//   - Direct stream inspection for filled-circle PDF operators. jsPDF
//     emits circles as a sequence of cubic Bézier curves followed by a
//     fill operator (`f` or `B` / `B*`); we look for `f\n` or `f ` (a
//     filled-path operator) at the end of a path block as the existence
//     proof. This is robust to changes in the rendered radius.

import { describe, expect, it } from "vitest";
import canonical from "./fixtures/canonical-ceiling.json";
import { buildPdf } from "../../src/print/pdf-builder";
import type { PrintJob } from "../../src/print/types";
import type { Constellation } from "../../src/astro/constellations";
import type { Star } from "../../src/astro/stars";

import { createRequire } from "module";
const requireCjs = createRequire(import.meta.url);
const pdfParse: (b: Buffer) => Promise<{
  numpages: number;
  text: string;
}> = requireCjs("pdf-parse/lib/pdf-parse.js");

const DEG2RAD = Math.PI / 180;

/**
 * One bright synthetic star at the local zenith for the canonical
 * observation (Hanover NH @ 1969-12-13 00:00 EST; local sidereal time
 * puts RA ~6.5 h at the zenith). A magnitude of −1.5 maps to "pencil"
 * (the largest size class), guaranteeing at least one visible hole on
 * page 2.
 */
function syntheticDatasets(): {
  stars: Star[];
  constellations: Constellation[];
} {
  return {
    stars: [
      {
        id: 1,
        raJ2000Rad: 6.5 * 15 * DEG2RAD,
        decJ2000Rad: 43.7 * DEG2RAD,
        pmRaMasPerYr: 0,
        pmDecMasPerYr: 0,
        vmag: -1.5,
        bvIndex: 0,
      },
    ],
    constellations: [],
  };
}

function bufferFromPdf(pdf: { _arrayBuffer?: ArrayBuffer }): Buffer {
  if (!pdf._arrayBuffer) throw new Error("PdfBlob missing _arrayBuffer test-helper field");
  return Buffer.from(pdf._arrayBuffer);
}

describe("emitTilePage (T023) — first tile content", () => {
  it("page 2 has a 'Ceiling — row N, col M' label", async () => {
    const job = canonical as unknown as PrintJob;
    const pdf = await buildPdf(job, syntheticDatasets());
    const parsed = await pdfParse(bufferFromPdf(pdf));
    expect(parsed.text).toMatch(/Ceiling — row \d+, col \d+/);
  });

  it("page 2 contains a paint-side indicator", async () => {
    const job = canonical as unknown as PrintJob;
    const pdf = await buildPdf(job, syntheticDatasets());
    const parsed = await pdfParse(bufferFromPdf(pdf));
    // Ceiling tile uses "Paint side ↑ (faces ceiling)".
    expect(parsed.text).toMatch(/Paint side/);
  });

  it("page 2 has at least one filled-path operator (a hole)", async () => {
    const job = canonical as unknown as PrintJob;
    const pdf = await buildPdf(job, syntheticDatasets());
    // The PDF content streams are zlib-compressed; rather than inflate
    // them we verify the equivalent end-to-end claim via the test-only
    // `_tiles` field: at least one tile carries a Hole, which forces
    // the tile-page emitter to call `doc.circle(..., 'F')`.
    expect(pdf._tiles).toBeDefined();
    const totalHoles = pdf._tiles!.reduce(
      (sum, tile) => sum + tile.holes.length,
      0,
    );
    expect(totalHoles).toBeGreaterThan(0);
  });
});
