// Shared runtime types used across the app, store, and renderer.
// Kept separate from src/astro/* so the astronomy modules remain DOM-free.

export interface ObservationLocation {
  lat: number;
  lon: number;
  label: string | null;
}

export interface PlaybackState {
  /** Sky-seconds per wall-second. 1 = real time, 60 = 1 min/sec, −60 = reverse. */
  rate: number;
  paused: boolean;
}

export interface Observation {
  /** Forward-migration hook. Current schema = 1. */
  schemaVersion: 1;
  /** ISO 8601 UTC instant (canonical resolved moment). */
  utcInstant: string;
  /** YYYY-MM-DD as entered by user. */
  localDate: string;
  /** HH:MM (24h) as entered by user. */
  localTime: string;
  /** IANA timezone identifier. */
  timeZone: string;
  /** Offset from UTC in minutes (east-positive). */
  utcOffsetMinutes: number;
  location: ObservationLocation;
  /** Compass bearing, 0..360, wrapping. */
  bearingDeg: number;
  /** Horizontal field of view, clamped 30..180. */
  fovDeg: number;
  playback: PlaybackState;
}

/** FR-000: canonical default observation, also the SC-006 regression fixture. */
export const DEFAULT_OBSERVATION: Observation = {
  schemaVersion: 1,
  utcInstant: "1969-12-13T05:00:00.000Z",
  localDate: "1969-12-13",
  localTime: "00:00",
  timeZone: "America/New_York",
  utcOffsetMinutes: -300,
  location: {
    lat: 43.7044,
    lon: -72.2887,
    label: "Moore Hall, Dartmouth College, Hanover, NH",
  },
  bearingDeg: 0,
  fovDeg: 90,
  playback: { rate: 60, paused: false },
};

export const VERIFIED_DATE_RANGE = {
  /** Start of 1900 UTC. */
  minUtcMs: Date.UTC(1900, 0, 1),
  /** End of 2100 UTC. */
  maxUtcMs: Date.UTC(2100, 11, 31, 23, 59, 59, 999),
};
