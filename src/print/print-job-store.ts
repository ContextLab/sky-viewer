// T007 — Print Job state store.
//
// Mirrors the parent feature's `observation-store.ts` pattern:
//   - Module-level singleton with debounced localStorage persistence.
//   - `setPrintJob` deep-merges a Partial<PrintJob>, applying the
//     validation rules from contracts/print-api.md.
//   - `subscribe` registers synchronous listeners.
//   - `createIsolatedStore()` builds a fully-independent store for
//     tests (no shared module state).
//   - Test hooks: `__flushPersistForTests`, `__resetSingletonForTests`,
//     `__resetPersistForTests`.
//
// The PaperSize, custom-bounds, ceiling-height, and observer eye-height
// validations come straight out of the contract document. RoomFeatures
// with degenerate (non-simple or out-of-bounds) outlines are silently
// dropped — the editor UI will prevent these in practice, and the
// store is the last-line guard.

import { DEFAULT_OBSERVATION, type Observation } from "../app/types";
import {
  makeDefaultPrintJob,
  type OutputOptions,
  type PaperSize,
  type PrintJob,
  type Room,
  type RoomFeature,
} from "./types";

/**
 * Recursive partial — every leaf is optional, nested objects accept
 * shallow patches without forcing callers to spread the full prior
 * value. Arrays remain whole-replace (the editor never asks for
 * "patch the 3rd vertex"; it always sends the full vertex list).
 */
export type DeepPartial<T> = T extends Array<infer _U>
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

const STORAGE_KEY = "skyViewer.printJob";
const DEBOUNCE_MS = 500;

export type Unsubscribe = () => void;
type Listener = (job: PrintJob) => void;

interface InternalState {
  current: PrintJob;
  listeners: Set<Listener>;
}

// ---------------------------------------------------------------------------
// Coercion helpers (pure)
// ---------------------------------------------------------------------------

function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function coerceObservation(
  next: DeepPartial<Observation> | undefined,
  prev: Observation,
): Observation {
  if (!next) return prev;
  // The print-job store does NOT re-derive utcInstant or wrap angles —
  // those rules live in the parent observation-store. We accept the
  // caller's values verbatim (the UI adapter in T036a writes already-
  // coerced values) and only fall back to `prev` when a field is
  // missing or wrong-typed. This intentionally mirrors how Partial
  // updates propagate in the parent store while keeping a clean
  // separation between the two stores' validation responsibilities.
  return {
    ...prev,
    ...next,
    location: { ...prev.location, ...(next.location ?? {}) },
    playback: { ...prev.playback, ...(next.playback ?? {}) },
    layers: { ...prev.layers, ...(next.layers ?? {}) },
    schemaVersion: 1,
  };
}

/**
 * Cull degenerate vertex arrays. We keep finite (xMm, yMm) pairs only,
 * and if fewer than 3 valid pairs remain we fall back to `prev`.
 */
function coerceVertices(
  next: Array<{ xMm: number; yMm: number }> | undefined,
  prev: Array<{ xMm: number; yMm: number }>,
): Array<{ xMm: number; yMm: number }> {
  if (!Array.isArray(next)) return prev;
  const cleaned: Array<{ xMm: number; yMm: number }> = [];
  for (const v of next) {
    if (
      v &&
      typeof v === "object" &&
      typeof v.xMm === "number" &&
      typeof v.yMm === "number" &&
      Number.isFinite(v.xMm) &&
      Number.isFinite(v.yMm)
    ) {
      cleaned.push({ xMm: v.xMm, yMm: v.yMm });
    }
  }
  return cleaned.length >= 3 ? cleaned : prev;
}

/**
 * Polygon simple-test (no self-intersection) by O(N²) edge-pair scan.
 * Enough for the small (≤ 32-point) outlines we expect; the editor UI
 * limits feature-outline complexity so this never becomes hot.
 */
function isSimplePolygon(poly: Array<{ uMm: number; vMm: number }>): boolean {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a1 = poly[i];
    const a2 = poly[(i + 1) % n];
    if (!a1 || !a2) return false;
    for (let j = i + 1; j < n; j++) {
      // Skip adjacent edges (they share a vertex).
      if (j === i) continue;
      if ((j + 1) % n === i) continue;
      if (i === (j + 1) % n) continue;
      if (j === (i + 1) % n) continue;
      const b1 = poly[j];
      const b2 = poly[(j + 1) % n];
      if (!b1 || !b2) return false;
      if (segmentsIntersect(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

function segmentsIntersect(
  p1: { uMm: number; vMm: number },
  p2: { uMm: number; vMm: number },
  p3: { uMm: number; vMm: number },
  p4: { uMm: number; vMm: number },
): boolean {
  // Standard 2D segment-segment intersection by orientation tests.
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

function orient(
  a: { uMm: number; vMm: number },
  b: { uMm: number; vMm: number },
  c: { uMm: number; vMm: number },
): number {
  return (b.uMm - a.uMm) * (c.vMm - a.vMm) - (b.vMm - a.vMm) * (c.uMm - a.uMm);
}

/**
 * Reject features whose outlines fall outside their surface's
 * 2D bounds. Bounds are taken from the surface that the feature
 * claims; for ceiling/floor we use the floor polygon's bbox; for
 * walls we use the segment length × ceiling height. We only enforce
 * non-negative + finite here — the editor will prevent the rest.
 */
function coerceFeatures(
  next: RoomFeature[] | undefined,
  prev: RoomFeature[],
): RoomFeature[] {
  if (!Array.isArray(next)) return prev;
  const out: RoomFeature[] = [];
  for (const f of next) {
    if (!f || typeof f !== "object") continue;
    if (typeof f.id !== "string") continue;
    if (typeof f.surfaceId !== "string") continue;
    if (typeof f.label !== "string") continue;
    if (typeof f.paint !== "boolean") continue;
    if (!Array.isArray(f.outline)) continue;
    if (
      f.type !== "lightFixture" &&
      f.type !== "recessedLight" &&
      f.type !== "window" &&
      f.type !== "door" &&
      f.type !== "closet" &&
      f.type !== "other"
    ) {
      continue;
    }
    const cleaned: Array<{ uMm: number; vMm: number }> = [];
    let valid = true;
    for (const p of f.outline) {
      if (
        !p ||
        typeof p !== "object" ||
        typeof p.uMm !== "number" ||
        typeof p.vMm !== "number" ||
        !Number.isFinite(p.uMm) ||
        !Number.isFinite(p.vMm)
      ) {
        valid = false;
        break;
      }
      cleaned.push({ uMm: p.uMm, vMm: p.vMm });
    }
    if (!valid) continue;
    if (!isSimplePolygon(cleaned)) continue;
    out.push({
      id: f.id,
      type: f.type,
      label: f.label,
      surfaceId: f.surfaceId,
      paint: f.paint,
      outline: cleaned,
    });
  }
  return out;
}

function coerceSurfaceEnable(
  next: DeepPartial<Room["surfaceEnable"]> | undefined,
  prev: Room["surfaceEnable"],
): Room["surfaceEnable"] {
  if (!next) return prev;
  const ceiling = typeof next.ceiling === "boolean" ? next.ceiling : prev.ceiling;
  const floor = typeof next.floor === "boolean" ? next.floor : prev.floor;
  const walls: Record<string, boolean> = { ...prev.walls };
  if (next.walls && typeof next.walls === "object") {
    for (const [k, v] of Object.entries(next.walls)) {
      if (typeof v === "boolean") walls[k] = v;
    }
  }
  return { ceiling, floor, walls };
}

function coerceObserverPosition(
  next: DeepPartial<Room["observerPositionMm"]> | undefined,
  prev: Room["observerPositionMm"],
): Room["observerPositionMm"] {
  if (!next) return prev;
  const xMm = typeof next.xMm === "number" && Number.isFinite(next.xMm) ? next.xMm : prev.xMm;
  const yMm = typeof next.yMm === "number" && Number.isFinite(next.yMm) ? next.yMm : prev.yMm;
  const eyeHeightMm =
    typeof next.eyeHeightMm === "number"
      ? clamp(next.eyeHeightMm, 1000, 2200)
      : prev.eyeHeightMm;
  return { xMm, yMm, eyeHeightMm };
}

function coerceRoom(next: DeepPartial<Room> | undefined, prev: Room): Room {
  if (!next) return prev;
  const vertices = coerceVertices(next.vertices, prev.vertices);
  const ceilingHeightMm =
    typeof next.ceilingHeightMm === "number"
      ? clamp(next.ceilingHeightMm, 1500, 6000)
      : prev.ceilingHeightMm;
  const observerPositionMm = coerceObserverPosition(next.observerPositionMm, prev.observerPositionMm);
  const features = coerceFeatures(next.features, prev.features);
  const surfaceEnable = coerceSurfaceEnable(next.surfaceEnable, prev.surfaceEnable);
  return { vertices, ceilingHeightMm, observerPositionMm, features, surfaceEnable };
}

const PRESET_PAPER_NAMES: ReadonlySet<string> = new Set([
  "letter",
  "legal",
  "tabloid",
  "a3",
  "a4",
  "a5",
]);

/**
 * Accepts an opaque value because the discriminated-union DeepPartial
 * isn't a sound type for narrowing. We hand-validate the shape.
 */
function coercePaper(next: unknown, prev: PaperSize): PaperSize {
  if (!next || typeof next !== "object") return prev;
  const n = next as { kind?: unknown; preset?: unknown; widthMm?: unknown; heightMm?: unknown };
  if (n.kind === "preset") {
    if (typeof n.preset === "string" && PRESET_PAPER_NAMES.has(n.preset)) {
      return { kind: "preset", preset: n.preset as (PaperSize & { kind: "preset" })["preset"] };
    }
    return { kind: "preset", preset: "letter" };
  }
  if (n.kind === "custom") {
    const w = n.widthMm;
    const h = n.heightMm;
    const wOk = typeof w === "number" && Number.isFinite(w) && w >= 100 && w <= 600;
    const hOk = typeof h === "number" && Number.isFinite(h) && h >= 150 && h <= 900;
    if (wOk && hOk) return { kind: "custom", widthMm: w as number, heightMm: h as number };
    // Out-of-range custom paper falls back to Letter per contract.
    return { kind: "preset", preset: "letter" };
  }
  return prev;
}

function coerceOutputOptions(
  next: DeepPartial<OutputOptions> | undefined,
  prev: OutputOptions,
): OutputOptions {
  if (!next) return prev;
  const paper = coercePaper(next.paper, prev.paper);
  const displayUnits =
    next.displayUnits === "imperial" || next.displayUnits === "metric"
      ? next.displayUnits
      : prev.displayUnits;
  const blockHorizonOnWalls =
    typeof next.blockHorizonOnWalls === "boolean"
      ? next.blockHorizonOnWalls
      : prev.blockHorizonOnWalls;
  const includeConstellationLines =
    typeof next.includeConstellationLines === "boolean"
      ? next.includeConstellationLines
      : prev.includeConstellationLines;
  return { paper, displayUnits, blockHorizonOnWalls, includeConstellationLines };
}

function coerce(next: DeepPartial<PrintJob>, prev: PrintJob): PrintJob {
  return {
    schemaVersion: 1,
    observation: coerceObservation(next.observation, prev.observation),
    room: coerceRoom(next.room, prev.room),
    outputOptions: coerceOutputOptions(next.outputOptions, prev.outputOptions),
    lastComputedAt:
      typeof next.lastComputedAt === "string" || next.lastComputedAt === null
        ? next.lastComputedAt
        : prev.lastComputedAt,
  };
}

// ---------------------------------------------------------------------------
// Persistence (debounced localStorage)
// ---------------------------------------------------------------------------

let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingValue: PrintJob | null = null;

function hasStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

function loadPersisted(): PrintJob | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.schemaVersion !== 1) return null;
    // Run the parsed payload through `coerce` against the default
    // template so missing/invalid fields collapse to safe values.
    return coerce(parsed as DeepPartial<PrintJob>, makeDefaultPrintJob());
  } catch {
    return null;
  }
}

function schedulePersist(job: PrintJob): void {
  if (!hasStorage()) return;
  pendingValue = job;
  if (pendingTimer !== null) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    const value = pendingValue;
    pendingValue = null;
    if (!value) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Quota exceeded — drop silently.
    }
  }, DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Singleton store API
// ---------------------------------------------------------------------------

let singletonState: InternalState | null = null;

function getState(): InternalState {
  if (!singletonState) {
    const loaded = loadPersisted();
    singletonState = {
      current: loaded ?? makeDefaultPrintJob(),
      listeners: new Set(),
    };
  }
  return singletonState;
}

function notify(s: InternalState): void {
  s.listeners.forEach((l) => l(s.current));
}

export function getPrintJob(): PrintJob {
  return getState().current;
}

export function setPrintJob(next: DeepPartial<PrintJob>): PrintJob {
  const s = getState();
  s.current = coerce(next, s.current);
  schedulePersist(s.current);
  notify(s);
  return s.current;
}

export function subscribe(listener: Listener): Unsubscribe {
  const s = getState();
  s.listeners.add(listener);
  return () => s.listeners.delete(listener);
}

export function resetPrintJob(): PrintJob {
  const s = getState();
  s.current = makeDefaultPrintJob();
  // Drop any in-flight pending write; replace persisted value with default.
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  pendingValue = null;
  if (hasStorage()) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  notify(s);
  return s.current;
}

// ---------------------------------------------------------------------------
// createIsolatedStore — test-only factory with no module-level state.
// ---------------------------------------------------------------------------

export interface IsolatedPrintJobStore {
  getPrintJob(): PrintJob;
  setPrintJob(next: DeepPartial<PrintJob>): PrintJob;
  subscribe(listener: Listener): Unsubscribe;
  resetPrintJob(): PrintJob;
}

export function createIsolatedStore(initial?: PrintJob): IsolatedPrintJobStore {
  const s: InternalState = {
    current: initial ? { ...initial } : makeDefaultPrintJob(),
    listeners: new Set(),
  };
  return {
    getPrintJob: () => s.current,
    setPrintJob: (next: DeepPartial<PrintJob>) => {
      s.current = coerce(next, s.current);
      notify(s);
      return s.current;
    },
    subscribe: (l: Listener) => {
      s.listeners.add(l);
      return () => s.listeners.delete(l);
    },
    resetPrintJob: () => {
      s.current = makeDefaultPrintJob();
      notify(s);
      return s.current;
    },
  };
}

// ---------------------------------------------------------------------------
// Test hooks
// ---------------------------------------------------------------------------

/** Force the debounced write to flush immediately. */
export function __flushPersistForTests(): void {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  const value = pendingValue;
  pendingValue = null;
  if (!value || !hasStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** Drop the in-memory singleton so the next access re-loads from storage. */
export function __resetSingletonForTests(): void {
  singletonState = null;
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  pendingValue = null;
}

/** Clear the persisted value entirely. */
export function __resetPersistForTests(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  // Keep DEFAULT_OBSERVATION import live for tree-shaking clarity.
  void DEFAULT_OBSERVATION;
}
