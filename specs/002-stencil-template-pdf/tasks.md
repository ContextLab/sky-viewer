---
description: "Task list for Star-Stencil PDF Generator (feature 002-stencil-template-pdf)"
---

# Tasks: Star-Stencil PDF Generator (Print Mode)

**Input**: Design documents from `/specs/002-stencil-template-pdf/`
**Prerequisites**: plan.md, spec.md (both required), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. The contract document (`contracts/print-api.md`) lists explicit test contracts (e.g. `antipodalize` is its own inverse; `PreflightSummary.totalPageCount === buildPdf.pageCount`), and SC-005, SC-008, SC-012, SC-013, SC-015 explicitly require automated geometric checks. Tests are therefore treated as *requested* for this feature.

**Organization**: Tasks are grouped by user story from spec.md (US1/US2/US3) so each story can be implemented, tested, and shipped independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks).
- **[Story]**: `[US1]`, `[US2]`, `[US3]` — only in user-story phases.
- Every task names an exact file path.

## Path Conventions

Per [plan.md](./plan.md) § "Source Code (incremental — only new files)". All paths repo-root-relative.

- Pure-TS print core: `src/print/`
- Print-mode UI overlay: `src/ui/print-mode/`
- Vitest unit tests: `tests/print/` (with fixtures in `tests/print/fixtures/`)
- Playwright e2e tests: appended to existing `tests/e2e/`
- No changes to `src/astro/`, `src/render/`, or existing `src/app/` modules.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization for the new modules — directory skeleton, dep install, TypeScript config additions. No application logic yet.

- [ ] T001 Create the source-tree skeleton: empty directories `src/print/`, `src/ui/print-mode/`, `tests/print/fixtures/` (add `.gitkeep` in each). Keeps subsequent `[P]` tasks collision-free.
- [ ] T002 Add `jspdf@^2.5` as a runtime dependency and `pdf-parse@^1.1` as a dev dependency in `package.json`. Run `npm install`. Verify `npm ls jspdf` shows the install + `@types/jspdf` is bundled (jspdf ships its own types in v2.5).
- [ ] T003 [P] Verify `tsconfig.json` "include" path picks up `src/print/**/*.ts` and `src/ui/print-mode/**/*.ts` (the existing `"include": ["src/**/*", "tests/**/*", "tools/**/*"]` should already cover this — confirm no edit needed).
- [ ] T004 [P] Add Vitest path alias for the new test directory: ensure `vitest.config.ts`'s `include` glob picks up `tests/print/**/*.test.ts` (the existing `tests/**/*.test.ts` should already cover this — confirm no edit needed).
- [ ] T005 [P] Append the Print Mode test files to `playwright.config.ts` `testMatch` so e2e specs at `tests/e2e/print-mode-*.spec.ts` run by default (the existing `testDir: tests/e2e` should already cover this — confirm no edit needed).

**Checkpoint**: `npm install && npx tsc --noEmit` succeeds. `npx vitest run` runs zero new tests but doesn't error. No print-mode code exists yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The pure-TS data types, state store, projection geometry, tile-grid math, and pre-flight summary. Every user story depends on these.

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete.

### Types and state store

- [X] T006 [P] Implement `src/print/types.ts`: declare `PrintJob`, `Room`, `RoomFeature`, `OutputOptions`, `Surface`, `Tile`, `Hole`, `PdfBlob`, `PreflightSummary`, `Vec3`, `PaperSize`, `SizeClass` per [data-model.md](./data-model.md). Export `DEFAULT_PRINT_JOB` (12×12 ft empty room template, ceiling-only, Letter paper, observation = a copy of `DEFAULT_OBSERVATION` from `src/app/types.ts`). Export const `HOLE_DIAMETERS_MM = { pencil: 6, largeNail: 4, smallNail: 2.5, pin: 1 }` and const `MAGNITUDE_BOUNDS` for the 4-bin classification (FR-011, R4).
- [X] T007 Implement `src/print/print-job-store.ts` per [contracts/print-api.md](./contracts/print-api.md) § `print-job-store`: `getPrintJob`, `setPrintJob` (with the validation rules listed in the contract), `subscribe`, `resetPrintJob`. Persistence under `localStorage["skyViewer.printJob"]`, debounced 500 ms, schema-versioned. Export `createIsolatedStore()` test-only factory analogous to the main feature's `createStore()`.

### Pure projection geometry

- [X] T008 [P] Implement `src/print/projection.ts` § `bodyToWorldVec(altDeg, azDeg)` returning a 3D unit vector in (East, North, Up) coords (R2). Pure; no observer position; just spherical → cartesian.
- [X] T009 [P] Implement `src/print/projection.ts` § `antipodalize(altDeg, azDeg)` returning `{ altDeg: -altDeg, azDeg }` (R12). Pure.
- [X] T010 Implement `src/print/projection.ts` § `deriveSurfaces(room): Surface[]`: builds `ceiling`, `floor`, and one wall per floor-segment. Computes each surface's `originPose` (origin + u-axis + v-axis in 3D room coords) and `widthMm`/`heightMm`. Wall labels assigned by outward-normal direction ("North wall", "Northeast wall", etc.). (Depends on T006 for types.)
- [X] T011 Implement `src/print/projection.ts` § `projectBodyOntoSurface(bodyVec, surface, observerPosMm)`: ray-cast formulas from R2 (ceiling: `t = (ceilingHeight - oz) / dz`; wall: solve plane equation; floor: same as ceiling with negative-z half-space). Returns surface-local `(uMm, vMm)` or `null` based on the surface's `projectionMode`. (Depends on T006, T008.)

### Tile grid + clipping

- [X] T012 [P] Implement `src/print/tile-grid.ts` § `computeTileGrid(surface, paper)`: returns `{ rows, cols, cellWidthMm, cellHeightMm }` where the cell size is the printable area of the chosen paper (paper minus 12 mm margins). Handles preset and custom paper sizes per FR-018.
- [X] T013 [P] Implement `src/print/tile-grid.ts` § `assignHolesToTiles(holes, surface, grid)`: for each hole, compute which `(row, col)` it falls in, AND emit it on adjacent tiles when within 12.7 mm (½″) of any boundary (FR-012). Returns `Map<TileKey, Hole[]>`.
- [X] T014 [P] Implement `src/print/tile-grid.ts` § `clipFeaturesToTiles(features, surface, grid)`: Sutherland-Hodgman clip each no-paint feature outline against each axis-aligned tile rect. Returns `Map<TileKey, FeatureCutout[]>`.

### Pre-flight summary

- [X] T015 Implement `src/print/preflight.ts` § `computePreflightSummary(job)`: pure function returning `PreflightSummary`. Iterates derived surfaces, computes total tile pages = sum over enabled surfaces of `rows × cols` (every grid cell counts, even blank — FR-014, SC-013), counts holes by class. (Depends on T010, T012.)

### Foundational tests (Vitest)

- [X] T016 [P] Write `tests/print/projection.test.ts`:
  - `bodyToWorldVec(altDeg=90, azDeg=0)` returns approximately `(0, 0, 1)` (zenith).
  - `bodyToWorldVec(altDeg=0, azDeg=90)` returns approximately `(1, 0, 0)` (due-east horizon).
  - `antipodalize(antipodalize(x)) === x` (involutive).
  - `projectBodyOntoSurface` for the zenith body + ceiling + observer-at-centre returns `(0, 0)` (the ceiling centre by definition).
  - `projectBodyOntoSurface` for a horizon-due-east body + ceiling returns `null` (parallel ray; no intersection).
  - `projectBodyOntoSurface` for a horizon-due-east body + east-wall-2.4-m-from-observer returns the wall mid-height centre.
  - `projectBodyOntoSurface` with `surface.projectionMode === 'antipodal'` and a body with positive z returns `null` (cull).
  - `projectBodyOntoSurface` with `surface.projectionMode === 'continuous'` accepts both signs of z (no cull).
- [X] T017 [P] Write `tests/print/tile-grid.test.ts`:
  - `computeTileGrid` for a 3 × 3 m ceiling on Letter (8.5×11 in printable ≈ 6.4×8.9 in ≈ 162×226 mm) returns `rows = ceil(3000/226) = 14`, `cols = ceil(3000/162) = 19`.
  - `computeTileGrid` with custom paper 300 × 400 mm has `cellWidthMm = 276`, `cellHeightMm = 376` (after 12 mm margins on each side).
  - `assignHolesToTiles` for a hole at the centre of the surface lands in a single tile.
  - `assignHolesToTiles` for a hole within 10 mm of a tile boundary lands in BOTH adjacent tiles.
  - `clipFeaturesToTiles` for a no-paint feature spanning 2 columns × 1 row produces 2 cutouts, each clipped to its tile rect.
- [X] T018 [P] Write `tests/print/preflight.test.ts`:
  - For the canonical 12×12 ft × 8 ft ceiling-only Letter case, `computePreflightSummary(job).tilePageCount` equals exactly `rows × cols` (no skipping).
  - Toggling on the floor doubles the surface count and grows `tilePageCount` by approximately `2 × ceiling pages` (floor size is the same as ceiling).
  - `holeCountsByClass.pencil + largeNail + smallNail + pin === totalHoles`.
- [X] T019 [P] Write `tests/print/print-job-store.test.ts`:
  - `setPrintJob({ room: { ceilingHeightMm: 7000 } })` clamps to 6000.
  - `setPrintJob({ outputOptions: { paper: { kind: 'custom', widthMm: 50, heightMm: 100 } } })` falls back to Letter (out of bounds).
  - `subscribe` listener fires synchronously on every change.
  - `resetPrintJob()` discards persisted state.
  - `setPrintJob({ room: { observerPositionMm: { xMm: 100, yMm: 200, eyeHeightMm: 1700 } } })` round-trips: subsequent `getPrintJob().room.observerPositionMm` returns exactly the same values (verifies FR-006 store contract).
- [X] T020 [P] Create `tests/print/fixtures/canonical-ceiling.json`: a `PrintJob` for "12×12 ft, 8 ft ceiling, ceiling-only, default observation, Letter paper". Used by US1 + US2 + US3 e2e tests as a known input.
- [X] T021 [P] Create `tests/print/fixtures/all-surfaces.json`: same room as canonical, but with all walls + floor enabled and `blockHorizonOnWalls: false`. Used by US2 e2e tests.

**Checkpoint**: `npx vitest run` passes the foundational tests above (≥ 25 assertions across 4 test files). The pure print-core compiles + tests cleanly with no UI yet. User-story work can begin in parallel from this point.

---

## Phase 3: User Story 1 — Generate a stencil for a child's bedroom ceiling (Priority: P1) 🎯 MVP

**Goal**: Open Print Mode, sketch a rectangular room with one ceiling light fixture (no-paint), set observation, click Compute, download a PDF whose cover page has 4 calibrated hole-size markers + step-by-step instructions, followed by numbered ceiling-tile pages with star holes annotated by size class.

**Independent Test**: Per [spec.md](./spec.md) § US1 Independent Test — fresh user enters Print Mode, keys in date/time/location, draws a rectangle + light fixture, presses Compute, gets a PDF in ≤ 30 s; cover page validates physically with real tools; spot-checked star positions match Stellarium to within ½″ at room scale (SC-003).

### Tests for US1 ⚠️

> Write these tests FIRST and ensure they fail before implementation tasks T028–T037.

- [X] T022 [P] [US1] Write `tests/print/cover-page.test.ts`: verify the 4 hole-size circles in the legend are drawn at exactly the diameters from `HOLE_DIAMETERS_MM` (parse with `pdf-parse`).
- [X] T023 [P] [US1] Write `tests/print/tile-page-content.test.ts`: for the canonical fixture, build the PDF in-memory and assert that page 2 (first tile) contains a page label string matching `/^Ceiling — row \d+, col \d+$/`, contains expected paint-side text, and contains at least one filled-circle command.
- [X] T024 [P] [US1] Write `tests/print/pdf-builder-canonical.test.ts`: build PDF for the canonical fixture, assert (a) blob's first 5 bytes are `%PDF-`, (b) `pageCount === 1 + tilePageCount` (cover + tiles, FR-014), (c) `pageCount === preflight.totalPageCount` (SC-008 exact equality).
- [X] T025 [P] [US1] Write `tests/print/feature-cutout.test.ts`: place a no-paint light fixture rectangle at the centre of the ceiling. Build PDF. Parse. Assert no `Hole` whose surface coords fall inside the fixture's footprint appears in any tile (SC-005).
- [X] T025a [P] [US1] Write `tests/print/split-hole-reconstruction.test.ts`: directly verifies SC-006 (the 1/16″ ≈ 1.5 mm split-hole tolerance). Construct a synthetic surface and place a hole at exactly `u = tile-boundary − 5 mm` (within the 12.7 mm split window). Run `assignHolesToTiles`; obtain both adjacent tiles. For each tile, compute the hole's surface coordinate by adding the tile's `tileBoundsMm` origin to the hole's tile-local position. Assert the two reconstructed surface coordinates agree to ≤ 1.5 mm (SC-006). Repeat for holes near a corner shared by 4 tiles (the hole must reconstruct to within 1.5 mm from any of the 4 reconstructions).
- [X] T026 [P] [US1] Write `tests/e2e/print-mode-open.spec.ts` (Playwright): visit `/`, click the **Print Mode** button, assert the overlay opens within 200 ms; press Esc, assert it closes; reopen, assert state preserved.
- [X] T027 [P] [US1] Write `tests/e2e/print-mode-canonical.spec.ts` (Playwright): full flow V2–V6 from quickstart.md — open Print Mode, use the rectangle template, place a ceiling light fixture, press Compute, click Download, assert a Blob URL is generated for an `application/pdf` resource. Time the Compute step; assert ≤ 30 s **on the GitHub Actions `ubuntu-latest` runner (4 vCPU / 16 GB RAM)** — that runner is the canonical "mid-tier laptop" reference for FR-017 / SC-002. When run locally with a slower machine, the test logs but does not fail; CI is the gate.

### Implementation for US1

- [X] T028 [P] [US1] Implement `src/print/cover-page.ts` § `emitCoverPage(doc, job, summary)`. The cover page MUST include all of the following fields, each as visible text + as invisible-text annotation for screen readers (FR-021):
  1. **Project title** (e.g. "Sky-Viewer Stencil — Print Job").
  2. **Formatted observation**: location label (or lat/lon if no label) + `localDate` + `localTime` + `timeZone` + `(UTC±HH:MM)` + facing direction (cardinal + degrees).
  3. **Surfaces selected**: human-readable list of enabled surfaces, e.g. "Ceiling, North wall, Floor".
  4. **Observer position**: room-local x/y in user units + eye height in user units.
  5. **Total tile pages**, **total holes**, and **holes by class** (`pencil / largeNail / smallNail / pin`).
  6. **Paper size** chosen + **units**.
  7. **"Block horizon on walls"** + **"Include constellation lines"** flags.
  Below the summary: the four labelled hole-size circles drawn with `doc.circle(x, y, d/2, 'F')` using `HOLE_DIAMETERS_MM` (each circle's outer ring is a separate `doc.circle(..., 'S')` for B&W legibility per R9). Below the legend: numbered illustrated step-by-step instructions block (cut → align grid edges → tape → spray → peel). PDF metadata + invisible-text annotations carry the accessible-text version of every field above (FR-021).
- [X] T029 [P] [US1] Implement `src/print/tile-page.ts` § `emitTilePage(doc, tile, surface, job)`: header (page number + surface label + grid position + paint-side indicator), corner alignment marks (4 small L-marks 5 mm from corners), filled circles for holes per `Hole.sizeClass`, optional small text labels under bright-mag holes, dotted polylines for `featureCutouts` with the feature-type label.
- [X] T030 [US1] Implement `src/print/pdf-builder.ts` § `buildPdf(job)`: orchestrates the pipeline per [contracts/print-api.md](./contracts/print-api.md) § `pdf-builder`. Steps 1–7: derive surfaces → grid each → project bodies → bin holes into tiles → clip no-paint features → emit cover page → emit every tile (canonical order: cover, ceiling rows then cols, walls in floor-plan order, floor last; blank tiles included). Returns `Promise<PdfBlob>`. (Depends on T010–T015, T028, T029.)
- [X] T031 [P] [US1] Implement `src/ui/print-mode/print-mode.ts` § `mountPrintMode(triggerHost)`: appends a "Print Mode" button to the host; clicking opens a full-screen overlay (similar to the existing map-picker overlay pattern). The overlay contains placeholders for the Observation editor, Room editor, Output options, and Compute button — to be wired by subsequent US1 tasks. Esc closes. Focus trap while open.
- [X] T032 [P] [US1] Implement `src/ui/print-mode/room-editor.ts` § `mountRoomEditor(host)` (US1 subset only — rectangle template + ceiling features only): SVG floor-plan editor with a "Use template → Rectangle 12×12 ft" button, draggable vertices (mouse + touch), double-click-segment-to-insert-vertex, right-click-vertex-to-delete; **draggable observer-position handle defaulting to centroid (mouse + touch); numeric input for observer eye-height (default 1520 mm / 5 ft, range 1000–2200 mm)**; ceiling-height numeric input (range 1500–6000 mm). Emits store updates via `setPrintJob`. Resolves FR-006 fully.
- [X] T033 [P] [US1] Implement `src/ui/print-mode/feature-panel.ts` § `mountFeaturePanel(host)`: lets the user place a "Light fixture" rectangle on the ceiling via click-and-drag in the SVG ceiling preview; opens a side-panel listing existing features with paint/no-paint toggle (defaults per FR-005), label edit, and delete affordance. (US1 only needs the ceiling-feature flow; wall features defer to US2.)
- [X] T034 [P] [US1] Implement `src/ui/print-mode/output-options.ts` § `mountOutputOptions(host)` (US1 subset — paper size + units + ceiling-only enabled): paper-size selector with all FR-018 presets + a custom W×H input; units toggle (imperial/metric); a single ceiling enable checkbox (defaults ON; walls + floor visible but disabled with a "Multi-surface — see US2" hint for now).
- [X] T035 [P] [US1] Implement `src/ui/print-mode/compute-progress.ts` § `mountComputeButton(host, controller)`: Compute button → `computePreflightSummary` → modal showing total pages, holes, sheets, paint area + Cancel/Continue. On Continue, calls `buildPdf` with progress reporting (page emission counter), shows a "Computing… N/M pages" indicator. On done, swaps to a Download button (`URL.createObjectURL(pdfBlob.blob)`).
- [X] T036 [US1] Wire all US1 widgets together in `src/ui/print-mode/print-mode.ts`: mount room editor + feature panel + output options + compute button inside the overlay. Subscribe to `print-job-store` once at the top so all widgets re-render on changes.
- [X] T036a [US1] Mount the **Observation editor** inside `src/ui/print-mode/print-mode.ts` so the user can change the print job's date / time / location / direction without leaving Print Mode (FR-002). Reuse the parent feature's `mountDateTimeInput` (from `src/ui/date-time-input.ts`), `mountMapPicker` (`src/ui/map-picker.ts`), and `mountCompass` (`src/ui/compass.ts`), but bind their reads/writes to `print-job-store`'s `observation` field rather than the main `observation-store`. Pattern: pass an adapter that exposes `getObservation()` / `setObservation()` / `subscribe()` matching the existing widget contracts but reading/writing the print job's observation. Confirm via the existing widget e2e tests that the adapter does not affect the main view's observation state.
- [X] T037 [US1] Add the **Print Mode** trigger to `src/app/main.ts` top bar. Single `mountPrintMode(topBar)` call alongside the existing widget mounts. Verify no regression to the main view's render performance (SC-011).

**Checkpoint**: User can open Print Mode, sketch the canonical room, place a light fixture, press Compute, and download a valid PDF with cover + tile pages. T022–T027 all pass. **MVP shippable here**.

---

## Phase 4: User Story 2 — Cover the whole room (ceiling + walls + floor) (Priority: P2)

**Goal**: From US1 baseline, the user can enable any combination of surfaces (ceiling, individual walls, floor) and add wall features (windows, doors, closets) with paint/no-paint flags. PDF includes pages for every enabled surface; floor pages render the antipodal sky; "Block horizon on walls" toggle either clips walls at horizon or renders them continuously floor-to-ceiling.

**Independent Test**: Per spec.md § US2 Independent Test — from US1, the user enables walls and floor, places two windows and a closet door (no-paint), generates the PDF; floor pages contain antipodal stars (Magellanic Clouds region for a US-northern observer); a constellation crossing the wall-ceiling seam reconstructs to within ¼″ at the seam (SC-007); window outlines appear as dotted cut lines on north-wall pages with no holes inside them.

### Tests for US2 ⚠️

- [ ] T038 [P] [US2] Write `tests/print/antipodal-projection.test.ts`: for the canonical observation, run `projectBodyOntoSurface` for the floor surface with a known southern-hemisphere star (e.g. α-Carinae); compare against a hand-computed antipodal alt/az (alt → −alt). Assert agreement to 0.01° (SC-012).
- [ ] T039 [P] [US2] Write `tests/print/wall-projection.test.ts`: for a wall facing north, project a body at (alt=10°, az=0°) (slightly above horizon, due north). Assert it lands on the wall at the expected u/v computed from observer-position geometry. Repeat for a body at (alt=−10°, az=0°) with `surface.projectionMode === 'continuous'` and assert it lands BELOW the horizon line.
- [ ] T040 [P] [US2] Write `tests/print/seam-continuity.test.ts`: for a wall and the ceiling, project a body at (alt=85°, az=0°) (close to the wall-ceiling seam). Verify the projected u-coordinate on the wall (at v = ceilingHeight) and the projected v-coordinate on the ceiling (at u = wall midpoint × something) reconstruct the same 3D point to within 6 mm (SC-007).
- [ ] T041 [P] [US2] Write `tests/print/horizon-block-toggle.test.ts`: build PDFs for the same room with `blockHorizonOnWalls: true` and `false`; assert wall pages in the false case contain holes below the horizon line and the true case does not.
- [ ] T042 [P] [US2] Write `tests/e2e/print-mode-floor.spec.ts` (Playwright): use the all-surfaces fixture, run V8 from quickstart.md — enable floor, Compute, download PDF, assert the PDF page count grew (against US1 baseline) and that the post-cover page set includes labels matching `/^Floor — row \d+, col \d+$/`.

### Implementation for US2

- [ ] T043 [P] [US2] Implement `src/ui/print-mode/wall-elevation.ts` § `mountWallElevation(host, wallId)`: a panel that opens when a wall segment is selected in the floor plan. Shows the wall as a flat rectangle (height = ceiling, width = segment length) where the user can click-and-drag rectangles to place windows/doors/closets. The room editor (`src/ui/print-mode/room-editor.ts`) imports `mountWallElevation` and calls it on wall-segment selection. Matches plan.md's `Source Code` tree which reserves a dedicated file for the wall elevation panel.
- [ ] T044 [US2] Extend `src/ui/print-mode/feature-panel.ts`: list all features across all surfaces (not just ceiling). Each feature still has paint/no-paint toggle + label + delete; defaults per type apply at creation.
- [ ] T045 [US2] Extend `src/ui/print-mode/output-options.ts`: enable the surface checkboxes (ceiling, each wall, floor) with the per-surface enable map from `room.surfaceEnable`. Add a "Block horizon on walls" toggle defaulting to ON.
- [ ] T046 [P] [US2] Extend `src/print/projection.ts` § `deriveSurfaces`: surface `projectionMode` now uses the FR-008 / FR-008a logic — ceiling = `'aboveHorizon'`, walls = `'aboveHorizon'` if `blockHorizonOnWalls` else `'continuous'`, floor = `'antipodal'`.
- [ ] T047 [US2] Extend `src/print/pdf-builder.ts`: when iterating bodies, run two passes for each enabled surface — once with the body's `(altDeg, azDeg)` (above-horizon path) and once with `antipodalize(altDeg, azDeg)` (antipodal path). The surface's `projectionMode` cull rules in `projectBodyOntoSurface` filter which pass actually contributes per surface kind. Wall surfaces in `'continuous'` mode accept both passes, with bodies projected onto upper or lower wall band based on sign of altitude.
- [ ] T048 [US2] Extend `src/print/pdf-builder.ts`: emit floor pages last in the canonical print order (after walls). Page numbering remains contiguous (FR-014, SC-013) even when floor adds many pages.
- [ ] T049 [P] [US2] Extend `src/print/tile-page.ts`: include constellation-segment dashed lines on tile pages when `outputOptions.includeConstellationLines === true` (R8). Lines that cross surface boundaries are split — the segment on each side of the seam ends at the boundary with matching endpoint coordinates (SC-007 ¼″ tolerance).
- [ ] T050 [US2] Extend `src/ui/print-mode/output-options.ts`: add an "Include constellation lines" checkbox (default OFF per R8).

**Checkpoint**: All surfaces stencilable; antipodal floor + continuous walls work; T038–T042 pass. US1 e2e tests still pass (no regression). Multi-surface flows demoable.

---

## Phase 5: User Story 3 — Iterate on the room layout without losing the observation (Priority: P3)

**Goal**: Edit the room (drag walls, add/remove features, toggle paint) and re-Compute without re-entering observation. State persists across navigation away from Print Mode and back, and across reloads (FR-019).

**Independent Test**: Per spec.md § US3 Independent Test — from a completed US1 or US2 session, the user can drag a wall from 12 to 14 ft and re-Compute; the new PDF page count grows correspondingly and stars re-project; the observation is unchanged.

### Tests for US3 ⚠️

- [ ] T051 [P] [US3] Write `tests/print/persistence-roundtrip.test.ts`: `setPrintJob({ room: ... })`, force a `__flushPersistForTests`, then `__resetSingletonForTests` and `getPrintJob()`. Assert the loaded job equals the saved one (modulo schema version).
- [ ] T052 [P] [US3] Write `tests/print/recompute-determinism.test.ts`: `buildPdf` for the same job twice produces PDFs with the same `pageCount` and the same hole-count-by-class. (Determinism is required for the "edit-then-recompute reflects exactly what changed" UX.)
- [ ] T053 [P] [US3] Write `tests/e2e/print-mode-iterate.spec.ts` (Playwright): full flow V11 from quickstart.md — Compute once, drag a wall edge, Compute again, assert the second PDF has a different page count from the first; navigate to main view and back, assert the room state survives.

### Implementation for US3

- [ ] T054 [P] [US3] Extend `src/ui/print-mode/room-editor.ts`: implement segment-translation drag (whole-segment move while preserving connected vertices), and feature-edit drag (resize handles on a selected feature's bounding rect).
- [ ] T055 [P] [US3] Extend `src/ui/print-mode/print-mode.ts`: when the overlay closes, the in-progress job remains in `localStorage`; reopening restores the same room/feature state visually. Already automatic via `print-job-store.ts`'s persistence — this task verifies the wiring with a manual e2e check + ensures the close button does NOT call `resetPrintJob` accidentally.
- [ ] T056 [US3] Extend `src/ui/print-mode/compute-progress.ts`: when the user re-presses Compute after edits, the previous `pdfBlob.objectUrl` is revoked via `URL.revokeObjectURL` to avoid leaking blob URLs across re-computes.

**Checkpoint**: Room edits + re-Compute work; state survives navigation. T051–T053 pass. US1 + US2 still pass.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final hardening — accessibility, mobile UI, performance verification, regression coverage, README updates. None of these block the shippable artifact for US1; together they hit every outstanding FR / SC.

- [ ] T057 [P] Add accessibility text to `src/print/cover-page.ts` and `src/print/tile-page.ts`: each feature mentioned on a page has a hidden text-annotation listing type, surface, position, dimensions, paint/no-paint flag (FR-021). Verified via `pdf-parse` extraction in a new `tests/print/accessibility.test.ts`.
- [ ] T058 [P] Mobile UX hardening for `src/ui/print-mode/room-editor.ts`: every interactive control's tap target is ≥ 44 × 44 px (SC-010); the SVG canvas accepts pinch-zoom for the floor plan and the wall elevation (SC-010 + FR-020). Add a mobile e2e check at `tests/e2e/print-mode-mobile.spec.ts` per quickstart V12.
- [ ] T059 [P] Greyscale-legibility polish for `src/print/cover-page.ts` and `src/print/tile-page.ts`: ensure no element relies on colour alone (R9, SC-009). Hole markers carry a thin outline ring so they read on any background; dotted feature outlines use 3 mm dash / 1.5 mm gap; page labels ≥ 10 pt. Add a manual-verification line item to `quickstart.md`'s V5.
- [ ] T060 [P] Add a payload-budget regression check: extend `tools/check-payload.mjs` to assert the production bundle remains ≤ 200 KB gzipped after the jspdf addition (R13). Fail the build if exceeded.
- [ ] T061 [P] Add a Lighthouse-CI hint: extend the existing GitHub Actions workflow to fail if the Performance score drops below **90** with Print Mode mounted in the bundle (covers SC-011 — no main-view regression). The 90 threshold matches the parent feature's existing SC-009 (Lighthouse Performance ≥ 90 on a mid-tier mobile profile) and is the constitution's User-Delight bar.
- [ ] T062 [P] Add `tests/e2e/print-mode-out-of-range-date.spec.ts`: with date set to 1850-01-01, verify the existing main-view caveat banner appears AND Print Mode still produces a valid PDF (graceful degradation per the Edge Cases section).
- [ ] T063 Run the full quickstart.md V1–V13 procedure manually against a built deployment. Record observed numbers (Compute time, page counts, blob size) in `specs/002-stencil-template-pdf/verification-results.md`.
- [ ] T064 Update top-level [README.md](../../README.md) feature list to include Print Mode with a one-paragraph description and a link to the spec. Matches the existing constitution's documentation discipline.
- [ ] T065 Update [CLAUDE.md](../../CLAUDE.md) "Active feature" block to mark 002-stencil-template-pdf as **shipped** rather than planning-only once T063 verification passes.

> **Note on SC-004**: "95% of users in informal usability tests can correctly cut and assemble at least one tile page following only the cover-page instructions" is a **post-launch usability outcome**, not a buildable artifact. No implementation task targets it; instead, after T063 deployment, run informal usability tests with ≥ 5 participants and record the success rate alongside the verification numbers in `verification-results.md`. This explicit deferral resolves the analyzer's C4 finding.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies; can start immediately.
- **Foundational (Phase 2)**: depends on Setup; **blocks** all user stories.
- **US1 (Phase 3)**: depends on Foundational. Self-contained MVP.
- **US2 (Phase 4)**: depends on Foundational AND on US1's PDF builder + UI shell (extends them rather than duplicating). Specifically T043–T050 amend files first written in Phase 3.
- **US3 (Phase 5)**: depends on Foundational AND on US1 (extends the editor + compute flow). T054–T056 amend files first written in Phase 3.
- **Polish (Phase 6)**: most tasks can begin in parallel with US1+US2 once Foundational is complete; T063 (full V1–V13 manual run) and T064 (README update) wait for all stories to be functionally complete.

### Within each phase

- In **Foundational**: T006 must precede T007 (store consumes types); T008/T009 are pure helpers parallel to each other; T010 depends on T006; T011 depends on T006 + T008; T012/T013/T014 are all independent of each other once T006 lands. T015 depends on T010 + T012.
- In **US1**: tests T022–T027 are `[P]` and MUST precede implementation T028–T037. Within implementation, T028/T029 are independent (cover page + tile page emitters touching only their own files). T030 depends on T028 + T029 + foundational. UI tasks T031–T035 are `[P]` (different files); T036 depends on T031–T035; T037 depends on T031.
- In **US2**: tests T038–T042 are `[P]` and precede T043–T050. Within implementation, T043/T044/T045 are `[P]` (different UI files); T046 is independent (projection.ts extension); T047 depends on T046; T048 depends on T047; T049/T050 are `[P]`.
- In **US3**: tests T051–T053 are `[P]` and precede T054–T056. T054 + T055 + T056 touch different files and are `[P]`.

## Parallel Opportunities

### Foundational fan-out (largest)

After Setup, the following can run in parallel (no shared files):

```bash
# Pure-TS print core (parallel after T006):
Task: "src/print/projection.ts § bodyToWorldVec + antipodalize"          # T008+T009
Task: "src/print/tile-grid.ts § computeTileGrid"                          # T012
Task: "src/print/tile-grid.ts § assignHolesToTiles"                       # T013
Task: "src/print/tile-grid.ts § clipFeaturesToTiles"                      # T014

# Foundational tests (parallel after the modules they cover):
Task: "tests/print/projection.test.ts"                                    # T016
Task: "tests/print/tile-grid.test.ts"                                     # T017
Task: "tests/print/preflight.test.ts"                                     # T018
Task: "tests/print/print-job-store.test.ts"                               # T019

# Fixture writers (no deps):
Task: "tests/print/fixtures/canonical-ceiling.json"                       # T020
Task: "tests/print/fixtures/all-surfaces.json"                            # T021
```

### US1 implementation fan-out

```bash
# Tests in parallel:
Task: "tests/print/cover-page.test.ts"                                    # T022
Task: "tests/print/tile-page-content.test.ts"                             # T023
Task: "tests/print/pdf-builder-canonical.test.ts"                         # T024
Task: "tests/print/feature-cutout.test.ts"                                # T025

# UI widgets in parallel after the trigger shell (T031) lands:
Task: "src/ui/print-mode/room-editor.ts"                                  # T032
Task: "src/ui/print-mode/feature-panel.ts"                                # T033
Task: "src/ui/print-mode/output-options.ts"                               # T034
Task: "src/ui/print-mode/compute-progress.ts"                             # T035

# PDF emitters in parallel:
Task: "src/print/cover-page.ts"                                           # T028
Task: "src/print/tile-page.ts"                                            # T029
```

### Across user stories after Foundational

Once Phase 2 is complete, three developers can work in parallel:

- Developer A: US1 (T022–T037) — the MVP slice
- Developer B: US2 widget extensions (T043–T045) and projection extensions (T046–T048) — but their wiring depends on US1's overlay shell, so the wiring step lands later
- Developer C: US3 editor extensions (T054–T056) — also waits on US1's editor shell

Integration happens via short, sequential PRs at `src/ui/print-mode/print-mode.ts` (the overlay shell) and `src/print/pdf-builder.ts` (the compute pipeline).

## Implementation Strategy

### MVP first (ship US1 only)

1. Complete Phase 1: Setup (T001–T005).
2. Complete Phase 2: Foundational (T006–T021).
3. Complete Phase 3: US1 (T022–T037).
4. **STOP and validate**: run V1–V7 from quickstart.md.
5. Deploy. Users get a usable ceiling-stencil generator with cover + tile pages + size legend. The most popular real-world workflow ("starry ceiling for a child's bedroom") is fully covered.

### Incremental delivery

1. Setup + Foundational → math + state + types are provably correct, no UI.
2. + US1 → shippable MVP (single ceiling, paper-and-tape stencil).
3. + US2 → multi-surface (walls + floor + antipodal); window paint/no-paint toggling.
4. + US3 → edit-then-recompute; state persistence verified.
5. + Polish → accessibility, mobile, payload budget enforcement, README + verification artifacts.

### Parallel team strategy

With 3 developers after Foundational completes:

- **A**: US1 core PDF builder (T028–T030) + US1 tests (T022–T025).
- **B**: US1 UI widgets (T031–T037) + US1 e2e (T026–T027).
- **C**: Begins US2 projection work (T046) and US2 tests (T038–T042) — these don't touch US1's files until the wiring step.

When US1 is done and merged, B and C swap to US2 wiring (T043–T050) while A starts polish (T057–T062).

---

## Notes

- [P] tasks touch different files; [Story] label traces each task back to its source user story.
- Tests for each story MUST be written before its implementation tasks and MUST fail before implementation begins.
- Astronomical accuracy is verified by the existing `tests/astronomy/*` suite (parent feature); this feature's tests build on top of it without duplicating fixture work.
- SC-008 (preflight = actual page count) and FR-014 (no skipped pages) are checked by `tests/print/pdf-builder-canonical.test.ts` and `tests/print/preflight.test.ts` together.
- Every checkpoint (end of a phase) is a natural PR boundary.
- Do not break previous user stories when adding a new one — the e2e suite for all completed stories runs on every PR.
