// T018 — Writes the FR-018 textual observation summary into an
// aria-live region. Debounced 200 ms so rapid scrubbing doesn't
// flood screen readers.
import type { Observation } from "./types";

const DEBOUNCE_MS = 200;

let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingObs: Observation | null = null;
let pendingEl: HTMLElement | null = null;

function cardinalFor(bearingDeg: number): string {
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round(((bearingDeg % 360) + 360) / 45) % 8;
  return labels[idx]!;
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "−" : "+";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatLocation(obs: Observation): string {
  const latDir = obs.location.lat >= 0 ? "N" : "S";
  const lonDir = obs.location.lon >= 0 ? "E" : "W";
  const coords = `${Math.abs(obs.location.lat).toFixed(4)}°${latDir} ${Math.abs(obs.location.lon).toFixed(4)}°${lonDir}`;
  if (obs.location.label) return `${obs.location.label} (${coords})`;
  return coords;
}

export function buildSummary(obs: Observation): string {
  const loc = formatLocation(obs);
  const cardinal = cardinalFor(obs.bearingDeg);
  const offset = formatOffset(obs.utcOffsetMinutes);
  return (
    `Sky for ${loc} on ${obs.localDate} at ${obs.localTime} ${obs.timeZone} ` +
    `(UTC${offset}), facing ${cardinal} (${Math.round(obs.bearingDeg)}°), ` +
    `field of view ${Math.round(obs.fovDeg)}°.`
  );
}

function commit(): void {
  pendingTimer = null;
  const obs = pendingObs;
  const el = pendingEl;
  pendingObs = null;
  pendingEl = null;
  if (!obs || !el) return;
  el.textContent = buildSummary(obs);
}

export function updateSummary(obs: Observation, el: HTMLElement): void {
  pendingObs = obs;
  pendingEl = el;
  if (pendingTimer !== null) return;
  pendingTimer = setTimeout(commit, DEBOUNCE_MS);
}

/** Test-only: force immediate commit. */
export function __flushA11yForTests(): void {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    commit();
  }
}
