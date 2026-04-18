// T043 — Playback control bar. Pause/play + speed + reset-to-instant.
// Per FR-006a: visible + reachable in ≤1 user action.
import {
  getObservation,
  setObservation,
  subscribe,
} from "../app/observation-store";

interface PlaybackController {
  /** The anchor instant — the "entered" utcInstant we snap back to. */
  getAnchorUtcMs(): number;
  setAnchor(utcMs: number): void;
  /** Current playback utcMs (advances via tickPlayback). */
  getCurrentUtcMs(): number;
  /** Advance by wall-clock dt, returns new currentUtcMs. */
  tick(dtWallMs: number): number;
  /** Reset currentUtcMs back to the anchor. */
  resetToAnchor(): void;
}

// Module-level bookkeeping for the date/time → store sync loop. Shared
// between createPlaybackController (which observes user edits via
// subscribe) and mountPlaybackControl (which runs the periodic sync).
// Module-level is fine because the app only creates a single controller.
let _lastUserEditMs = 0;
let _ownWriteInFlight = false;

export function createPlaybackController(): PlaybackController {
  let anchor = Date.parse(getObservation().utcInstant);
  let current = anchor;

  // Track the last-seen values so we can detect user edits (as opposed
  // to our own periodic sync writes below).
  let lastKnownLocalDate = getObservation().localDate;
  let lastKnownLocalTime = getObservation().localTime;

  subscribe((obs) => {
    // If the user manually edited date/time/tz, move the anchor there.
    const newAnchor = Date.parse(obs.utcInstant);
    if (!Number.isNaN(newAnchor) && newAnchor !== anchor) {
      anchor = newAnchor;
      current = newAnchor;
    }
    // Attribute any localDate/localTime change to user vs. our own sync.
    if (
      obs.localDate !== lastKnownLocalDate ||
      obs.localTime !== lastKnownLocalTime
    ) {
      lastKnownLocalDate = obs.localDate;
      lastKnownLocalTime = obs.localTime;
      if (!_ownWriteInFlight) {
        _lastUserEditMs = Date.now();
      }
    }
  });

  return {
    getAnchorUtcMs: () => anchor,
    setAnchor: (ms) => {
      anchor = ms;
      current = ms;
    },
    getCurrentUtcMs: () => current,
    tick: (dtWall) => {
      const obs = getObservation();
      if (obs.playback.paused) return current;
      current += dtWall * obs.playback.rate;
      return current;
    },
    resetToAnchor: () => {
      current = anchor;
    },
  };
}

const SPEEDS: Array<{ rate: number; label: string }> = [
  { rate: -3600, label: "−1h/s" },
  { rate: -60, label: "−1m/s" },
  { rate: 1, label: "1×" },
  { rate: 60, label: "1m/s" },
  { rate: 600, label: "10m/s" },
  { rate: 3600, label: "1h/s" },
];

/** Grace period after a user edit during which we skip periodic syncs. */
const USER_EDIT_GRACE_MS = 2000;
/** How often to push playback's currentUtcMs back into the observation store. */
const SYNC_INTERVAL_MS = 500;

/**
 * Convert a UTC ms value into the observation's local YYYY-MM-DD and
 * HH:MM strings, mirroring the "nominal offset" semantics used for the
 * clock readout below (ignores DST transitions within playback).
 */
function utcMsToLocalParts(
  utcMs: number,
  utcOffsetMinutes: number
): { localDate: string; localTime: string } {
  const local = new Date(utcMs + utcOffsetMinutes * 60_000);
  const iso = local.toISOString(); // safe — getTime is shifted
  const [d, tFull] = iso.split("T") as [string, string];
  const localTime = tFull.slice(0, 5); // HH:MM
  return { localDate: d, localTime };
}

export function mountPlaybackControl(
  parent: HTMLElement,
  controller: PlaybackController
): void {
  const panel = document.createElement("div");
  panel.className = "panel row";
  panel.setAttribute("role", "toolbar");
  panel.setAttribute("aria-label", "Playback controls");

  const pauseBtn = document.createElement("button");
  pauseBtn.type = "button";
  pauseBtn.setAttribute("aria-pressed", "false");
  pauseBtn.textContent = "Pause";
  pauseBtn.addEventListener("click", () => {
    const obs = getObservation();
    setObservation({ playback: { ...obs.playback, paused: !obs.playback.paused } });
  });

  const speedSelect = document.createElement("select");
  speedSelect.setAttribute("aria-label", "Playback rate");
  for (const s of SPEEDS) {
    const opt = document.createElement("option");
    opt.value = String(s.rate);
    opt.textContent = s.label;
    speedSelect.append(opt);
  }
  speedSelect.value = String(getObservation().playback.rate);
  speedSelect.addEventListener("change", () => {
    const rate = Number(speedSelect.value);
    const obs = getObservation();
    setObservation({ playback: { ...obs.playback, rate } });
  });

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.textContent = "Reset";
  resetBtn.title = "Return to entered instant";
  resetBtn.addEventListener("click", () => {
    controller.resetToAnchor();
  });

  const clockReadout = document.createElement("span");
  clockReadout.className = "readout";
  clockReadout.setAttribute("aria-live", "off");

  panel.append(pauseBtn, speedSelect, resetBtn, clockReadout);
  parent.append(panel);

  const refreshStatic = () => {
    const obs = getObservation();
    pauseBtn.textContent = obs.playback.paused ? "Play" : "Pause";
    pauseBtn.setAttribute("aria-pressed", String(obs.playback.paused));
    if (speedSelect.value !== String(obs.playback.rate)) {
      speedSelect.value = String(obs.playback.rate);
    }
  };
  subscribe(refreshStatic);
  refreshStatic();

  // Tick the on-screen clock readout at ~4 Hz (decoupled from render loop).
  setInterval(() => {
    const ms = controller.getCurrentUtcMs();
    const d = new Date(ms);
    const obs = getObservation();
    // Display in the observation's nominal offset (approximate; ignores DST transitions within playback).
    const local = new Date(ms + obs.utcOffsetMinutes * 60_000);
    const hh = String(local.getUTCHours()).padStart(2, "0");
    const mm = String(local.getUTCMinutes()).padStart(2, "0");
    const ss = String(local.getUTCSeconds()).padStart(2, "0");
    const isoDate = local.toISOString().slice(0, 10);
    clockReadout.textContent = `${isoDate} ${hh}:${mm}:${ss}${obs.playback.paused ? " ⏸" : ""}`;
    void d;
  }, 250);

  // Periodically push the current playback instant back into the
  // observation store as localDate/localTime so the top-bar date/time
  // inputs stay in sync with the moving sky. See Issue 1 in the spec.
  //
  //   - Rate-limited to ~2 Hz to avoid localStorage thrash.
  //   - Paused when the user has recently typed into the date/time
  //     inputs (2 s grace window), to avoid clobbering in-progress
  //     edits with a stale playback position.
  //   - Skipped when the values haven't actually changed (the store
  //     short-circuits no-op writes via setObservation coercion; we
  //     still avoid the scheduled localStorage write by bailing early).
  setInterval(() => {
    if (Date.now() - _lastUserEditMs < USER_EDIT_GRACE_MS) return;
    const obs = getObservation();
    const ms = controller.getCurrentUtcMs();
    const { localDate, localTime } = utcMsToLocalParts(ms, obs.utcOffsetMinutes);
    if (localDate === obs.localDate && localTime === obs.localTime) return;
    _ownWriteInFlight = true;
    try {
      setObservation({ localDate, localTime });
    } finally {
      _ownWriteInFlight = false;
    }
  }, SYNC_INTERVAL_MS);
}
