# Quickstart: Star-Stencil PDF Generator (Print Mode)

**Feature**: 002-stencil-template-pdf
**Audience**: anyone running the project locally to test, verify, or
demo Print Mode.

## Prerequisites

- Node.js ≥ 20 (for the dev build pipeline).
- A modern browser.
- Optional: a real printer + tape + spray paint to physically verify
  the assembled stencil. See *Physical verification* at the end.

## One-time setup

Already covered by the parent feature's quickstart (`specs/001-sky-viewer-mvp/quickstart.md`).
On the first build after Print Mode lands, `npm install` will pull in
`jspdf` (new runtime dep) and `pdf-parse` (new dev dep).

## Run locally

```bash
npm run dev
```

Open <http://localhost:5173>. You should see the existing main view.
A new **Print Mode** button appears in the top bar.

## Verify Print Mode end-to-end

Run the following procedure to confirm the feature works. Stop and
investigate on any failure.

### V1 — Open and close Print Mode (US1, FR-001)

1. From the main view, click **Print Mode**.
2. The Print Mode overlay opens within ~200 ms.
3. The Observation editor shows the current main-view observation.
4. Click **Close** (or press Esc).
5. The overlay closes; main view resumes; reopen Print Mode and
   confirm the in-progress observation/room state is preserved
   (FR-019).

### V2 — Sketch a simple rectangular room (US1, FR-003)

1. In Print Mode, the Room editor shows an empty SVG canvas.
2. Click **Use template → Rectangle 12 × 12 ft**. The polygon appears.
3. Drag one vertex; the polygon updates live.
4. Double-click on a segment; a new vertex appears at the click
   point, draggable.
5. Right-click (or long-press) the new vertex; it's removed.
6. Set ceiling height to 8 ft via the height input.

### V3 — Place a ceiling light fixture as a no-paint feature (US1, FR-005)

1. Click **Add feature → Light fixture**.
2. The ceiling preview shows a draggable rectangle; place it at the
   ceiling centre.
3. The feature panel shows the type, label ("Light fixture 1"), and a
   paint/no-paint toggle defaulting to **no-paint**.

### V4 — Pre-flight + Compute (US1, FR-009, FR-010, FR-015, FR-017)

1. Click **Compute**.
2. The pre-flight summary modal shows: `Total pages: 222`,
   `Total holes: ~150`, `Paper: Letter`, `Estimated paint area: ~144 sq ft`.
3. Confirm. The PDF generates within ≤ 30 s. A **Download PDF**
   button appears.
4. Download. Open the PDF.

### V5 — Inspect the cover page (US1, FR-009, SC-009)

1. Page 1 of the PDF is the cover.
2. It contains four labelled hole markers: **Pencil** (6 mm),
   **Large nail** (4 mm), **Small nail** (2.5 mm), **Pin** (1 mm).
3. Below the markers: numbered, illustrated instructions.
4. Below the instructions: project summary (date/time/location, surfaces,
   total page count, total hole count by size class).
5. Print page 1 in greyscale on a B&W printer; every label and
   marker is legible (SC-009).

### V6 — Inspect a tile page (US1, FR-010)

1. Skip to a non-blank ceiling tile (e.g. page 5).
2. The page shows: page label "Ceiling — row R, col C", corner
   alignment marks, the paint-side indicator, and several star holes.
3. Each hole is drawn as a filled circle at the right diameter for
   its size class.
4. Bright-star holes are labelled (e.g. "Polaris", "Vega").
5. If this tile overlaps the light fixture, the fixture appears as a
   dotted outline with the label "Light fixture" and no holes are
   present inside it.

### V7 — Inspect a blank tile (US1, FR-014, SC-013)

1. Find a tile with no holes (likely a corner tile far from the
   visible-sky region).
2. The page is NOT skipped: it has a page number, page label,
   alignment marks, paint-side indicator, and is otherwise blank.
3. Page numbers are contiguous (no gaps in the numbering).

### V8 — Floor surface (antipodal sky) (US2, FR-007, FR-008, SC-012)

1. In the Room editor, enable the **Floor** surface (toggle on).
2. Re-Compute.
3. The page count grows by one floor-tile-grid worth.
4. Floor pages contain stars too — these are the constellations
   currently *below* the observer's horizon (Southern stars when
   viewing from the northern hemisphere).
5. Spot-check: confirm a known southern-hemisphere object (e.g. the
   Magellanic Clouds region near α-Carinae for a US-northern
   observation) appears on a floor tile.

### V9 — Wall continuous projection (FR-008a, SC-015)

1. Enable a wall surface and the **Floor**.
2. Toggle off **Block horizon on walls**.
3. Re-Compute. Wall pages now have stars from top to bottom: the
   upper portion is above-horizon sky; the lower portion is antipodal
   sky.
4. Inspect the seam at the horizon line on a wall page; alignment is
   smooth, no duplicate or skipped stars.

### V10 — Custom paper size (FR-018, SC-014)

1. In Output Options, choose **Custom**.
2. Enter `300 × 400 mm`.
3. Re-Compute. The page count and tile dimensions reflect the new
   paper size.
4. The first tile's printable area is 300 × 400 mm minus margins.

### V11 — Iterate and re-Compute (US3, FR-019)

1. Drag a wall segment to extend the room from 12 to 14 ft.
2. The pre-flight page count increases proportionally.
3. Re-Compute. The new PDF replaces the old one.
4. Navigate to the main view and back to Print Mode; the room state
   is preserved.

### V12 — Mobile (FR-020, SC-010)

1. Open the dev server on a mobile browser (or Chrome dev-tools mobile
   emulation).
2. Print Mode is reachable from the top bar.
3. The Room editor accepts touch: tap to select, drag to move
   vertices.
4. Every interactive control's tap target is ≥ 44 × 44 px.

### V13 — Offline after first load (FR-016, SC-011)

1. After a successful first run, disable the network.
2. Reload the app.
3. Print Mode still opens, the editor still works, and Compute still
   produces a PDF — the entire flow is client-side.

## Performance verification

```bash
npm test                 # Vitest: includes new tests under tests/print/
npm run test:e2e         # Playwright: includes new tests under tests/e2e/print-*.spec.ts
```

New unit tests:

- `tests/print/projection.test.ts` — ray-cast onto each surface kind,
  antipodal correctness, edge cases (zenith, horizon-due-east, polar).
- `tests/print/tile-grid.test.ts` — grid dimensions across paper sizes,
  hole-binning at edges, feature clipping.
- `tests/print/preflight.test.ts` — page count exactly matches built PDF.
- `tests/print/pdf-builder.test.ts` — built PDF parses with `pdf-parse`,
  has expected page count, contains expected text labels.

New e2e tests:

- `tests/e2e/print-mode-open.spec.ts` — V1.
- `tests/e2e/print-mode-canonical.spec.ts` — V2…V6 in one flow.
- `tests/e2e/print-mode-floor.spec.ts` — V8.
- `tests/e2e/print-mode-mobile.spec.ts` — V12.

## Physical verification (optional)

A complete sanity check requires actually building a stencil:

1. Run V4 with a small test room (e.g. 4 × 4 ft, 2 ft ceiling — toy
   scale) so the print job is a few pages, not 220.
2. Print the cover page + 4 tile pages.
3. Push a pencil through the cover-page **Pencil** legend hole — it
   should fit snugly. Repeat with a large nail, a small nail, a pin.
4. Cut the holes on the tile pages with the appropriate tools.
5. Tape the tiles to a flat surface (cardboard works).
6. Spray paint through the holes onto the cardboard.
7. Peel the stencil. Compare the resulting star pattern to a
   reference Stellarium screenshot for the same observation.
   Star positions match to within ½″ (SC-003).

## Reference fixtures

The Print Mode test suite uses three canonical fixtures:

- **Default ceiling** — 12 × 12 ft rectangle, 8 ft ceiling, observer at
  centre, default Moore Hall observation. Expected: ~220 pages,
  ~150 holes.
- **All surfaces** — same room, all surfaces enabled, "Block horizon on
  walls" off. Expected: ~880 pages, ~600 holes.
- **Custom paper L-shape** — L-shaped room, A3 paper, ceiling only.
  Expected: ~60 pages, ~150 holes (different page count from the
  rectangle because of L-shape area difference).

Test fixtures live in `tests/print/fixtures/*.json`.
