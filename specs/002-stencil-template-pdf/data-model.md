# Phase 1 Data Model: Star-Stencil PDF Generator

**Feature**: 002-stencil-template-pdf
**Date**: 2026-04-27
**Scope**: Persistent and in-memory entities the print-mode subsystem
operates on. Tabular field definitions; relationships; validation
rules drawn from the spec's FRs.

All measurements are stored in **metric** (millimetres for length,
degrees for angles). UI converts at the input/display boundary.

## Entity: PrintJob

The top-level state of a single Print Mode session. Persisted to
`localStorage` under the key `skyViewer.printJob`. One per user, per
device.

| Field | Type | Notes |
|-|-|-|
| `schemaVersion` | `1` | Forward-migration hook. |
| `observation` | `Observation` | Reuses the type from the main feature's `src/app/types.ts`. Defaults to a snapshot of the active main-view observation at the moment Print Mode opens. |
| `room` | `Room` | The drawn floor-plan + features. See below. |
| `outputOptions` | `OutputOptions` | Paper size, units, surface enable map, "Block horizon on walls" flag. |
| `lastComputedAt` | `string \| null` | ISO 8601 UTC. `null` until the first successful Compute. Used to display "Recomputing…" indicators. |

**Validation**:

- `observation` must satisfy the existing `Observation` schema.
- `room.vertices` must form a simple (non-self-intersecting) polygon
  with ≥ 3 vertices.
- `room.ceilingHeightMm` must be 1500…6000 (1.5–6 m, covers 5–20 ft).
- `outputOptions.paper` must be one of the presets OR a custom
  W × H within the bounds documented in the spec's Assumptions.

## Entity: Room

| Field | Type | Notes |
|-|-|-|
| `vertices` | `Array<{ xMm: number; yMm: number }>` | Floor-plan polygon, in millimetres in the room's local 2D frame (x = east, y = north). Counter-clockwise winding. |
| `ceilingHeightMm` | `number` | Single ceiling height; sloped ceilings out of MVP scope. |
| `observerPositionMm` | `{ xMm: number; yMm: number; eyeHeightMm: number }` | Defaults to centroid of `vertices`, eye height 1520 (5 ft). |
| `features` | `Array<RoomFeature>` | All windows, doors, fixtures, etc. across all surfaces. Each carries a surface-id reference. |
| `surfaceEnable` | `{ ceiling: boolean; floor: boolean; walls: Record<string, boolean> }` | `walls` is keyed by wall-id (one per polygon segment). Default: `ceiling: true`, all others `false`. |

**Derived geometry** (computed each Compute, not stored):

- **Walls** are derived from `vertices`: one wall per consecutive
  vertex pair, with id `wall-${i}` (i = segment index 0…N-1) and a
  user-friendly label (e.g. "North wall" if its outward normal is
  closest to (0, +1), "Northeast wall" otherwise).
- **Ceiling** is the floor polygon translated to z = ceilingHeight.
- **Floor** is the floor polygon at z = 0.

## Entity: RoomFeature

A 2D footprint on a single Surface representing a real-world object.

| Field | Type | Notes |
|-|-|-|
| `id` | `string` | UUID-ish, generated on creation. |
| `type` | `'lightFixture' \| 'recessedLight' \| 'window' \| 'door' \| 'closet' \| 'other'` | |
| `label` | `string` | User-set; defaults to the type's display name. Free text. |
| `surfaceId` | `string` | Refers to `'ceiling'`, `'floor'`, or a wall id like `'wall-2'`. |
| `outline` | `Array<{ uMm: number; vMm: number }>` | Polygon in surface-local 2D coords (u, v), with `u` along the surface's tangent direction (for walls: along the wall, left to right looking from outside) and `v` along its perpendicular (for walls: floor to ceiling; for ceiling/floor: north). |
| `paint` | `boolean` | TRUE = painted (stars project onto it normally). FALSE = no-paint (excluded from spray; rendered as dotted cut line). Defaults per type per FR-005. |

**Validation**:

- `outline` must be a simple polygon entirely within the surface's
  bounds.
- `surfaceId` must reference an existing surface (and that surface
  must support the feature's type — e.g. windows must go on walls).

## Entity: OutputOptions

| Field | Type | Notes |
|-|-|-|
| `paper` | `PaperSize` | See below. |
| `displayUnits` | `'imperial' \| 'metric'` | UI display + input units. Storage stays metric. |
| `blockHorizonOnWalls` | `boolean` | Default `true`. FR-008a. |
| `includeConstellationLines` | `boolean` | Default `false`. R8. |

## Type: PaperSize

```ts
type PaperSize =
  | { kind: 'preset'; preset: 'letter' | 'legal' | 'tabloid' | 'a3' | 'a4' | 'a5' }
  | { kind: 'custom'; widthMm: number; heightMm: number };
```

**Validation** for `custom`:
- `widthMm` ∈ [100, 600]; `heightMm` ∈ [150, 900].
- Either dimension may be the longer one (portrait or landscape inferred
  by `widthMm < heightMm`).

## Entity: Surface (derived; not persisted)

| Field | Type | Notes |
|-|-|-|
| `id` | `string` | `'ceiling'` \| `'floor'` \| `'wall-N'`. |
| `kind` | `'ceiling' \| 'floor' \| 'wall'` | |
| `label` | `string` | E.g. "Ceiling", "North wall". |
| `widthMm` / `heightMm` | `number` | 2D bounds in surface-local coords. For walls: `widthMm` = floor-segment length, `heightMm` = ceiling height. |
| `originPose` | `{ originMm: Vec3; uAxisMm: Vec3; vAxisMm: Vec3 }` | 3D pose: where the (0, 0) of surface-local coords lives in room-local 3D, plus the two unit basis vectors. |
| `enabled` | `boolean` | From `Room.surfaceEnable`. |
| `projectionMode` | `'aboveHorizon' \| 'antipodal' \| 'continuous'` | `aboveHorizon` for ceiling and (when `blockHorizonOnWalls === true`) walls. `antipodal` for floor. `continuous` for walls when `blockHorizonOnWalls === false`. |

## Entity: Tile (derived; not persisted)

A single page in the output PDF. One Tile per (Surface, row, col)
combination. Always emitted to the PDF, even when `holes.length === 0`
and `featureCutouts.length === 0` (FR-014).

| Field | Type | Notes |
|-|-|-|
| `surfaceId` | `string` | |
| `row` | `number` | 1-indexed. |
| `col` | `number` | 1-indexed. |
| `pageNumber` | `number` | 1-indexed; cover page is 1, tiles start at 2. |
| `tileBoundsMm` | `{ uMinMm: number; vMinMm: number; uMaxMm: number; vMaxMm: number }` | Sub-rectangle on the Surface this tile covers. |
| `holes` | `Array<Hole>` | Holes whose centres fall in `tileBoundsMm`, plus any whose centre is within ½″ of the tile boundary (such "shared" holes are also emitted on the adjacent tile per FR-012). |
| `featureCutouts` | `Array<{ featureId: string; clippedOutline: Array<{ uMm: number; vMm: number }> }>` | No-paint feature outlines clipped to this tile's bounds. |
| `constellationSegments` | `Array<{ aMm: { uMm: number; vMm: number }; bMm: { uMm: number; vMm: number } }>` | Optional, only when `includeConstellationLines === true`. |

## Entity: Hole

A single point on a Tile to be cut out by the user.

| Field | Type | Notes |
|-|-|-|
| `surfaceUMm` | `number` | Surface-local u (mm). |
| `surfaceVMm` | `number` | Surface-local v (mm). |
| `sizeClass` | `'pencil' \| 'largeNail' \| 'smallNail' \| 'pin'` | Size encoding per FR-011 / R4. |
| `label` | `string` | E.g. "Polaris", "Sirius", "Mars". For unnamed stars, the HR catalogue number, e.g. "HR-7001". |
| `bodyKind` | `'star' \| 'planet' \| 'sun' \| 'moon'` | |
| `apparentMag` | `number` | For traceability; not directly drawn. |

## Entity: PdfBlob

The compute result. Held in memory; not persisted.

| Field | Type | Notes |
|-|-|-|
| `blob` | `Blob` | application/pdf. |
| `objectUrl` | `string` | `URL.createObjectURL(blob)` for download/preview. Released on next compute. |
| `pageCount` | `number` | Total pages including cover. Matches `tiles.length + 1`. |
| `summary` | `PreflightSummary` | Same data shown to the user before Compute, retained for the post-compute confirmation banner. |

## Entity: PreflightSummary

What the user sees before pressing Compute, and what's checked against
the rendered PDF for SC-008.

| Field | Type |
|-|-|
| `surfaceCount` | `number` |
| `tilePageCount` | `number` |
| `coverPageCount` | `1` |
| `totalPageCount` | `number` (= `tilePageCount + 1`) |
| `totalHoles` | `number` |
| `holeCountsByClass` | `{ pencil: number; largeNail: number; smallNail: number; pin: number }` |
| `paperSheetCount` | `number` (= `totalPageCount`, one tile = one sheet by default) |
| `estimatedPaintAreaSqMm` | `number` (sum of tile bounds, minus no-paint feature areas) |

## Relationships

```
PrintJob ────→ Observation        (1:1; reuses main app's type)
PrintJob ────→ Room               (1:1)
PrintJob ────→ OutputOptions      (1:1)

Room ──→ vertices                 (1:N points)
Room ──→ features                 (1:N RoomFeature, sliced by surfaceId)
Room ──→ surfaceEnable            (1:1 record)

Room → derived Surfaces           (1:N; recomputed each Compute)
Surface → derived Tiles           (1:N; only enabled Surfaces emit Tiles)
Tile ──→ holes                    (0:N Hole)
Tile ──→ featureCutouts           (0:N; from no-paint RoomFeatures)
Tile ──→ constellationSegments    (0:N when toggled on)

PdfBlob ──→ Tiles                 (1:N; in canonical order)
PdfBlob ──→ summary               (1:1 PreflightSummary)
```

## State transitions

`PrintJob` lifecycle:

```
[Print Mode opened] → DRAFT
DRAFT (room not closed) → DRAFT (continued editing)
DRAFT (room valid + observation valid) → COMPUTE_READY
COMPUTE_READY ── press Compute ──→ COMPUTING
COMPUTING ── success ──→ COMPUTED (has PdfBlob)
COMPUTING ── error ──→ COMPUTE_READY (with error toast)
COMPUTED ── any state edit ──→ COMPUTE_READY (PdfBlob discarded)
[Print Mode closed] → state persists in localStorage; reopen restores
```

The `COMPUTE_READY → COMPUTED` transition is the only one that
generates the `PdfBlob`. Edits to any field while in `COMPUTED`
discard the blob and return to `COMPUTE_READY` so the UI never shows
a stale PDF.

## Persistence schema

Stored under `localStorage["skyViewer.printJob"]` as JSON. The
`PdfBlob` is NOT persisted (Blobs aren't JSON-serialisable, and we
prefer to recompute on reopen anyway).

Schema version 1 is the only version. Future schema changes bump
`schemaVersion` and add a migration in `loadPrintJob()`.
