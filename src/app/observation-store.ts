// T016 — Observation state store. Single source of truth for the user's
// inputs. Enforces the coercion rules from contracts/observation-api.md:
// bearingDeg wraps mod 360; fovDeg clamps to 30..180; playback.rate
// clamps to ±86400. Re-derives utcInstant from the local triple on every
// mutation that touches date/time/tz.
import {
  DEFAULT_OBSERVATION,
  VERIFIED_DATE_RANGE,
  type Observation,
  type ObservationLocation,
  type PlaybackState,
} from "./types";
import { loadPersisted, schedulePersist } from "./persistence";

export type Unsubscribe = () => void;

type Listener = (obs: Observation) => void;

interface InternalState {
  current: Observation;
  listeners: Set<Listener>;
}

function wrap360(x: number): number {
  const w = x % 360;
  return w < 0 ? w + 360 : w;
}

function clamp(x: number, lo: number, hi: number): number {
  if (Number.isNaN(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function coerceLocation(
  next: Partial<ObservationLocation> | undefined,
  prev: ObservationLocation
): ObservationLocation {
  if (!next) return prev;
  const lat = typeof next.lat === "number" ? clamp(next.lat, -90, 90) : prev.lat;
  const lon = typeof next.lon === "number" ? clamp(next.lon, -180, 180) : prev.lon;
  const label = typeof next.label === "string" || next.label === null ? next.label : prev.label;
  return { lat, lon, label };
}

function coercePlayback(
  next: Partial<PlaybackState> | undefined,
  prev: PlaybackState
): PlaybackState {
  if (!next) return prev;
  const rate = typeof next.rate === "number" ? clamp(next.rate, -86400, 86400) : prev.rate;
  const paused = typeof next.paused === "boolean" ? next.paused : prev.paused;
  return { rate, paused };
}

// Compose local date+time+offset into a UTC instant.
function computeUtcInstant(
  localDate: string,
  localTime: string,
  utcOffsetMinutes: number
): string {
  // Parse as a naive local clock reading, then shift by offset.
  const dateParts = localDate.split("-").map(Number);
  const timeParts = localTime.split(":").map(Number);
  const y = dateParts[0];
  const mo = dateParts[1];
  const d = dateParts[2];
  const h = timeParts[0];
  const mi = timeParts[1];
  if (
    y === undefined ||
    mo === undefined ||
    d === undefined ||
    h === undefined ||
    mi === undefined ||
    !Number.isFinite(y) ||
    !Number.isFinite(mo) ||
    !Number.isFinite(d) ||
    !Number.isFinite(h) ||
    !Number.isFinite(mi)
  ) {
    // Fall back: treat as epoch so the UI shows an invalid state rather than throwing.
    return new Date(0).toISOString();
  }
  const localEpoch = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  return new Date(localEpoch - utcOffsetMinutes * 60_000).toISOString();
}

function coerce(next: Partial<Observation>, prev: Observation): Observation {
  const bearingDeg =
    typeof next.bearingDeg === "number" ? wrap360(next.bearingDeg) : prev.bearingDeg;
  const fovDeg = typeof next.fovDeg === "number" ? clamp(next.fovDeg, 30, 180) : prev.fovDeg;
  const location = coerceLocation(next.location, prev.location);
  const playback = coercePlayback(next.playback, prev.playback);
  const localDate = typeof next.localDate === "string" ? next.localDate : prev.localDate;
  const localTime = typeof next.localTime === "string" ? next.localTime : prev.localTime;
  const timeZone = typeof next.timeZone === "string" ? next.timeZone : prev.timeZone;
  const utcOffsetMinutes =
    typeof next.utcOffsetMinutes === "number"
      ? clamp(next.utcOffsetMinutes, -840, 900)
      : prev.utcOffsetMinutes;

  // Re-derive canonical utcInstant unless caller supplied it directly (rare).
  const needsUtcRecompute =
    next.utcInstant === undefined ||
    next.localDate !== undefined ||
    next.localTime !== undefined ||
    next.utcOffsetMinutes !== undefined;
  const utcInstant = needsUtcRecompute
    ? computeUtcInstant(localDate, localTime, utcOffsetMinutes)
    : next.utcInstant!;

  return {
    schemaVersion: 1,
    utcInstant,
    localDate,
    localTime,
    timeZone,
    utcOffsetMinutes,
    location,
    bearingDeg,
    fovDeg,
    playback,
  };
}

function createState(initial: Observation): InternalState {
  return { current: initial, listeners: new Set() };
}

// Module-level singleton. If a caller wants an isolated store (e.g. a test),
// use `createStore()` below.
let singletonState: InternalState | null = null;

function getState(): InternalState {
  if (!singletonState) {
    const loaded = loadPersisted();
    singletonState = createState(loaded ?? DEFAULT_OBSERVATION);
  }
  return singletonState;
}

function notify(s: InternalState): void {
  s.listeners.forEach((l) => l(s.current));
}

export function getObservation(): Observation {
  return getState().current;
}

export function setObservation(next: Partial<Observation>): Observation {
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

export function resetToDefault(): Observation {
  const s = getState();
  s.current = { ...DEFAULT_OBSERVATION };
  schedulePersist(s.current);
  notify(s);
  return s.current;
}

export function isOutsideVerifiedDateRange(obs: Observation): boolean {
  const t = Date.parse(obs.utcInstant);
  return t < VERIFIED_DATE_RANGE.minUtcMs || t > VERIFIED_DATE_RANGE.maxUtcMs;
}

// Test-only: create an isolated store. Main app should use the singleton.
export function createStore(initial: Observation = DEFAULT_OBSERVATION) {
  const s = createState({ ...initial });
  return {
    getObservation: () => s.current,
    setObservation: (next: Partial<Observation>) => {
      s.current = coerce(next, s.current);
      notify(s);
      return s.current;
    },
    subscribe: (l: Listener): Unsubscribe => {
      s.listeners.add(l);
      return () => s.listeners.delete(l);
    },
    resetToDefault: () => {
      s.current = { ...DEFAULT_OBSERVATION };
      notify(s);
      return s.current;
    },
  };
}

// Test-only: clear the singleton so a fresh instance is built on next access.
export function __resetSingletonForTests(): void {
  singletonState = null;
}
