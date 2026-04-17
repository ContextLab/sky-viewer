/**
 * T020 — build-constellations.ts
 *
 * Reads Stellarium's modern_st (Sky & Telescope) skyculture
 * (`data/raw/modern_st_index.json`) which encodes constellation lines as
 * polylines of HIP (Hipparcos) star IDs. Cross-indexes HIP → HR using the
 * HYG database (`data/raw/hygdata.csv`), then writes
 * `data/constellations.json`:
 *
 *   [ { name:"UMa", fullName:"Ursa Major", lines: [[hr1,hr2], ...] }, ... ]
 *
 * Notes:
 *   - Stellarium's `lines` are polylines (≥ 2 points each); we expand each
 *     polyline to N−1 pairs of consecutive points.
 *   - HIP references that cannot be resolved to an HR present in
 *     `data/stars.bin` (magnitude ≤ 6.5) are dropped; we keep any line
 *     segment whose *both* endpoints are resolvable.
 *   - If more than 30% of HIP references cannot be resolved, we fall back
 *     to a hand-curated set of the most famous constellations (HR-coded).
 *     This has not been needed in practice for modern_st + HYG.
 *
 * Sources:
 *   - modern_st: https://github.com/Stellarium/stellarium (GPLv2+, skycultures)
 *   - HYG:       https://github.com/astronexus/HYG-Database (CC BY-SA 2.5)
 */

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';

const STELLARIUM = resolve('data/raw/modern_st_index.json');
const HYG = resolve('data/raw/hygdata.csv');
const STARS_INDEX = resolve('data/stars-index.json');
const OUT = resolve('data/constellations.json');

type Line = [number, number];
type ConstellationOut = { name: string; fullName: string; lines: Line[] };

interface StellariumIndex {
  constellations: Array<{
    id: string;
    lines: number[][];
    common_name?: { english?: string; native?: string };
  }>;
  common_names?: Record<string, Array<{ english?: string; native?: string }>>;
}

function parseAbbrev(id: string): string {
  // id example: "CON modern_st UMa"
  const parts = id.trim().split(/\s+/);
  return parts[parts.length - 1] ?? id;
}

function loadHipToHr(hygPath: string): Map<number, number> {
  const text = readFileSync(hygPath, 'utf8');
  const lines = text.split('\n');
  const header = lines[0]!.split(',').map((c) => c.replace(/^"|"$/g, ''));
  const hipIdx = header.indexOf('hip');
  const hrIdx = header.indexOf('hr');
  if (hipIdx < 0 || hrIdx < 0) throw new Error('HYG header missing hip/hr columns');

  const map = new Map<number, number>();
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw) continue;
    // HYG rows may contain quoted fields with commas; but hip/hr are numeric.
    // Split on commas *not* inside quotes.
    const fields = splitCsvLine(raw);
    if (fields.length <= Math.max(hipIdx, hrIdx)) continue;
    const hipStr = fields[hipIdx]!.replace(/^"|"$/g, '').trim();
    const hrStr = fields[hrIdx]!.replace(/^"|"$/g, '').trim();
    if (!hipStr || !hrStr) continue;
    const hip = Number(hipStr);
    const hr = Number(hrStr);
    if (!Number.isFinite(hip) || !Number.isFinite(hr)) continue;
    map.set(hip, hr);
  }
  return map;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
      cur += ch;
    } else if (ch === ',' && !inQuote) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function loadStarsHrSet(indexPath: string): Set<number> {
  const idx = JSON.parse(readFileSync(indexPath, 'utf8')) as { offsets: Record<string, number> };
  const set = new Set<number>();
  for (const k of Object.keys(idx.offsets)) set.add(Number(k));
  return set;
}

const IAU_FULL_NAMES: Record<string, string> = {
  And: 'Andromeda', Ant: 'Antlia', Aps: 'Apus', Aqr: 'Aquarius', Aql: 'Aquila',
  Ara: 'Ara', Ari: 'Aries', Aur: 'Auriga', Boo: 'Bootes', Cae: 'Caelum',
  Cam: 'Camelopardalis', Cnc: 'Cancer', CVn: 'Canes Venatici', CMa: 'Canis Major',
  CMi: 'Canis Minor', Cap: 'Capricornus', Car: 'Carina', Cas: 'Cassiopeia',
  Cen: 'Centaurus', Cep: 'Cepheus', Cet: 'Cetus', Cha: 'Chamaeleon', Cir: 'Circinus',
  Col: 'Columba', Com: 'Coma Berenices', CrA: 'Corona Australis', CrB: 'Corona Borealis',
  Crv: 'Corvus', Crt: 'Crater', Cru: 'Crux', Cyg: 'Cygnus', Del: 'Delphinus',
  Dor: 'Dorado', Dra: 'Draco', Equ: 'Equuleus', Eri: 'Eridanus', For: 'Fornax',
  Gem: 'Gemini', Gru: 'Grus', Her: 'Hercules', Hor: 'Horologium', Hya: 'Hydra',
  Hyi: 'Hydrus', Ind: 'Indus', Lac: 'Lacerta', Leo: 'Leo', LMi: 'Leo Minor',
  Lep: 'Lepus', Lib: 'Libra', Lup: 'Lupus', Lyn: 'Lynx', Lyr: 'Lyra',
  Men: 'Mensa', Mic: 'Microscopium', Mon: 'Monoceros', Mus: 'Musca', Nor: 'Norma',
  Oct: 'Octans', Oph: 'Ophiuchus', Ori: 'Orion', Pav: 'Pavo', Peg: 'Pegasus',
  Per: 'Perseus', Phe: 'Phoenix', Pic: 'Pictor', Psc: 'Pisces', PsA: 'Piscis Austrinus',
  Pup: 'Puppis', Pyx: 'Pyxis', Ret: 'Reticulum', Sge: 'Sagitta', Sgr: 'Sagittarius',
  Sco: 'Scorpius', Scl: 'Sculptor', Sct: 'Scutum', Ser: 'Serpens', Sex: 'Sextans',
  Tau: 'Taurus', Tel: 'Telescopium', Tri: 'Triangulum', TrA: 'Triangulum Australe',
  Tuc: 'Tucana', UMa: 'Ursa Major', UMi: 'Ursa Minor', Vel: 'Vela', Vir: 'Virgo',
  Vol: 'Volans', Vul: 'Vulpecula',
};

function main(): void {
  const stellarium = JSON.parse(readFileSync(STELLARIUM, 'utf8')) as StellariumIndex;
  const hipToHr = loadHipToHr(HYG);
  const validHr = loadStarsHrSet(STARS_INDEX);

  let totalRefs = 0;
  let resolvedRefs = 0;
  let totalSegmentsIn = 0;
  let keptSegments = 0;

  const out: ConstellationOut[] = [];
  for (const c of stellarium.constellations) {
    const abbr = parseAbbrev(c.id);
    // Prefer the canonical IAU Latin name (matches data-model.md example
    // "Ursa Major" rather than the S&T "Great Bear"/"Chained Maiden" etc.).
    const fullName = IAU_FULL_NAMES[abbr] ?? c.common_name?.english ?? abbr;
    const segs: Line[] = [];
    for (const poly of c.lines) {
      for (let i = 0; i < poly.length - 1; i++) {
        totalSegmentsIn++;
        const hipA = poly[i]!;
        const hipB = poly[i + 1]!;
        totalRefs += 2;
        const hrA = hipToHr.get(hipA);
        const hrB = hipToHr.get(hipB);
        if (hrA !== undefined) resolvedRefs++;
        if (hrB !== undefined) resolvedRefs++;
        if (hrA === undefined || hrB === undefined) continue;
        if (!validHr.has(hrA) || !validHr.has(hrB)) continue;
        segs.push([hrA, hrB]);
        keptSegments++;
      }
    }
    out.push({ name: abbr, fullName, lines: segs });
  }

  const missRate = 1 - resolvedRefs / totalRefs;
  if (missRate > 0.3) {
    process.stderr.write(
      `build-constellations: HIP→HR miss rate ${(missRate * 100).toFixed(1)}% — exceeds 30% threshold. ` +
        `Using fallback set.\n`,
    );
    writeFileSync(OUT, JSON.stringify(FALLBACK_SET));
    const sz = statSync(OUT).size;
    const gz = gzipSync(readFileSync(OUT)).length;
    process.stdout.write(
      `build-constellations (FALLBACK): ${FALLBACK_SET.length} constellations. data/constellations.json: ${sz} bytes uncompressed, ${gz} bytes gzipped\n`,
    );
    return;
  }

  writeFileSync(OUT, JSON.stringify(out));
  const sz = statSync(OUT).size;
  const gz = gzipSync(readFileSync(OUT)).length;
  process.stdout.write(
    `build-constellations: ${out.length} constellations, ${keptSegments}/${totalSegmentsIn} line segments kept, ` +
      `${(resolvedRefs / totalRefs * 100).toFixed(1)}% HIP refs resolved.\n` +
      `  data/constellations.json: ${sz} bytes uncompressed, ${gz} bytes gzipped\n`,
  );
}

/**
 * Hand-curated fallback covering 20+ famous constellations, HR-coded from YBSC.
 * Only used if the primary HIP→HR resolution fails for > 30% of references.
 */
const FALLBACK_SET: ConstellationOut[] = [
  { name: 'UMa', fullName: 'Ursa Major',
    lines: [[4301, 4554], [4554, 4660], [4660, 4905], [4905, 5054], [5054, 5191], [5191, 5054]] },
  { name: 'Ori', fullName: 'Orion',
    lines: [[1948, 1903], [1903, 1852], [2061, 1713], [1713, 1852], [1852, 1948], [1948, 2004], [2004, 2061]] },
  { name: 'Cas', fullName: 'Cassiopeia',
    lines: [[21, 168], [168, 264], [264, 403], [403, 542]] },
  { name: 'Cyg', fullName: 'Cygnus',
    lines: [[7924, 7796], [7796, 7528], [7528, 7417], [7417, 7949]] },
  { name: 'Leo', fullName: 'Leo',
    lines: [[3982, 3975], [3975, 3873], [3873, 3905], [3905, 3982], [3982, 4057], [4057, 4357], [4357, 4534]] },
  { name: 'Sco', fullName: 'Scorpius',
    lines: [[5953, 5984], [5984, 6084], [6084, 6134], [6134, 6165], [6165, 6241], [6241, 6271], [6271, 6380], [6380, 6553], [6553, 6615], [6615, 6695]] },
  { name: 'Cru', fullName: 'Crux',
    lines: [[4730, 4853], [4656, 4763]] },
  { name: 'Tau', fullName: 'Taurus',
    lines: [[1708, 1457], [1457, 1791], [1791, 1910]] },
  { name: 'CMa', fullName: 'Canis Major',
    lines: [[2491, 2693], [2693, 2827], [2827, 2657], [2657, 2491]] },
  { name: 'Gem', fullName: 'Gemini',
    lines: [[2890, 2990], [2990, 2821], [2821, 2697]] },
  { name: 'Boo', fullName: 'Bootes',
    lines: [[5340, 5235], [5235, 5506], [5506, 5681], [5681, 5602], [5602, 5340]] },
  { name: 'Lyr', fullName: 'Lyra', lines: [[7001, 7056], [7056, 7178], [7178, 7106], [7106, 7001]] },
  { name: 'Aql', fullName: 'Aquila', lines: [[7557, 7525], [7525, 7235]] },
  { name: 'Peg', fullName: 'Pegasus',
    lines: [[39, 8781], [8781, 8775], [8775, 8308], [8308, 39]] },
  { name: 'And', fullName: 'Andromeda',
    lines: [[15, 337], [337, 464], [464, 603]] },
  { name: 'Per', fullName: 'Perseus', lines: [[1017, 915], [915, 936]] },
  { name: 'UMi', fullName: 'Ursa Minor',
    lines: [[424, 6789], [6789, 5903], [5903, 5563], [5563, 5735], [5735, 6116], [6116, 6322]] },
  { name: 'Dra', fullName: 'Draco',
    lines: [[6536, 6705], [6705, 6536], [6705, 7310], [7310, 6132], [6132, 5744]] },
  { name: 'Sgr', fullName: 'Sagittarius',
    lines: [[6879, 6913], [6913, 7194], [7194, 7264]] },
  { name: 'Vir', fullName: 'Virgo',
    lines: [[5056, 5107], [5107, 5340]] },
];

main();
