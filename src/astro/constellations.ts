// Constellation line-figure parser.
//
// Shape described in specs/001-sky-viewer-mvp/data-model.md §"Entity:
// Constellation":
//
//   { name: string,         // IAU abbreviation, e.g. "UMa"
//     fullName: string,     // "Ursa Major"
//     lines: [[hr1, hr2], …] // pairs of YBSC HR ids (star-pair segments)
//   }
//
// The overall JSON shape is an array of such entries.

export type Constellation = {
  name: string;
  fullName: string;
  lines: Array<[number, number]>;
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function assertString(v: unknown, path: string): string {
  if (typeof v !== 'string') {
    throw new Error(`parseConstellations: ${path} must be a string, got ${typeof v}`);
  }
  return v;
}

function assertFinitePositiveInt(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
    throw new Error(`parseConstellations: ${path} must be a non-negative integer, got ${String(v)}`);
  }
  return v;
}

/**
 * Validate and return a typed array of `Constellation` records.
 * Throws on any malformed element so the caller can surface a loud
 * error rather than silently rendering partial data.
 */
export function parseConstellations(json: unknown): Constellation[] {
  if (!Array.isArray(json)) {
    throw new Error('parseConstellations: root must be an array');
  }
  const out: Constellation[] = new Array(json.length);
  for (let i = 0; i < json.length; i++) {
    const entry = json[i];
    if (!isRecord(entry)) {
      throw new Error(`parseConstellations: entry ${i} is not an object`);
    }
    const name = assertString(entry.name, `[${i}].name`);
    const fullName = assertString(entry.fullName, `[${i}].fullName`);
    const rawLines = entry.lines;
    if (!Array.isArray(rawLines)) {
      throw new Error(`parseConstellations: [${i}].lines must be an array`);
    }
    const lines: Array<[number, number]> = new Array(rawLines.length);
    for (let j = 0; j < rawLines.length; j++) {
      const pair = rawLines[j];
      if (!Array.isArray(pair) || pair.length !== 2) {
        throw new Error(
          `parseConstellations: [${i}].lines[${j}] must be a 2-element array`,
        );
      }
      const a = assertFinitePositiveInt(pair[0], `[${i}].lines[${j}][0]`);
      const b = assertFinitePositiveInt(pair[1], `[${i}].lines[${j}][1]`);
      lines[j] = [a, b];
    }
    out[i] = { name, fullName, lines };
  }
  return out;
}
