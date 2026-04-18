// Night Mode — a real-time AR-style view that slaves the Observation to the
// device's GPS + compass sensors so the rendered sky lines up with where the
// user is actually pointing the phone.
//
// Contract:
//   export function mountNightModeToggle(parent: HTMLElement): void
//
// Behaviour:
//   - Renders a prominent moon-icon button in the top bar.
//   - On click: if DeviceOrientationEvent.requestPermission exists (iOS 13+),
//     prompt for sensor access. On grant, subscribe to `deviceorientation`
//     and `navigator.geolocation.watchPosition`, pause normal playback, and
//     start pushing sensor readings into the store.
//   - Sensor readings are coalesced through requestAnimationFrame and
//     committed at most ~20 Hz to avoid flooding setObservation.
//   - On second click, cleanly unsubscribe, restore the prior playback
//     state, and switch the button back.
//   - Any error path (permission denied, API absent, GPS error) keeps the
//     app in its pre-night-mode state and shows a short auto-dismissing
//     toast banner.

import { getObservation, setObservation } from "../app/observation-store";
import { resolveTz } from "./tz-resolver";
import type { PlaybackState } from "../app/types";

// ---------------------------------------------------------------------------
// iOS 13+ adds a static requestPermission() to DeviceOrientationEvent. It's
// absent on Android/desktop — we feature-detect rather than rely on `any`.

interface DeviceOrientationEventWithPermission {
  requestPermission?: () => Promise<"granted" | "denied">;
}

interface WebkitOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

// `DeviceOrientationEvent` already declares `absolute: boolean`; alias for clarity.
type AbsoluteOrientationEvent = DeviceOrientationEvent;

// Commit cadence: raw deviceorientation fires at 60+ Hz on iOS. We coalesce
// through a single animation frame and a minimum interval so the store (and
// downstream persistence + notify fan-out) isn't overwhelmed.
const COMMIT_INTERVAL_MS = 50; // ~20 Hz

// ---------------------------------------------------------------------------
// Module-local state. A second call to mountNightModeToggle would be a bug;
// we guard against it but the normal flow is one mount per page load.

interface SavedState {
  bearingDeg: number;
  pitchDeg: number;
  playback: PlaybackState;
  location: { lat: number; lon: number; label: string | null };
  timeZone: string;
  utcOffsetMinutes: number;
}

interface LatestReading {
  // Heading in compass-degrees (0 = N, 90 = E, clockwise). null = unknown yet.
  headingDeg: number | null;
  // Pitch in our convention: 0 = looking at horizon, +90 = straight up.
  pitchDeg: number | null;
  // Live GPS lat/lon. null = no fix yet.
  lat: number | null;
  lon: number | null;
  // Whether the current heading source is known to be absolute (true compass).
  headingAbsolute: boolean;
}

let mounted = false;
let isActive = false;
let cleanups: Array<() => void> = [];
let saved: SavedState | null = null;
let latest: LatestReading = {
  headingDeg: null,
  pitchDeg: null,
  lat: null,
  lon: null,
  headingAbsolute: false,
};
let rafHandle: number | null = null;
let lastCommitAt = 0;
let statusBannerEl: HTMLElement | null = null;
let toastEl: HTMLElement | null = null;
let buttonEl: HTMLButtonElement | null = null;
let calibrationNoteEl: HTMLElement | null = null;

// ---------------------------------------------------------------------------
// Helpers.

function showToast(message: string): void {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.hidden = false;
  window.setTimeout(() => {
    if (toastEl) toastEl.hidden = true;
  }, 4000);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// Derive a compass heading (0 = N, clockwise) from a DeviceOrientationEvent.
// Order of preference: webkitCompassHeading (iOS, already true-north compass),
// alpha when the event is flagged absolute (Android Chrome), else relative
// alpha with a drift warning. Returns null if nothing usable is present.
function headingFromEvent(
  ev: WebkitOrientationEvent & AbsoluteOrientationEvent
): { deg: number; absolute: boolean } | null {
  if (typeof ev.webkitCompassHeading === "number" && Number.isFinite(ev.webkitCompassHeading)) {
    // iOS: already 0 = N, clockwise. This is a true compass heading.
    return { deg: ((ev.webkitCompassHeading % 360) + 360) % 360, absolute: true };
  }
  if (typeof ev.alpha === "number" && Number.isFinite(ev.alpha)) {
    // W3C alpha: 0..360, rotation around the vertical axis, counter-clockwise
    // when looking from above. To convert to a clockwise compass heading:
    //   headingCW = (360 - alpha) mod 360
    const heading = ((360 - ev.alpha) % 360 + 360) % 360;
    const absolute = ev.absolute === true;
    return { deg: heading, absolute };
  }
  return null;
}

// Derive a pitch (0 = horizon, +90 = zenith) from beta/gamma. beta is
// front-back tilt: when the phone is held upright in portrait with the
// screen facing the user, beta ≈ 90 and the camera points at the horizon.
// Tilting the top away (looking up at the sky) pushes beta toward 180.
// We subtract 90 and clamp into the Observation's pitch range [-30, +90].
function pitchFromEvent(ev: DeviceOrientationEvent): number | null {
  if (typeof ev.beta !== "number" || !Number.isFinite(ev.beta)) return null;
  const pitch = ev.beta - 90;
  return clamp(pitch, -30, 90);
}

// ---------------------------------------------------------------------------
// Coalesced commit loop. Runs via requestAnimationFrame when there's a
// pending sensor delta; writes at most once per COMMIT_INTERVAL_MS.

function scheduleCommit(): void {
  if (rafHandle !== null) return;
  rafHandle = requestAnimationFrame(commitFrame);
}

function commitFrame(): void {
  rafHandle = null;
  if (!isActive) return;

  const now = performance.now();
  if (now - lastCommitAt < COMMIT_INTERVAL_MS) {
    // Defer to the next frame; the minimum interval hasn't elapsed.
    rafHandle = requestAnimationFrame(commitFrame);
    return;
  }
  lastCommitAt = now;

  const patch: Parameters<typeof setObservation>[0] = {};

  // Heading → bearingDeg (already 0 = N, clockwise, matching our convention).
  if (latest.headingDeg !== null) {
    patch.bearingDeg = latest.headingDeg;
  }
  if (latest.pitchDeg !== null) {
    patch.pitchDeg = latest.pitchDeg;
  }

  // Real-time clock: rebuild local triple from Date.now() in the current (or
  // freshly-resolved) zone. We always recompute because time is always
  // advancing in night mode.
  const obs = getObservation();
  const nowMs = Date.now();

  let timeZone = obs.timeZone;
  let utcOffsetMinutes = obs.utcOffsetMinutes;

  if (latest.lat !== null && latest.lon !== null) {
    patch.location = {
      lat: latest.lat,
      lon: latest.lon,
      label: "Live position",
    };
    try {
      const tz = resolveTz(latest.lat, latest.lon, nowMs);
      timeZone = tz.zone;
      utcOffsetMinutes = tz.offsetMinutes;
      patch.timeZone = tz.zone;
      patch.utcOffsetMinutes = tz.offsetMinutes;
    } catch {
      // tz resolver may not be loaded yet; keep the previous zone.
    }
  }

  const { localDate, localTime } = localTripleInZone(timeZone, utcOffsetMinutes, nowMs);
  patch.localDate = localDate;
  patch.localTime = localTime;

  setObservation(patch);
}

// Lightweight (timeZone, offset, utcMs) → (YYYY-MM-DD, HH:MM). We avoid
// a second Intl.DateTimeFormat call per frame by offsetting directly when
// the zone lookup already handed us a validated offset.
function localTripleInZone(
  _timeZone: string,
  offsetMinutes: number,
  atUtcMs: number
): { localDate: string; localTime: string } {
  const shifted = new Date(atUtcMs + offsetMinutes * 60_000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  const y = shifted.getUTCFullYear();
  const mo = pad(shifted.getUTCMonth() + 1);
  const d = pad(shifted.getUTCDate());
  const h = pad(shifted.getUTCHours());
  const mi = pad(shifted.getUTCMinutes());
  return { localDate: `${y}-${mo}-${d}`, localTime: `${h}:${mi}` };
}

// ---------------------------------------------------------------------------
// Subscribe / unsubscribe.

function handleOrientation(ev: DeviceOrientationEvent): void {
  const h = headingFromEvent(ev as WebkitOrientationEvent & AbsoluteOrientationEvent);
  if (h) {
    latest.headingDeg = h.deg;
    latest.headingAbsolute = h.absolute;
    if (!h.absolute && calibrationNoteEl) {
      calibrationNoteEl.hidden = false;
    } else if (h.absolute && calibrationNoteEl) {
      calibrationNoteEl.hidden = true;
    }
  }
  const p = pitchFromEvent(ev);
  if (p !== null) {
    latest.pitchDeg = p;
  }
  scheduleCommit();
}

function handlePosition(pos: GeolocationPosition): void {
  latest.lat = pos.coords.latitude;
  latest.lon = pos.coords.longitude;
  scheduleCommit();
}

function handlePositionError(err: GeolocationPositionError): void {
  const reason =
    err.code === 1
      ? "location permission denied"
      : err.code === 2
        ? "position unavailable"
        : err.code === 3
          ? "location timeout"
          : "geolocation error";
  showToast(`Night mode: ${reason}.`);
}

async function enterNightMode(): Promise<void> {
  if (isActive) return;

  // Feature detection.
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    showToast("Night mode unavailable in this environment.");
    return;
  }
  if (!("geolocation" in navigator)) {
    showToast("Night mode needs geolocation, which is not available.");
    return;
  }
  if (typeof window.DeviceOrientationEvent === "undefined") {
    showToast("Night mode needs device orientation sensors (not available).");
    return;
  }

  // Snapshot prior state so Exit can restore it.
  const obs = getObservation();
  saved = {
    bearingDeg: obs.bearingDeg,
    pitchDeg: obs.pitchDeg,
    playback: { ...obs.playback },
    location: { ...obs.location },
    timeZone: obs.timeZone,
    utcOffsetMinutes: obs.utcOffsetMinutes,
  };

  // iOS 13+: explicit permission prompt, must be synchronous with a user gesture.
  const DOE = window.DeviceOrientationEvent as unknown as DeviceOrientationEventWithPermission;
  if (typeof DOE.requestPermission === "function") {
    try {
      const res = await DOE.requestPermission();
      if (res !== "granted") {
        showToast("Night mode: orientation permission denied.");
        saved = null;
        return;
      }
    } catch {
      showToast("Night mode: could not request orientation permission.");
      saved = null;
      return;
    }
  }

  // Try the Permissions API for geolocation — this lets us early-exit if the
  // user has already persistently denied location without re-prompting.
  try {
    const perms = (navigator as Navigator & {
      permissions?: { query: (d: { name: PermissionName }) => Promise<PermissionStatus> };
    }).permissions;
    if (perms && typeof perms.query === "function") {
      const status = await perms.query({ name: "geolocation" as PermissionName });
      if (status.state === "denied") {
        showToast("Night mode: location permission denied.");
        saved = null;
        return;
      }
    }
  } catch {
    // Permissions API is optional; fall through.
  }

  // Subscribe. Prefer the `deviceorientationabsolute` event on platforms that
  // support it — it's always absolute (true compass). Fall back to the
  // standard event otherwise.
  const absoluteSupported =
    typeof (window as unknown as { ondeviceorientationabsolute?: unknown })
      .ondeviceorientationabsolute !== "undefined";
  const eventName = absoluteSupported ? "deviceorientationabsolute" : "deviceorientation";

  try {
    window.addEventListener(eventName, handleOrientation as EventListener, true);
    cleanups.push(() =>
      window.removeEventListener(eventName, handleOrientation as EventListener, true)
    );
  } catch {
    showToast("Night mode: failed to subscribe to orientation sensor.");
    saved = null;
    cleanups.forEach((fn) => fn());
    cleanups = [];
    return;
  }

  let watchId: number | null = null;
  try {
    watchId = navigator.geolocation.watchPosition(handlePosition, handlePositionError, {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 15_000,
    });
    cleanups.push(() => {
      if (watchId !== null) {
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch {
          // ignore
        }
      }
    });
  } catch {
    showToast("Night mode: failed to start geolocation watch.");
    // Unwind any subscriptions already registered.
    cleanups.forEach((fn) => fn());
    cleanups = [];
    saved = null;
    return;
  }

  // Pause normal playback — we're slaved to real wall-clock now.
  setObservation({ playback: { paused: true, rate: 0 } });

  isActive = true;
  latest = {
    headingDeg: null,
    pitchDeg: null,
    lat: null,
    lon: null,
    headingAbsolute: absoluteSupported,
  };
  lastCommitAt = 0;
  updateButtonUi();
  if (statusBannerEl) statusBannerEl.hidden = false;
  if (calibrationNoteEl) calibrationNoteEl.hidden = absoluteSupported;
}

function exitNightMode(): void {
  if (!isActive) return;
  isActive = false;

  cleanups.forEach((fn) => {
    try {
      fn();
    } catch {
      // best effort
    }
  });
  cleanups = [];

  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }

  // Restore prior playback settings (and bearing/pitch/location so we don't
  // leave the user stuck at whatever random heading the phone finished on).
  if (saved) {
    setObservation({
      bearingDeg: saved.bearingDeg,
      pitchDeg: saved.pitchDeg,
      playback: { ...saved.playback },
      location: { ...saved.location },
      timeZone: saved.timeZone,
      utcOffsetMinutes: saved.utcOffsetMinutes,
    });
    saved = null;
  }

  updateButtonUi();
  if (statusBannerEl) statusBannerEl.hidden = true;
  if (calibrationNoteEl) calibrationNoteEl.hidden = true;
}

function updateButtonUi(): void {
  if (!buttonEl) return;
  buttonEl.setAttribute("aria-pressed", String(isActive));
  buttonEl.textContent = isActive ? "☾ Exit Night Mode" : "☾ Night Mode";
  buttonEl.title = isActive
    ? "Stop using device sensors and return to manual control"
    : "Use device GPS + compass to align the sky with what you're pointing at";
}

// ---------------------------------------------------------------------------
// Mount.

export function mountNightModeToggle(parent: HTMLElement): void {
  if (mounted) return;
  mounted = true;

  const panel = document.createElement("div");
  panel.className = "panel night-mode";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "night-mode-button";
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => {
    // Clicks must be synchronous with requestPermission on iOS — enterNightMode
    // awaits inside but the first await is a promise returned from within this
    // same user-gesture tick, which is fine for Safari's policy.
    if (isActive) {
      exitNightMode();
    } else {
      void enterNightMode();
    }
  });
  buttonEl = button;

  const status = document.createElement("div");
  status.className = "night-mode-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = "Night Mode • Live GPS + compass";
  status.hidden = true;
  statusBannerEl = status;

  const calib = document.createElement("div");
  calib.className = "night-mode-calibration";
  calib.textContent =
    "Compass may drift. Point north to calibrate, or adjust with the compass widget.";
  calib.hidden = true;
  calibrationNoteEl = calib;

  const toast = document.createElement("div");
  toast.className = "night-mode-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.hidden = true;
  toastEl = toast;

  panel.append(button, status, calib, toast);
  parent.append(panel);

  updateButtonUi();
}
