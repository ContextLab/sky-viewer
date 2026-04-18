// Default-observation bootstrap helpers.
//
// The product default on first visit is "the user's current location at the
// current wall-clock time", falling back to Moore Hall (now) if geolocation
// is denied, unavailable, or times out. The classic 1969 Moore Hall fixture
// is still exported as DEFAULT_OBSERVATION in ./types for tests and SC-006.

import { DEFAULT_LAYERS, DEFAULT_OBSERVATION, type Observation } from "./types";

/** Current UTC offset (minutes, east-positive) for an IANA zone at a UTC instant. */
function currentOffsetMinutes(zone: string, atUtcMs: number): number {
  // Mirror the shortOffset-parse strategy used by src/ui/tz-resolver.ts.
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
        const m = /(?:GMT|UTC)\s*([+-])\s*(\d{1,2})(?::(\d{2}))?/i.exec(p.value);
        if (m) {
          const sign = m[1] === "-" ? -1 : 1;
          const hh = Number(m[2] ?? "0");
          const mm = Number(m[3] ?? "0");
          if (Number.isFinite(hh) && Number.isFinite(mm)) {
            return sign * (hh * 60 + mm);
          }
        }
        if (/^(GMT|UTC)$/i.test(p.value.trim())) return 0;
      }
    }
  } catch {
    // Fall through to the formatToParts-delta strategy.
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
      return DEFAULT_OBSERVATION.utcOffsetMinutes;
    }
    const localAsUtcMs = Date.UTC(y, mo - 1, d, h, mi, s);
    return Math.round((localAsUtcMs - atUtcMs) / 60000);
  } catch {
    return DEFAULT_OBSERVATION.utcOffsetMinutes;
  }
}

/**
 * Given a zone + a UTC instant, derive the local (YYYY-MM-DD, HH:MM) triple
 * observed in that zone. Used to populate the form fields.
 */
function localTripleInZone(
  zone: string,
  atUtcMs: number
): { localDate: string; localTime: string } {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date(atUtcMs));
    const getPart = (t: string): string => {
      const p = parts.find((x) => x.type === t);
      return p ? p.value : "";
    };
    const y = getPart("year").padStart(4, "0");
    const mo = getPart("month").padStart(2, "0");
    const d = getPart("day").padStart(2, "0");
    let h = getPart("hour");
    if (h === "24") h = "00";
    h = h.padStart(2, "0");
    const mi = getPart("minute").padStart(2, "0");
    if (y && mo && d && h && mi) {
      return { localDate: `${y}-${mo}-${d}`, localTime: `${h}:${mi}` };
    }
  } catch {
    // fall through
  }
  // Last-resort: pretend the instant is already UTC-local.
  const dt = new Date(atUtcMs);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return {
    localDate: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`,
    localTime: `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`,
  };
}

/**
 * Moore Hall at the current wall time. Used as the non-geolocated fallback
 * when geolocation is denied/unavailable. Shares DEFAULT_OBSERVATION's
 * location, bearing, fov, and playback; only the temporal fields are "now".
 */
export function buildCurrentTimeDefaultAtMooreHall(): Observation {
  const nowMs = Date.now();
  const zone = DEFAULT_OBSERVATION.timeZone;
  const utcOffsetMinutes = currentOffsetMinutes(zone, nowMs);
  const { localDate, localTime } = localTripleInZone(zone, nowMs);
  return {
    schemaVersion: 1,
    utcInstant: new Date(nowMs).toISOString(),
    localDate,
    localTime,
    timeZone: zone,
    utcOffsetMinutes,
    location: { ...DEFAULT_OBSERVATION.location },
    bearingDeg: DEFAULT_OBSERVATION.bearingDeg,
    pitchDeg: DEFAULT_OBSERVATION.pitchDeg,
    fovDeg: DEFAULT_OBSERVATION.fovDeg,
    playback: { ...DEFAULT_OBSERVATION.playback },
    layers: { ...DEFAULT_LAYERS },
  };
}

/**
 * Partial observation returned by a successful geolocation prompt. The
 * caller is responsible for resolving the IANA zone via tz-resolver and
 * filling in a "Near <city>" label.
 */
export interface GeolocatedDefault {
  lat: number;
  lon: number;
  /** ISO 8601 UTC instant at the moment geolocation resolved. */
  utcInstant: string;
  /** Milliseconds-since-epoch matching utcInstant, for tz-resolver. */
  utcMs: number;
}

/**
 * Attempt to read the user's current position via navigator.geolocation.
 *
 * - Returns null on denial, timeout, missing API, or any error.
 * - Honours a persistent "denied" permission (if the Permissions API is
 *   available) without re-prompting.
 * - No throwing, no console.error on the expected-denial path.
 */
export async function buildGeolocatedDefault(
  timeoutMs = 5000
): Promise<GeolocatedDefault | null> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return null;
  }

  // Respect a persistent "denied" permission without re-prompting.
  try {
    const perms = (navigator as Navigator & {
      permissions?: { query: (d: { name: PermissionName }) => Promise<PermissionStatus> };
    }).permissions;
    if (perms && typeof perms.query === "function") {
      const status = await perms.query({ name: "geolocation" as PermissionName });
      if (status.state === "denied") return null;
    }
  } catch {
    // Permissions API is optional; fall through to direct prompt.
  }

  return new Promise<GeolocatedDefault | null>((resolve) => {
    let settled = false;
    const finish = (v: GeolocatedDefault | null): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    // Hard timeout guard - getCurrentPosition's own timeout is honoured
    // too, but some browsers silently hang on insecure contexts.
    const timer = setTimeout(() => finish(null), timeoutMs);

    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer);
          const nowMs = Date.now();
          finish({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            utcInstant: new Date(nowMs).toISOString(),
            utcMs: nowMs,
          });
        },
        () => {
          clearTimeout(timer);
          finish(null);
        },
        { maximumAge: 600_000, timeout: timeoutMs }
      );
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

/**
 * Compose a complete Observation from a resolved geolocation + tz lookup +
 * (optional) nearest-city label. Exposed as a helper so main.ts doesn't
 * repeat the local-triple derivation.
 */
export function composeGeolocatedObservation(
  geo: GeolocatedDefault,
  timeZone: string,
  utcOffsetMinutes: number,
  label: string | null
): Observation {
  const { localDate, localTime } = localTripleInZone(timeZone, geo.utcMs);
  return {
    schemaVersion: 1,
    utcInstant: geo.utcInstant,
    localDate,
    localTime,
    timeZone,
    utcOffsetMinutes,
    location: { lat: geo.lat, lon: geo.lon, label },
    bearingDeg: DEFAULT_OBSERVATION.bearingDeg,
    pitchDeg: DEFAULT_OBSERVATION.pitchDeg,
    fovDeg: DEFAULT_OBSERVATION.fovDeg,
    playback: { ...DEFAULT_OBSERVATION.playback },
    layers: { ...DEFAULT_LAYERS },
  };
}
