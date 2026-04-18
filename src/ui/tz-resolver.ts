// T052 — Timezone resolver.
// Looks up IANA zone for (lat, lon) against a precomputed 0.25-deg grid
// stored in data/tz.json, and uses Intl.DateTimeFormat to derive the
// UTC offset (honouring DST) at a given instant.

export interface TzLookup {
  zone: string;
  offsetMinutes: number;
}

interface TzGrid {
  lonMin: number;
  latMin: number;
  step: number;
  cols: number;
  rows: number;
}

interface TzTableFull {
  grid: TzGrid;
  zones: string[];
  /** Run-length encoding of row-major cell -> zone index. */
  rle: Array<[number, number]>;
}

interface TzTableFallback {
  _fallback: {
    /** Longitude-only fallback: zones[i] spans lonMin+step*i .. lonMin+step*(i+1). */
    lonMin: number;
    step: number;
    zones: string[];
  };
}

interface LoadedFull {
  kind: "full";
  grid: TzGrid;
  zones: string[];
  /** cumulative[i] = total cells covered by rle[0..i]; runZoneIdx[i] = zones-index for run i. */
  cumulative: Int32Array;
  runZoneIdx: Int32Array;
}

interface LoadedFallback {
  kind: "fallback";
  lonMin: number;
  step: number;
  zones: string[];
}

type Loaded = LoadedFull | LoadedFallback;

let state: Loaded | null = null;

function isFallback(tz: unknown): tz is TzTableFallback {
  return typeof tz === "object" && tz !== null && "_fallback" in tz;
}

function isFull(tz: unknown): tz is TzTableFull {
  if (typeof tz !== "object" || tz === null) return false;
  const t = tz as Partial<TzTableFull>;
  return Array.isArray(t.zones) && Array.isArray(t.rle) && typeof t.grid === "object";
}

export function loadTzTable(tz: unknown): void {
  if (isFallback(tz)) {
    const f = tz._fallback;
    state = {
      kind: "fallback",
      lonMin: f.lonMin,
      step: f.step,
      zones: f.zones.slice(),
    };
    return;
  }
  if (!isFull(tz)) {
    throw new Error("loadTzTable: unrecognised tz table shape");
  }
  const rle = tz.rle;
  const cumulative = new Int32Array(rle.length);
  const runZoneIdx = new Int32Array(rle.length);
  let sum = 0;
  for (let i = 0; i < rle.length; i++) {
    const run = rle[i];
    if (!run) continue;
    const count = run[0];
    const zoneIdx = run[1];
    sum += count;
    cumulative[i] = sum;
    runZoneIdx[i] = zoneIdx;
  }
  state = {
    kind: "full",
    grid: { ...tz.grid },
    zones: tz.zones.slice(),
    cumulative,
    runZoneIdx,
  };
}

/** Binary search: smallest i such that cumulative[i] > cellIndex. */
function findRun(cumulative: Int32Array, cellIndex: number): number {
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const c = cumulative[mid];
    if (c === undefined) {
      hi = mid - 1;
      continue;
    }
    if (c <= cellIndex) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** Parse "GMT+5" or "GMT-05:30" (from Intl shortOffset) to minutes east of UTC. */
function parseGmtOffset(s: string): number | null {
  const m = /(?:GMT|UTC)\s*([+-])\s*(\d{1,2})(?::(\d{2}))?/i.exec(s);
  if (!m) {
    if (/^(GMT|UTC)$/i.test(s.trim())) return 0;
    return null;
  }
  const sign = m[1] === "-" ? -1 : 1;
  const hh = Number(m[2] ?? "0");
  const mm = Number(m[3] ?? "0");
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return sign * (hh * 60 + mm);
}

/** Last-resort offset derived from an "Etc/GMT+N" zone name (POSIX-signed). */
function fallbackOffsetFromZoneName(zone: string): number {
  const m = /^Etc\/GMT([+-])(\d{1,2})$/.exec(zone);
  if (m) {
    const sign = m[1] === "+" ? -1 : 1;
    const h = Number(m[2] ?? "0");
    if (Number.isFinite(h)) return sign * h * 60;
  }
  if (/^Etc\/UTC$/.test(zone) || /^UTC$/.test(zone)) return 0;
  return 0;
}

function computeOffsetViaIntl(zone: string, atUtcMs: number): number | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
      hour: "2-digit",
      minute: "2-digit",
    });
    const parts = fmt.formatToParts(new Date(atUtcMs));
    for (const p of parts) {
      if (p.type === "timeZoneName") {
        const parsed = parseGmtOffset(p.value);
        if (parsed !== null) return parsed;
      }
    }
  } catch {
    // fall through to the formatToParts-delta strategy
  }

  try {
    const fmtTz = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = fmtTz.formatToParts(new Date(atUtcMs));
    const getPart = (t: string): number => {
      const p = parts.find((x) => x.type === t);
      return p ? Number(p.value) : NaN;
    };
    const y = getPart("year");
    const mo = getPart("month");
    const d = getPart("day");
    let h = getPart("hour");
    const mi = getPart("minute");
    const s = getPart("second");
    if (h === 24) h = 0;
    if (
      !Number.isFinite(y) ||
      !Number.isFinite(mo) ||
      !Number.isFinite(d) ||
      !Number.isFinite(h) ||
      !Number.isFinite(mi) ||
      !Number.isFinite(s)
    ) {
      return null;
    }
    const localAsUtcMs = Date.UTC(y, mo - 1, d, h, mi, s);
    return Math.round((localAsUtcMs - atUtcMs) / 60000);
  } catch {
    return null;
  }
}

export function resolveTz(latDeg: number, lonDeg: number, atUtcMs: number): TzLookup {
  if (!state) {
    throw new Error("resolveTz called before loadTzTable");
  }

  const lat = Math.max(-90, Math.min(90, latDeg));
  const lon = Math.max(-180, Math.min(180, lonDeg));

  let zone: string;

  if (state.kind === "fallback") {
    const idx = Math.max(
      0,
      Math.min(state.zones.length - 1, Math.floor((lon - state.lonMin) / state.step))
    );
    zone = state.zones[idx] ?? "Etc/UTC";
  } else {
    const g = state.grid;
    let col = Math.floor((lon - g.lonMin) / g.step);
    let row = Math.floor((lat - g.latMin) / g.step);
    if (col < 0) col = 0;
    if (col >= g.cols) col = g.cols - 1;
    if (row < 0) row = 0;
    if (row >= g.rows) row = g.rows - 1;
    const cellIndex = row * g.cols + col;
    const runIdx = findRun(state.cumulative, cellIndex);
    const zIdx = state.runZoneIdx[runIdx];
    zone = zIdx !== undefined ? state.zones[zIdx] ?? "Etc/UTC" : "Etc/UTC";
  }

  const viaIntl = computeOffsetViaIntl(zone, atUtcMs);
  const offsetMinutes = viaIntl !== null ? viaIntl : fallbackOffsetFromZoneName(zone);

  return { zone, offsetMinutes };
}

/** Test-only: reset module state between tests. */
export function __resetTzResolverForTests(): void {
  state = null;
}
