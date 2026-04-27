# Phase 0 Research: Star-Stencil PDF Generator

**Feature**: 002-stencil-template-pdf
**Date**: 2026-04-27
**Scope**: Resolve every NEEDS CLARIFICATION implied by the Technical
Context, pick libraries and algorithms, document assumptions and
expected error bounds. The plan's Constitution Check gates are
re-evaluated after this research lands.

## R1. PDF generation library

**Decision**: **`jspdf` ^2.5** as the PDF builder, with hand-written
vector primitives for lines, circles, text, and dotted paths. **No
plugin extensions** (no `svg2pdf`, no `html2canvas`).

**Rationale**:

- jsPDF (just the core, no add-ons) gzips to ≈ 60 KB. That's the
  largest single new runtime dependency in the feature, and it stays
  inside the constitution's 200 KB code budget when paired with our
  current ≈ 90 KB shipped JS (R13 in the parent feature's research).
- We don't need SVG-to-PDF or HTML-to-PDF; every primitive on a tile
  page is one of: filled circle (a hole), text label, line segment
  (alignment marks, dotted feature outline), or text+rectangle (page
  number block). All four are first-class jsPDF API calls.
- jsPDF is MIT-licensed, no telemetry, runs entirely client-side,
  outputs Blob/data-URL — satisfies FR-016 trivially.

**Alternatives considered**:

- **`pdfmake`**: declarative tables are nice but it's ~150 KB gzipped
  and it bundles fonts we don't need. Rejected for budget.
- **`pdf-lib`**: lower-level, ~200 KB gzipped. Overkill for our
  primitive set. Rejected for budget.
- **Hand-roll the PDF format**: technically tractable for our narrow
  primitive set (≈ 800 lines of TS), and saves the dependency. But the
  spec format has subtle gotchas (cross-reference tables, content
  streams, font dictionaries) and one bug ships a broken PDF. Rejected
  for risk; revisit only if jsPDF's 60 KB footprint becomes painful.
- **Browser print → "Save as PDF"**: would skip the library entirely
  but loses control over page layout, page numbering, and registration
  marks. The output would depend on the user's print dialog choices.
  Rejected for product reliability.

## R2. Projection geometry — ceiling, walls, floor

**Decision**: For each celestial body (star, Sun, Moon, planet) compute
its apparent (alt, az) using the existing `src/astro/transforms.ts`
machinery, convert to a 3D unit vector in observer-local horizontal
coordinates (East/North/Up), then ray-cast against each enabled
surface's plane in room space. Surface-local 2D coordinates come from
projecting the intersection point onto the surface's 2D basis.

For each surface kind:

- **Ceiling**: surface plane is `z = ceilingHeight`, normal `(0,0,+1)`.
  Use the body's 3D vector `(x, y, z)`; if `z > 0`, intersection is at
  `t = ceilingHeight / z`; the ceiling-local 2D point is `(t*x, t*y)`
  in floor-relative coords (East, North), translated so the observer
  point becomes the local origin. If `z ≤ 0`, the body is below the
  observer's horizon and never hits the ceiling — skip.
- **Walls**: each wall segment defines a plane (vertical, with normal
  in the room's xy-plane). Same ray-cast: solve for the parameter `t`
  where the body's ray crosses the wall plane, keep only `t > 0` and
  the intersection point inside the wall's rectangular bounds (height
  0…ceilingHeight, width 0…wallLength). 2D wall-local coords use the
  wall's tangent direction as +x and +z as +y.
- **Floor (antipodal)**: same as ceiling but flipped: surface plane
  `z = 0`, normal `(0,0,-1)`. We feed the body's 3D vector after
  negating its z-component (alt → −alt) — equivalently, ray-cast
  downward into the negative-z half-space and check `z < 0`.
- **Walls below horizon (FR-008a OFF)**: when "Block horizon on walls"
  is OFF, after ray-casting the wall plane we additionally accept
  bodies with `z < 0` whose ray crosses the wall below the observer's
  eye height. The wall's lower band uses the antipodal projection
  formula (alt → −alt) glued at the horizon line.

**Accuracy**: the existing `transforms.ts` is calibrated to ≤ 0.01° vs.
`astronomy-engine` (per the parent feature's tests). The ray-cast
itself is a closed-form 4-arithmetic-op calculation per body per
surface — zero accumulated error. **Combined error budget: ≤ 0.05°
angular at the projection step, well under the spec's 0.1° SC target.**

At 8 ft (2.4 m) projection distance from the observer's eye to the
ceiling, 0.05° = ≈ 2.1 mm = ≈ 1/12 inch. The spec's ½″ tile-edge
tolerance has 6× headroom; the 1/16″ alignment tolerance has 1.3×
headroom — comfortable.

**Alternatives considered**:

- **Stereographic projection from zenith**: simpler math but introduces
  shape distortion away from the centre — Polaris stretches noticeably
  on a 12 × 12 ft ceiling. Rejected for visual quality.
- **Equirectangular wraparound around the room**: would let constellations
  flow continuously around all four walls but distorts every star.
  Rejected for accuracy.

## R3. Tile-grid layout

**Decision**: Each enabled surface gets a row × column grid where each
cell is the **printable area** of the chosen paper size — paper minus
12 mm safe margins on every side. Adjacent tiles overlap by 1/8″
(≈ 3.2 mm) so the user can tape with bleed. Holes within ½″ of any
tile edge are rendered on **both** adjacent tiles (the user picks
which to keep, or the alignment marks make the duplicate self-evident).

Rows and columns are numbered from 1, row-major. Page numbers run:
cover (1) → ceiling tiles (2 … N+1, row-major) → each enabled wall
in floor-plan order (named "North wall", "East wall", etc.) → floor
tiles last. Blank tiles are NOT skipped (FR-014).

**Rationale**: the printable-area approach gives the user a stencil
that fully tiles their wall once they trim the page margins (or that
overlaps cleanly with no trimming if they assemble pages onto a
physical surface and let the margins overlap).

**Alternatives considered**:

- **Edge-to-edge tiling (no overlap)**: requires perfect alignment by
  the user; one bad tape and the entire grid drifts. Rejected for
  ergonomics.
- **Larger overlap (½″)**: wastes paper for our highest-page-count
  cases; the 1/8″ overlap matches common manual-printing conventions.

## R4. Hole-size encoding

**Decision**: Four classes, exactly as in the spec's FR-011, with these
diameters (printed at 1:1 — the cover page's legend is the calibration):

| Class | Magnitude range | Diameter |
|-|-|-|
| **Pencil** | mag ≤ 0 | 6.0 mm (15/64 in) |
| **Large nail** | 0 < mag ≤ 1 | 4.0 mm (5/32 in) |
| **Small nail** | 1 < mag ≤ 3 | 2.5 mm (3/32 in) |
| **Pin** | 3 < mag ≤ 6 | 1.0 mm (3/64 in) |

The user can match each class to a real-world tool by inserting the
tool through the corresponding cover-page hole — the cover legend is
both labelling and physical calibration.

**Rationale**: This four-bin scheme matches common naked-eye perception
(brightest stars look obviously larger than mag-2 stars, mag-2 stars
look obviously larger than mag-4 stars). The diameters are tool-pickable:
a #2 pencil tip is ≈ 6 mm, a 16d common nail head is ≈ 4 mm, a 4d
finishing nail is ≈ 2.5 mm, a sewing pin is ≈ 1 mm.

## R5. Room editor — interaction model

**Decision**: 2D floor-plan editor in HTML5 Canvas (or SVG — see
implementation notes). Vertices are draggable point handles; segments
are draggable lines (drags whole segment); double-click on a segment
inserts a vertex; right-click / long-press on a vertex deletes it.
Touch and pointer events both supported. Snap-to-grid at 1 inch (or
2 cm) optional; user-toggleable.

A **wall elevation panel** appears when the user selects a wall
segment: shows the wall as a flat rectangle (height = ceiling height,
width = segment length), lets the user place windows/doors/closets by
clicking-and-dragging rectangles within the elevation. Each placed
feature gets a paint/no-paint toggle (defaulting per type) and a
type label.

**Rendering choice**: SVG. The room is tiny (≤ 100 vertices typical),
the inputs are sparse (clicks/drags, not animation), and SVG gives us
free DOM accessibility. Canvas would be needed only if we anticipate
hundreds of vertices, which we don't. Saves ≈ 5 KB vs. a custom canvas
event/hit-testing layer.

**Alternatives considered**:

- **Three.js 3D room visualization**: spec explicitly out-of-scope for
  MVP. Rejected.
- **A pre-built floorplan library** (e.g. `react-planner`, `floor-plan-editor`):
  too heavy (~200 KB+) and ties us to React, which we don't use.
  Rejected for budget + framework lock-in.

## R6. Print-mode entry & state model

**Decision**: A new top-bar button **"Print Mode"** opens a full-screen
overlay (similar to the existing map picker pattern). State lives in
a new `PrintJob` object inside `localStorage` under the key
`skyViewer.printJob` — separate from the existing `skyViewer.observation`
so the print job's date/time/location can be edited without disturbing
the main view.

`PrintJob` contains: an `Observation` (date/time/location/direction —
defaults to the active main-view observation when Print Mode opens),
a `Room` (vertices, ceiling height, observer position, surface enable
flags, features, "Block horizon on walls" flag), and `OutputOptions`
(paper size, units). The generated PDF is held only in memory (not
persisted) — pressing Compute regenerates it.

**Rationale**: separating state means a user can prepare a Print Job
in the background while continuing to play with the main view, and the
print job survives reloads (FR-019).

## R7. Unit handling

**Decision**: Internal storage in **metric** (millimetres for room
dimensions, decimal degrees for lat/lon already). Display & input
defaults: feet/inches in US locales (detected by
`Intl.DateTimeFormat().resolvedOptions().locale`), metres elsewhere.
The user can flip the units toggle anytime; conversion happens at the
input/display boundary, never in geometry code.

**Rationale**: keeps geometry math in one consistent unit system;
matches the existing constitution's metric-first preference.

## R8. Constellation lines on stencils

**Decision**: Off by default. When the user opts in via a Print Mode
toggle, lines render as faint dashed strokes on tile pages — NOT as
holes (you can't spray-paint a line through a hole). The dashes use a
small enough stroke width that they print as hairlines but stay
visible. Lines that cross surface boundaries are split: the segment
on each side is rendered with matching endpoints at the seam (within
the SC-007 ¼″ tolerance).

**Rationale**: lines on stencils don't survive the spray-paint flow
(they'd just be strokes the user is supposed to draw with a marker
*after* peeling the stencil). Keeping them off by default keeps the
output clean for the most common workflow.

## R9. Greyscale legibility

**Decision**: The cover page and tile pages MUST print correctly on a
black-and-white printer. We achieve this by:

- All hole markers are **filled circles** with a thin ring (so they
  show up against any background tone).
- Dotted feature outlines use a clear dash pattern (3 mm dash, 1.5 mm
  gap), wide enough to read on any printer.
- Page labels and instructions use ≥ 10 pt font, no colour-only encoding.
- Size legend on the cover page uses both circle size AND printed
  diameter label (e.g. "Pencil — 6 mm").

**Rationale**: SC-009 explicitly requires this. Most stencil users are
home printers with B&W default settings.

## R10. Performance budget

**Decision**: Compute (project + tile + render PDF) target is **≤ 30 s**
for the canonical case (12 × 12 ft, 8 ft ceiling, ceiling-only).

Estimated work:

- 8,400 stars × 1 surface = 8,400 ray-casts (≈ 5 ms total).
- ~150 stars above mag 6 with alt > 0° in any given moment → 150 holes.
- Tile grid: ceiling area / printable area per page. 12 × 12 ft =
  144 sq ft. Letter printable ≈ 0.65 sq ft → ≈ 220 tile pages.
- PDF assembly: 220 pages × jsPDF page emission ≈ 2-4 s on mid laptops.

Total: well under 30 s. The dominant cost is the PDF emission, not the
projection.

For US2 (all surfaces): 220 ceiling + 4 × ~110 walls + 220 floor =
≈ 880 pages. Still under 30 s by design (jsPDF batches well).

**Performance gates** for the existing app (Principle II): unchanged.
Print Mode is a separate UI surface that doesn't run during normal
view; entering Print Mode is a one-shot navigation, not a render-loop
addition.

## R11. Memory budget

**Decision**: At 880 pages with ~150 holes per ceiling page (worst
case) the PDF's in-memory representation is ≈ 30 MB. jsPDF builds
this incrementally and releases it when the Blob is created. Within
the constitution's 150 MB mobile cap with comfortable headroom.

If the user picks a tiny paper size (4 × 6 in) and a giant room, the
page count blows up. The pre-flight summary (FR-015) catches this:
when total pages > 1000, we add a strong warning to the summary
("This will produce N pages, which will use ~M printer sheets and
take ~T minutes to render. Continue?").

## R12. Antipodal sky correctness

**Decision**: The antipodal sky used for the floor and (when
configured) wall lower bands is computed by taking each body's
apparent `(altDeg, azDeg)` and reflecting through the observer:
`(altDeg' = -altDeg, azDeg' = azDeg)`. NOT `azDeg' = (azDeg + 180) mod 360`
— that would flip the sky east-west, which is wrong. The antipodal
sky is *the same azimuth, opposite altitude*. (Equivalently: the
position you'd see if Earth were transparent and you were standing on
your head.)

**Verification**: SC-012 requires comparing against any reference
sky tool by inverting alt only. We test in the unit-test suite by
generating reference values via `astronomy-engine` for known fixtures
and asserting that our antipodal projection matches the manually
computed `(−alt, az)` to within 0.01°.

## R13. Payload reconciliation

**Cumulative payload after this feature lands** (gzipped, estimated):

| Component | Size |
|-|-|
| Existing app code | ~90 KB |
| jsPDF (new) | ~60 KB |
| New print-mode TS modules | ~30 KB |
| **Total code** | **~180 KB** ✅ (budget 200 KB) |
| Existing data files | ~285 KB |
| New data: nothing | 0 KB |
| **Total** | **~465 KB** ✅ (well under 500 KB data budget) |

**Conclusion**: feature fits within the constitution's payload budgets
with margin. No Complexity Tracking entry needed.

## R14. Browser test matrix

**Decision**: Same as the parent feature — Chromium/Firefox/WebKit via
Playwright. New e2e tests:

1. **`print-mode-open.spec.ts`**: Print Mode button mounts; clicking
   opens the overlay; closing returns to main view with state intact.
2. **`pdf-generation.spec.ts`**: with a canonical room (12 × 12 ft,
   8 ft ceiling, ceiling-only) and the default observation, pressing
   Compute produces a Blob whose first 5 bytes are `%PDF-`.
3. **`tile-page-count.spec.ts`**: pre-flight summary's page count
   matches the actual PDF page count exactly (SC-008).
4. **`feature-cutout.spec.ts`**: with a no-paint window, no holes
   appear inside the window's footprint in the rendered PDF (SC-005).

PDF content verification uses `pdf-parse` (devDep, ~30 KB) at test
time only — never shipped to the browser.

---

## Summary: All NEEDS CLARIFICATION resolved

- **PDF library**: jsPDF (60 KB).
- **Projection geometry**: ray-cast onto plane, three formulas (ceiling,
  wall, floor), antipodal via alt-flip, bounded ≤ 0.05° error.
- **Tile layout**: 1/8″ overlap, blank tiles preserved, page numbering
  row-major across surfaces.
- **Hole sizing**: 4 classes, calibrated diameters in mm.
- **Editor**: SVG-based, draggable vertices, double-click insert,
  per-wall elevation panel.
- **State**: separate `PrintJob` in localStorage.
- **Units**: internal mm, display feet/m by locale.
- **Constellation lines**: off by default; faint dashes when on.
- **Greyscale**: dual-encoded (size + label).
- **Performance**: well within budget.
- **Antipodal**: alt-flip only.
- **Tests**: Vitest for projection/PDF builders, Playwright for e2e.

No open NEEDS CLARIFICATION remain.
