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

export function createPlaybackController(): PlaybackController {
  let anchor = Date.parse(getObservation().utcInstant);
  let current = anchor;

  subscribe((obs) => {
    // If the user manually edited date/time/tz, move the anchor there.
    const newAnchor = Date.parse(obs.utcInstant);
    if (!Number.isNaN(newAnchor) && newAnchor !== anchor) {
      anchor = newAnchor;
      current = newAnchor;
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
}
