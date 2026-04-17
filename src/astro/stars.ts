// Star catalogue loader.
//
// The runtime star binary format is packed little-endian. Per-star
// layout (23 bytes total — note this is the RUNTIME format, which is
// more generous than the 17-B/star figure in data-model.md §"Entity:
// Star": the data-model document describes the MINIMUM information
// per star, while the runtime format stores each field in its native
// type for fast `DataView` decode without bit-packing):
//
//   offset  type     field      units / notes
//   0       uint16   id         YBSC HR number
//   2       float32  raJ2000    radians
//   6       float32  decJ2000   radians
//   10      float32  pmRa       mas/yr (already includes cos δ)
//   14      float32  pmDec      mas/yr
//   18      float32  vmag       visual magnitude
//   22      int8     bvIndex    colour index × 100 (−40 … +200)
//
//   total: 23 B/star → ~210 KB for a 9,110-entry catalogue
//                     (fits the payload budget after gzip).
//
// See /Users/jmanning/sky-viewer/specs/001-sky-viewer-mvp/data-model.md
// §"Entity: Star" for the source of truth on field semantics.

import { precessStarToEpoch } from './transforms';

export type Star = {
  id: number;
  raJ2000Rad: number;
  decJ2000Rad: number;
  pmRaMasPerYr: number;
  pmDecMasPerYr: number;
  vmag: number;
  bvIndex: number;
};

/** Number of bytes per star in the packed binary format. */
export const STAR_RECORD_BYTES = 23;

/**
 * Parse a packed little-endian star catalogue buffer into an array of
 * `Star` records. Throws if the buffer size is not an exact multiple
 * of `STAR_RECORD_BYTES`.
 */
export function parseStarCatalogue(buf: ArrayBuffer): Star[] {
  if (buf.byteLength % STAR_RECORD_BYTES !== 0) {
    throw new Error(
      `parseStarCatalogue: buffer length ${buf.byteLength} is not a multiple of ${STAR_RECORD_BYTES}`,
    );
  }
  const count = buf.byteLength / STAR_RECORD_BYTES;
  const dv = new DataView(buf);
  const out: Star[] = new Array(count);
  let off = 0;
  for (let i = 0; i < count; i++) {
    const id = dv.getUint16(off, /* littleEndian */ true);
    const raJ2000Rad = dv.getFloat32(off + 2, true);
    const decJ2000Rad = dv.getFloat32(off + 6, true);
    const pmRaMasPerYr = dv.getFloat32(off + 10, true);
    const pmDecMasPerYr = dv.getFloat32(off + 14, true);
    const vmag = dv.getFloat32(off + 18, true);
    const bvIndex = dv.getInt8(off + 22);
    out[i] = { id, raJ2000Rad, decJ2000Rad, pmRaMasPerYr, pmDecMasPerYr, vmag, bvIndex };
    off += STAR_RECORD_BYTES;
  }
  return out;
}

// Re-export the precession+proper-motion helper so downstream callers
// can import from a single place.
export { precessStarToEpoch };
