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

/** Per-feature layer visibility toggles driving the DOM overlay labels. */
export interface LayerVisibility {
  /** Constellation stick-figure lines (rendered by WebGL/Canvas). */
  constellationLines: boolean;
  /** Always-on constellation name labels (rendered as DOM overlay). */
  constellationLabels: boolean;
  /** Always-on planet name labels. */
  planetLabels: boolean;
  /** Always-on labels for the ~20 brightest currently-visible named stars. */
  brightStarLabels: boolean;
}

/** Default layer state: on by default except bright-star labels (beginner mode). */
export const DEFAULT_LAYERS: LayerVisibility = {
  constellationLines: true,
  constellationLabels: true,
  planetLabels: true,
  brightStarLabels: false,
};

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
  /**
   * Vertical tilt of the view direction, in degrees above the horizon.
   * 0 = looking at the horizon (legacy behaviour); +90 = straight up;
   * negative values look slightly below the horizon. Clamped to
   * [−30, +90].
   */
  pitchDeg: number;
  /** Horizontal field of view, clamped 30..180. */
  fovDeg: number;
  playback: PlaybackState;
  /** Which overlay layers are visible. */
  layers: LayerVisibility;
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
  pitchDeg: 0,
  fovDeg: 90,
  playback: { rate: 60, paused: false },
  layers: { ...DEFAULT_LAYERS },
};

export const VERIFIED_DATE_RANGE = {
  /** Start of 1900 UTC. */
  minUtcMs: Date.UTC(1900, 0, 1),
  /** End of 2100 UTC. */
  maxUtcMs: Date.UTC(2100, 11, 31, 23, 59, 59, 999),
};
