// T017 — localStorage persistence for the Observation. 500 ms-debounced
// writer; silent fall-through to defaults on any parse failure.
import { DEFAULT_OBSERVATION, type Observation } from "./types";

const STORAGE_KEY = "skyViewer.observation";
const DEBOUNCE_MS = 500;

let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingValue: Observation | null = null;

function hasStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

export function loadPersisted(): Observation | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.schemaVersion !== 1) return null;
    // Shallow shape validation: require the fields we rely on.
    if (typeof parsed.utcInstant !== "string") return null;
    if (typeof parsed.localDate !== "string") return null;
    if (typeof parsed.localTime !== "string") return null;
    if (typeof parsed.timeZone !== "string") return null;
    if (typeof parsed.utcOffsetMinutes !== "number") return null;
    if (!parsed.location || typeof parsed.location !== "object") return null;
    if (typeof parsed.location.lat !== "number" || typeof parsed.location.lon !== "number")
      return null;
    if (typeof parsed.bearingDeg !== "number") return null;
    if (typeof parsed.fovDeg !== "number") return null;
    if (!parsed.playback || typeof parsed.playback !== "object") return null;
    // Forward-compat: pre-pitch observations lack pitchDeg. Default to 0
    // (= looking at horizon, the legacy behaviour) so old persisted state
    // loads cleanly.
    if (typeof parsed.pitchDeg !== "number") {
      parsed.pitchDeg = 0;
    }
    return parsed as Observation;
  } catch {
    return null;
  }
}

export function schedulePersist(obs: Observation): void {
  if (!hasStorage()) return;
  pendingValue = obs;
  if (pendingTimer !== null) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    const value = pendingValue;
    pendingValue = null;
    if (!value) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Quota exceeded or storage disabled — drop silently.
    }
  }, DEBOUNCE_MS);
}

/** Test-only: flush immediately. */
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

/** Test-only: reset the stored value to defaults. */
export function __resetPersistForTests(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  const _ = DEFAULT_OBSERVATION; // keep the import live for tree-shaking clarity
  void _;
}
