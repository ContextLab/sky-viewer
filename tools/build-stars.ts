/**
 * T019 — build-stars.ts
 *
 * Reads `data/raw/bsc5.dat` (Yale Bright Star Catalogue, 5th rev.), filters to
 * V-mag ≤ 6.5, and emits:
 *   - `data/stars.bin`        (packed little-endian binary, 23 B/star)
 *   - `data/stars-index.json` (HR → byte offset, for debugging)
 *
 * Per-record binary layout (little-endian):
 *   offset  size  field     units
 *   +0      u16   id        YBSC HR number
 *   +2      f32   ra        radians (J2000.0)
 *   +6      f32   dec       radians (J2000.0)
 *  +10      f32   pmRa      mas/yr (projected, cos(Dec) factor already in)
 *  +14      f32   pmDec     mas/yr
 *  +18      f32   vmag      V-band apparent magnitude
 *  +22      i8    bvIndex   round((B−V) × 100), clamped to [-128, 127]
 *
 * = 23 bytes per star.
 *
 * Source format (fixed-width ASCII, 197 cols, 1-based):
 *   HR:       1–4    I4
 *   RA h:     76–77  I2
 *   RA min:   78–79  I2
 *   RA sec:   80–83  F4.1
 *   Dec sign: 84     A1
 *   Dec deg:  85–86  I2
 *   Dec min:  87–88  I2
 *   Dec sec:  89–90  I2
 *   Vmag:     103–107 F5.2
 *   B-V:      110–114 F5.2
 *   pmRA:     149–154 F6.3 (arcsec/yr)
 *   pmDE:     155–160 F6.3 (arcsec/yr)
 *
 * (See data/raw/bsc5.readme for the full spec.)
 */

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';

const RAW = resolve('data/raw/bsc5.dat');
const OUT_BIN = resolve('data/stars.bin');
const OUT_INDEX = resolve('data/stars-index.json');

const MAG_CUTOFF = 6.5;
const BYTES_PER_STAR = 23;

function sliceNum(line: string, start1: number, end1: number): number {
  // Convert 1-based inclusive column range to 0-based slice.
  const s = line.slice(start1 - 1, end1).trim();
  if (s === '' || s === '-') return NaN;
  const v = Number(s);
  return Number.isFinite(v) ? v : NaN;
}

function sliceStr(line: string, start1: number, end1: number): string {
  return line.slice(start1 - 1, end1);
}

function parseRecord(line: string):
  | {
      hr: number;
      raRad: number;
      decRad: number;
      pmRaMas: number;
      pmDecMas: number;
      vmag: number;
      bv: number;
    }
  | null {
  if (line.length < 90) return null;

  const hr = sliceNum(line, 1, 4);
  if (!Number.isFinite(hr) || hr <= 0) return null;

  const raH = sliceNum(line, 76, 77);
  const raM = sliceNum(line, 78, 79);
  const raS = sliceNum(line, 80, 83);
  const deSign = sliceStr(line, 84, 84);
  const deD = sliceNum(line, 85, 86);
  const deM = sliceNum(line, 87, 88);
  const deS = sliceNum(line, 89, 90);

  if (
    !Number.isFinite(raH) ||
    !Number.isFinite(raM) ||
    !Number.isFinite(raS) ||
    !Number.isFinite(deD) ||
    !Number.isFinite(deM) ||
    !Number.isFinite(deS)
  ) {
    return null; // blank = removed from BSC; skip.
  }

  const raHours = raH + raM / 60 + raS / 3600;
  const raDeg = raHours * 15;
  const raRad = (raDeg * Math.PI) / 180;

  const decDegAbs = deD + deM / 60 + deS / 3600;
  const decDeg = deSign === '-' ? -decDegAbs : decDegAbs;
  const decRad = (decDeg * Math.PI) / 180;

  const vmag = sliceNum(line, 103, 107);
  if (!Number.isFinite(vmag)) return null;

  const bvRaw = sliceNum(line, 110, 114);
  const bv = Number.isFinite(bvRaw) ? bvRaw : 0;

  const pmRa = sliceNum(line, 149, 154);
  const pmDec = sliceNum(line, 155, 160);
  const pmRaMas = Number.isFinite(pmRa) ? pmRa * 1000 : 0;
  const pmDecMas = Number.isFinite(pmDec) ? pmDec * 1000 : 0;

  return { hr, raRad, decRad, pmRaMas, pmDecMas, vmag, bv };
}

function main(): void {
  const raw = readFileSync(RAW, 'latin1');
  const lines = raw.split('\n');

  const kept: ReturnType<typeof parseRecord>[] = [];
  let scanned = 0;
  for (const line of lines) {
    if (line.length === 0) continue;
    scanned++;
    const rec = parseRecord(line);
    if (rec === null) continue;
    if (rec.vmag > MAG_CUTOFF) continue;
    kept.push(rec);
  }

  const buf = Buffer.alloc(kept.length * BYTES_PER_STAR);
  const index: Record<string, number> = {};

  for (let i = 0; i < kept.length; i++) {
    const r = kept[i]!;
    const off = i * BYTES_PER_STAR;
    buf.writeUInt16LE(r.hr, off + 0);
    buf.writeFloatLE(r.raRad, off + 2);
    buf.writeFloatLE(r.decRad, off + 6);
    buf.writeFloatLE(r.pmRaMas, off + 10);
    buf.writeFloatLE(r.pmDecMas, off + 14);
    buf.writeFloatLE(r.vmag, off + 18);
    const bvScaled = Math.round(r.bv * 100);
    const bvClamped = Math.max(-128, Math.min(127, bvScaled));
    buf.writeInt8(bvClamped, off + 22);
    index[String(r.hr)] = off;
  }

  writeFileSync(OUT_BIN, buf);
  writeFileSync(OUT_INDEX, JSON.stringify({ bytesPerRecord: BYTES_PER_STAR, count: kept.length, offsets: index }));

  const gz = gzipSync(buf).length;
  const idxGz = gzipSync(Buffer.from(JSON.stringify({ bytesPerRecord: BYTES_PER_STAR, count: kept.length, offsets: index }))).length;

  const szBin = statSync(OUT_BIN).size;
  const szIdx = statSync(OUT_INDEX).size;
  process.stdout.write(
    `build-stars: scanned ${scanned} records, kept ${kept.length} (V≤${MAG_CUTOFF}).\n` +
      `  data/stars.bin:        ${szBin} bytes uncompressed, ${gz} bytes gzipped\n` +
      `  data/stars-index.json: ${szIdx} bytes uncompressed, ${idxGz} bytes gzipped\n`,
  );
}

main();
