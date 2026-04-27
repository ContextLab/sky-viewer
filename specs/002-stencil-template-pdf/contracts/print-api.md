# Contract: Print Mode internal module API

**Feature**: 002-stencil-template-pdf
**Scope**: TypeScript module boundaries within `src/print/` and the
adjacent `src/ui/print-mode/` UI tree. The app has no public HTTP API
(FR-016 forbids it). These are the *internal* contracts that let the
print-mode subsystem be tested in isolation and that the UI consumes.

## Module: `src/print/print-job-store.ts`

State store for the in-progress Print Job. Persisted to localStorage,
debounced like the main observation store.

### `getPrintJob(): PrintJob`

Returns the current job. Synchronous; never throws. If localStorage
has no job, returns `DEFAULT_PRINT_JOB` (a 12 × 12 ft empty room
template with the current main-view observation).

### `setPrintJob(next: Partial<PrintJob>): PrintJob`

Deep-merges `next` over the current job, applies validation/coercion
(see *Validation* below), persists (debounced 500 ms), emits
`printJobChanged`, returns the merged value.

### `subscribe(listener: (job: PrintJob) => void): Unsubscribe`

Synchronous listener registration. Used by the editor UI to redraw on
every change.

### `resetPrintJob(): PrintJob`

Discards persisted state, returns a fresh default job.

### Validation rules applied in `setPrintJob`:

- `room.vertices` truncated to ≥ 3 vertices; if user attempts to
  remove a vertex that would leave fewer, the call is a no-op.
- `room.ceilingHeightMm` clamped to [1500, 6000].
- Each feature's `outline` is rejected if not a simple polygon, or if
  it falls outside its surface's bounds. Bad features are dropped
  silently (the UI prevents this state in practice).
- `outputOptions.paper` if `kind === 'custom'`: `widthMm ∈ [100, 600]`,
  `heightMm ∈ [150, 900]`. Out-of-range falls back to Letter.

## Module: `src/print/projection.ts`

Pure functions; no DOM, no side effects. Testable with Vitest.

### `deriveSurfaces(room: Room): Surface[]`

Builds the `Surface[]` array from the user's room. Always returns:
1 ceiling, 1 floor, N walls (one per floor-segment). Caller filters
by `surface.enabled` if needed.

### `projectBodyOntoSurface(body: Body3D, surface: Surface, observerPosMm: Vec3): { uMm: number; vMm: number } | null`

Ray-casts `body` (a 3D unit vector) from `observerPosMm` against
`surface`'s plane, returns the surface-local 2D coordinate of the
intersection. Returns `null` when:

- The ray doesn't hit the surface (parameter `t ≤ 0`, or hits but
  outside the surface bounds).
- The surface's `projectionMode === 'aboveHorizon'` and `body.z ≤ 0`.
- The surface's `projectionMode === 'antipodal'` and `body.z ≥ 0`.

For `projectionMode === 'continuous'` (walls with horizon-blocking
off), no z-sign cull is applied — both above- and below-horizon bodies
project.

### `bodyToWorldVec(altDeg: number, azDeg: number): Vec3`

Converts horizontal coords to a 3D unit vector in room-aligned
horizontal coords (E, N, U). North is +y, East is +x, Up is +z.

### `antipodalize(altDeg: number, azDeg: number): { altDeg: number; azDeg: number }`

Returns `{ altDeg: -altDeg, azDeg }` (R12 — alt-flip only). Pure.

## Module: `src/print/tile-grid.ts`

### `computeTileGrid(surface: Surface, paper: PaperSize): { rows: number; cols: number; cellWidthMm: number; cellHeightMm: number }`

Given a surface size and the chosen paper, returns the tile-grid
dimensions. `cellWidthMm` and `cellHeightMm` are the printable area of
the chosen paper (paper minus 12 mm margins).

### `assignHolesToTiles(holes: Hole[], surface: Surface, grid: TileGrid): Map<TileKey, Hole[]>`

For each hole, determines which tile(s) it belongs to. A hole within
½″ (12.7 mm) of any tile boundary is assigned to BOTH adjacent tiles
so the user can reconstruct it (FR-012).

### `clipFeaturesToTiles(features: RoomFeature[], surface: Surface, grid: TileGrid): Map<TileKey, FeatureCutout[]>`

For each no-paint feature on this surface, computes its clipped
outline against each tile that it intersects. Sutherland-Hodgman
polygon clipping is sufficient since tiles are axis-aligned rects.

## Module: `src/print/preflight.ts`

### `computePreflightSummary(job: PrintJob): PreflightSummary`

Pure; no side effects. Returns the summary shown to the user before
Compute. Must be exact (SC-008): the page count this returns is the
page count the actual PDF will have.

## Module: `src/print/pdf-builder.ts`

### `buildPdf(job: PrintJob): Promise<PdfBlob>`

The main Compute entry point. Pipeline:

1. Compute `Surface[]` (from `projection.ts`).
2. For each enabled surface: compute its tile grid.
3. For each body in the visible sky (and antipodal sky for floor /
   continuous walls): project + bin into tiles via `tile-grid.ts`.
4. For each surface: clip no-paint features into per-tile cutouts.
5. (If enabled) for each constellation: project both endpoints, split
   the line at any tile boundaries, attach segments to tiles.
6. Emit cover page via `cover-page.ts`.
7. For each tile (canonical order): emit a tile page via `tile-page.ts`.
8. Wrap in a `Blob`, build a `PdfBlob` record, return.

Target: ≤ 30 s for the canonical 12 × 12 ft / ceiling-only case
(R10). Steps 1-5 are CPU-bound (≤ 1 s). Step 6-7 is the dominant cost.

### `buildPdf` MUST NOT mutate the input `PrintJob`.

## Module: `src/print/cover-page.ts`

### `emitCoverPage(doc: jsPDF, job: PrintJob, summary: PreflightSummary): void`

Renders the first page:
- Title block + project summary (date/time/location/surfaces).
- Four labelled hole-size markers, drawn as filled circles at exact
  diameters (R4): 6 mm, 4 mm, 2.5 mm, 1 mm.
- Numbered, illustrated step-by-step instructions.
- Accessibility text (FR-021) embedded as PDF metadata + invisible
  text annotations.

## Module: `src/print/tile-page.ts`

### `emitTilePage(doc: jsPDF, tile: Tile, surface: Surface, job: PrintJob): void`

Renders one tile page:
- Header: page number + surface label + grid position + paint-side
  indicator.
- Corner alignment marks.
- Holes, drawn as filled circles per `Hole.sizeClass` diameter.
- Hole labels (small text below each hole; toggleable in advanced
  options if labels would clutter).
- Feature cutouts, drawn as **dotted polylines** with feature-type
  labels.
- (If enabled) constellation line segments as faint dashed strokes.

## Module: `src/ui/print-mode/print-mode.ts`

### `mountPrintMode(triggerHost: HTMLElement): void`

Mounts the "Print Mode" trigger button in `triggerHost`. Clicking it
opens the full-screen Print Mode overlay which contains:

- The Observation editor (reusing `mountDateTimeInput`,
  `mountMapPicker`, `mountCompass` from the main feature).
- The Room editor (`src/ui/print-mode/room-editor.ts`).
- The Output options panel (`src/ui/print-mode/output-options.ts`).
- The Compute button + pre-flight summary modal.
- The Download button (post-Compute).
- Close button (returns to main view; state persists).

## Module: `src/ui/print-mode/room-editor.ts`

### `mountRoomEditor(host: HTMLElement): void`

Mounts the SVG-based room editor:
- Floor-plan canvas: drag vertices, double-click to insert, right-click
  to delete; drag segments to translate; drag observer-position handle.
- Per-wall elevation panel: opens when a wall segment is selected,
  lets user place windows/doors via click-and-drag rectangles.
- Surface enable checkboxes (one per wall + ceiling + floor).
- Feature paint/no-paint toggles per feature.

## Test contracts

The following must hold:

- `projectBodyOntoSurface(zenith body, ceiling, observer-at-centre)`
  returns `{ uMm: 0, vMm: 0 }` (the ceiling centre, by definition).
- `projectBodyOntoSurface(horizon body due-east, ceiling, observer-at-centre)`
  returns `null` (parallel to ceiling — no intersection).
- `projectBodyOntoSurface(horizon body due-east, east-wall, observer-at-centre)`
  returns the wall's mid-height centre point.
- `antipodalize` is its own inverse: `antipodalize(antipodalize(x)) === x`.
- `computePreflightSummary(job).totalPageCount === buildPdf(job).pageCount`
  (exact, SC-008).
- `buildPdf(job).blob` first 5 bytes are `%PDF-` (it's a valid PDF
  starter signature).
- For a 12 × 12 ft ceiling-only canonical case with the default
  observation, `buildPdf` resolves in ≤ 30 s on a mid-tier laptop.
- For a no-paint window feature, no `Hole` in any tile's `holes` has
  its centre inside the window's footprint (SC-005).
