// T006 — Type declarations for the Print Mode subsystem.
//
// Mirrors specs/002-stencil-template-pdf/data-model.md verbatim. All
// linear measurements are in millimetres; angles in degrees. The
// `Observation` shape is reused from the parent feature — Print Mode
// snapshots the active observation when it opens but maintains its
// own copy thereafter (FR-001..FR-002).

import { DEFAULT_OBSERVATION, type Observation } from "../app/types";

/** 3D vector in room-local coordinates (millimetres or unitless basis). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Hole-size encoding per FR-011 / R4 (cover-page legend = calibration). */
export type SizeClass = "pencil" | "largeNail" | "smallNail" | "pin";

/** Printed diameter (mm) per size class. */
export const HOLE_DIAMETERS_MM: Record<SizeClass, number> = {
  pencil: 6,
  largeNail: 4,
  smallNail: 2.5,
  pin: 1,
};

/**
 * Magnitude cutoffs for the size-class classifier. The classifier is
 * inclusive on the upper bound: a star with mag === 0 maps to
 * "pencil", mag === 1 → "largeNail", etc. (FR-011, R4):
 *   pencil    : mag ≤ 0
 *   largeNail : 0 < mag ≤ 1
 *   smallNail : 1 < mag ≤ 3
 *   pin       : 3 < mag ≤ 6
 * Stars with mag > 6 are not stencilled (faint cutoff).
 */
export const MAGNITUDE_BOUNDS: {
  pencil: number;
  largeNail: number;
  smallNail: number;
  pin: number;
} = {
  pencil: 0,
  largeNail: 1,
  smallNail: 3,
  pin: 6,
};

/**
 * Map an apparent magnitude to its size class. Returns null when the
 * magnitude is outside the stencilled range (mag > pin cutoff). NaN
 * input is treated as out-of-range.
 */
export function classifyMagnitude(mag: number): SizeClass | null {
  if (!Number.isFinite(mag)) return null;
  if (mag <= MAGNITUDE_BOUNDS.pencil) return "pencil";
  if (mag <= MAGNITUDE_BOUNDS.largeNail) return "largeNail";
  if (mag <= MAGNITUDE_BOUNDS.smallNail) return "smallNail";
  if (mag <= MAGNITUDE_BOUNDS.pin) return "pin";
  return null;
}

/** Paper-size descriptor: a named preset OR explicit custom dimensions. */
export type PaperSize =
  | { kind: "preset"; preset: "letter" | "legal" | "tabloid" | "a3" | "a4" | "a5" }
  | { kind: "custom"; widthMm: number; heightMm: number };

/** Output options shared across the whole print job. */
export interface OutputOptions {
  paper: PaperSize;
  displayUnits: "imperial" | "metric";
  /** FR-008a — when ON, walls clip at horizon; when OFF, walls run continuous. */
  blockHorizonOnWalls: boolean;
  /** R8 — render constellation lines as faint dashed strokes on tile pages. */
  includeConstellationLines: boolean;
}

/** Single 2D footprint on a single Surface (window, door, fixture, etc.). */
export interface RoomFeature {
  id: string;
  type: "lightFixture" | "recessedLight" | "window" | "door" | "closet" | "other";
  label: string;
  /** Refers to "ceiling" | "floor" | "wall-N". */
  surfaceId: string;
  /** Polygon in surface-local 2D coords (u, v) — millimetres. */
  outline: Array<{ uMm: number; vMm: number }>;
  /** TRUE = painted (stars project normally). FALSE = no-paint (cut line). */
  paint: boolean;
}

/** Floor-plan + per-surface data drawn by the user. */
export interface Room {
  /** Floor-plan polygon in millimetres, CCW-wound. */
  vertices: Array<{ xMm: number; yMm: number }>;
  ceilingHeightMm: number;
  observerPositionMm: { xMm: number; yMm: number; eyeHeightMm: number };
  features: RoomFeature[];
  /** Per-surface enable map. `walls` keyed by `wall-N`. */
  surfaceEnable: {
    ceiling: boolean;
    floor: boolean;
    walls: Record<string, boolean>;
  };
}

/** Top-level PrintJob persisted to localStorage["skyViewer.printJob"]. */
export interface PrintJob {
  schemaVersion: 1;
  observation: Observation;
  room: Room;
  outputOptions: OutputOptions;
  /** ISO 8601 UTC; null until first successful Compute. */
  lastComputedAt: string | null;
}

/** Derived 3D pose of a Surface in room-local 3D coords. */
export interface SurfacePose {
  originMm: Vec3;
  uAxisMm: Vec3;
  vAxisMm: Vec3;
}

/** Derived (not persisted) Surface — one per ceiling, floor, or wall. */
export interface Surface {
  id: string;
  kind: "ceiling" | "floor" | "wall";
  label: string;
  widthMm: number;
  heightMm: number;
  originPose: SurfacePose;
  enabled: boolean;
  projectionMode: "aboveHorizon" | "antipodal" | "continuous";
}

/** A single hole on a Tile. */
export interface Hole {
  surfaceUMm: number;
  surfaceVMm: number;
  sizeClass: SizeClass;
  label: string;
  bodyKind: "star" | "planet" | "sun" | "moon";
  apparentMag: number;
}

/** A no-paint feature outline clipped to a single tile. */
export interface FeatureCutout {
  featureId: string;
  clippedOutline: Array<{ uMm: number; vMm: number }>;
}

/** A constellation line segment intersected with a single tile. */
export interface ConstellationSegment {
  aMm: { uMm: number; vMm: number };
  bMm: { uMm: number; vMm: number };
}

/** Bounding rectangle of a tile in surface-local coords. */
export interface TileBounds {
  uMinMm: number;
  vMinMm: number;
  uMaxMm: number;
  vMaxMm: number;
}

/** A single PDF page (tile). 1 per (Surface, row, col). */
export interface Tile {
  surfaceId: string;
  row: number;
  col: number;
  pageNumber: number;
  tileBoundsMm: TileBounds;
  holes: Hole[];
  featureCutouts: FeatureCutout[];
  constellationSegments: ConstellationSegment[];
}

/** Compute result. Held in memory only; not persisted. */
export interface PdfBlob {
  blob: Blob;
  objectUrl: string;
  pageCount: number;
  summary: PreflightSummary;
}

/** Pre-flight summary shown to the user before Compute (SC-008 must match PDF). */
export interface PreflightSummary {
  surfaceCount: number;
  tilePageCount: number;
  coverPageCount: 1;
  totalPageCount: number;
  totalHoles: number;
  holeCountsByClass: {
    pencil: number;
    largeNail: number;
    smallNail: number;
    pin: number;
  };
  paperSheetCount: number;
  estimatedPaintAreaSqMm: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** 12 ft = 3657.6 mm. */
const DEFAULT_ROOM_SIDE_MM = 3657.6;
/** 8 ft = 2438.4 mm — but rounded to 2438 mm per the task spec. */
const DEFAULT_CEILING_HEIGHT_MM = 2438;
/** 5 ft eye height ≈ 1520 mm. */
const DEFAULT_EYE_HEIGHT_MM = 1520;

/**
 * Deep-clone the parent feature's `DEFAULT_OBSERVATION` so callers may
 * freely mutate the print job's observation without poisoning the
 * shared module-level constant.
 */
function cloneDefaultObservation(): Observation {
  return {
    ...DEFAULT_OBSERVATION,
    location: { ...DEFAULT_OBSERVATION.location },
    playback: { ...DEFAULT_OBSERVATION.playback },
    layers: { ...DEFAULT_OBSERVATION.layers },
  };
}

/**
 * The factory ALWAYS returns a freshly-allocated PrintJob. Mutating
 * the result is safe — call sites should treat the return as their
 * own copy.
 */
export function makeDefaultPrintJob(): PrintJob {
  const half = DEFAULT_ROOM_SIDE_MM / 2;
  return {
    schemaVersion: 1,
    observation: cloneDefaultObservation(),
    room: {
      // CCW winding when looking down (+z is up): start at SW, go E, N, W.
      vertices: [
        { xMm: -half, yMm: -half },
        { xMm: half, yMm: -half },
        { xMm: half, yMm: half },
        { xMm: -half, yMm: half },
      ],
      ceilingHeightMm: DEFAULT_CEILING_HEIGHT_MM,
      observerPositionMm: { xMm: 0, yMm: 0, eyeHeightMm: DEFAULT_EYE_HEIGHT_MM },
      features: [],
      surfaceEnable: {
        ceiling: true,
        floor: false,
        // Empty record: walls default to disabled (no key = falsy).
        walls: {},
      },
    },
    outputOptions: {
      paper: { kind: "preset", preset: "letter" },
      displayUnits: "imperial",
      blockHorizonOnWalls: true,
      includeConstellationLines: false,
    },
    lastComputedAt: null,
  };
}

/**
 * Module-level default snapshot for tests / consumers that just want to
 * read the shape. Mutating sub-fields of this object is undefined
 * behaviour — call `makeDefaultPrintJob()` instead.
 */
export const DEFAULT_PRINT_JOB: PrintJob = makeDefaultPrintJob();
