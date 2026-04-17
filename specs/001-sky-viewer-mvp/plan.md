# Implementation Plan: Sky-Viewer MVP

**Branch**: `001-sky-viewer-mvp` | **Date**: 2026-04-17 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-sky-viewer-mvp/spec.md`

## Summary

Build a single-HTML-page client-side astronomy visualizer that, given
a date, location (map-picked), facing direction, and time of day,
animates the night sky to ≤ 0.1° accuracy on every popular
browser, desktop and mobile. No backend, no API keys, no runtime
external dependencies. Delivered as a GitHub Pages site.

Technical approach (detail in `research.md`): TypeScript + esbuild
producing a single inlined HTML shell; WebGL2 star-field renderer
with Canvas2D fallback for progressive enhancement; Yale Bright
Star Catalogue subset + VSOP87/ELP ephemeris for astronomical
sources; embedded Natural-Earth world map + GeoNames city subset +
coarse tz boundaries for the offline map picker; service worker for
offline-after-first-load. Input state in `localStorage`. Vitest for
astronomy unit tests; Playwright for cross-browser smoke.

## Technical Context

**Language/Version**: TypeScript 5.x, targeting ES2020 (matches
Tier 1 browser support declared in the constitution).
**Primary Dependencies**: None at runtime except the browser. Dev:
`typescript`, `esbuild`, `vitest`, `@playwright/test`.
**Storage**: `localStorage` for the `Observation` tuple; service
worker cache for static data files. No database.
**Testing**: Vitest for astronomy math + state store;
`@playwright/test` for cross-browser smoke (Chromium, Firefox,
WebKit).
**Target Platform**: Web — current + previous major of Chrome,
Firefox, Safari, Edge on Windows, macOS, Linux, iOS, Android;
desktop + mobile.
**Project Type**: Single-project static web app.
**Performance Goals** (from constitution):

- JS bundle ≤ 200 KB gzipped.
- Time-to-first-stars ≤ 3 s on throttled 4G / mid-tier mobile CPU.
- ≥ 60 fps desktop, ≥ 30 fps mobile sustained.
- Input→visualization p95 ≤ 100 ms.
- Resident memory ≤ 150 MB on mobile steady-state.

**Constraints**:

- Single HTML file delivered as the shell (code + CSS inlined);
  data files live same-origin and are precached by the service
  worker.
- No runtime calls to any cross-origin service.
- Offline-functional after first successful online visit.
- WCAG 2.1 AA on the UI surrounding the visualization.

**Scale/Scope**: MVP with 3 user stories; ~9k stars, 88
constellations, 10 bodies (Sun/Moon/8 planets), ~25k searchable
cities, coarse tz boundaries; all data bundled.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checking against the five principles and the gate items under
*Development Workflow & Quality Gates* in
[../../.specify/memory/constitution.md](../../.specify/memory/constitution.md):

**Gate 1 — performance envelope fits budget.**
✅ Planned payload (research.md R13):

- JS code ≤ 90 KB gzipped (well under 200 KB code budget).
- Data ≈ 200 KB gzipped (stars 65 + constellations 5 + map 40 +
  cities 30 + tz 80 + service worker + minor). Data is accounted
  for separately per constitution; this is explicitly explained.

Time-to-first-stars plan: render the default observation using
only the WebGL shell + stars catalogue (≈ 150 KB gzipped
critical path). Cities + tz + map load *after* first paint. ✅.

**Gate 2 — UI latency targets declared.**
✅ FR-017 + SC-002 set 100 ms p95 input→update. Render loop uses
`requestAnimationFrame` with input events committed via a single
coalescing scheduler. Playback 60× means continuous refresh is
driven by `rAF`, not by input events. ✅.

**Gate 3 — Astronomical model named.**
✅ VSOP87 (planets + Sun), ELP-2000/82 (Moon), Yale Bright Star
Catalogue 5th revised (stars), Meeus reductions for
precession/nutation/refraction. Simplifications documented:
low-order nutation, refraction only above −1° altitude. Error
bounds < 0.1° across 1900–2100 (research R1–R3). ✅.

**Gate 4 — Baseline (no-WebGL) behaviour declared.**
✅ Canvas2D fallback renderer with identical interface;
feature-detected at `createRenderer`. Baseline renders
magnitude ≤ 4 stars as monochrome dots, straight constellation
lines, no twinkle, no planet billboards (symbols only). ✅.

**Gate 5 — Spec Kit conventions.**
✅ Branch `001-sky-viewer-mvp`, spec + plan + research + data-model
+ contracts under `specs/001-sky-viewer-mvp/`, feature pointer
persisted in `.specify/feature.json`, every clarification
recorded under `## Clarifications` in `spec.md`.

**No gate violations. Complexity Tracking table is empty.**

### Post-Phase-1 re-check

After writing `data-model.md`, `contracts/observation-api.md`, and
`quickstart.md`:

- Gate 1: still ✅ — no design element introduced new runtime
  dependencies.
- Gate 2: still ✅ — the contract for `setObservation` explicitly
  debounces persistence (500 ms) and a11y (200 ms), protecting the
  render path's 100 ms p95 budget.
- Gate 3: still ✅ — the `astronomy` module contract names every
  algorithm and requires contract tests against Stellarium
  references.
- Gate 4: still ✅ — the `Renderer` contract requires identical
  interface for WebGL2 and Canvas2D.
- Gate 5: still ✅.

**Post-Phase-1 Constitution Check: PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/001-sky-viewer-mvp/
├── spec.md              # ✅ feature spec (incl. Clarifications)
├── plan.md              # ✅ this file
├── research.md          # ✅ Phase 0 output
├── data-model.md        # ✅ Phase 1 output
├── quickstart.md        # ✅ Phase 1 output
├── contracts/           # ✅ Phase 1 output
│   └── observation-api.md
├── checklists/
│   └── requirements.md  # ✅ from /speckit.specify
└── tasks.md             # ⏳ Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── main.ts                  # entry: wires modules, registers SW, kicks off render
│   ├── observation-store.ts     # Observation state (data-model.md)
│   ├── persistence.ts           # localStorage (debounced)
│   └── a11y-summary.ts          # FR-018 live region writer
├── astro/
│   ├── time.ts                  # UTC ↔ local ↔ Julian Date ↔ GAST
│   ├── transforms.ts            # equatorial→horizontal, refraction
│   ├── stars.ts                 # catalogue parser + proper motion
│   ├── sun-moon.ts              # Sun + Moon (Meeus + ELP)
│   ├── planets.ts               # VSOP87 planets
│   ├── twilight.ts              # twilight phase + background colour
│   └── constellations.ts        # line-figure projection
├── ui/
│   ├── root.ts                  # top-level layout
│   ├── date-time-input.ts
│   ├── map-picker.ts            # SVG world map + pin + search
│   ├── compass.ts               # bearing input (+ touch)
│   ├── fov-control.ts           # pinch/scroll/keyboard FOV
│   ├── playback-control.ts      # play/pause/speed/reverse
│   └── caveat-banner.ts         # out-of-range date banner
├── render/
│   ├── renderer.ts              # factory: WebGL2 | Canvas2D
│   ├── webgl2/
│   │   ├── shaders.ts           # inlined GLSL
│   │   ├── star-pass.ts
│   │   ├── line-pass.ts
│   │   └── planet-pass.ts
│   └── canvas2d/
│       └── fallback.ts          # baseline renderer
└── sw/
    └── service-worker.ts        # precache HTML shell + data files

data/
├── stars.bin                    # YBSC subset (generated)
├── constellations.json          # (generated)
├── world.svg                    # (generated, Natural Earth)
├── cities.json                  # (generated, GeoNames subset)
└── tz.json                      # (generated, coarse tz grid)

tools/
├── build-stars.ts               # YBSC → stars.bin
├── build-cities.ts              # GeoNames → cities.json
├── build-tz.ts                  # tz boundaries → tz.json
├── build-world.ts               # Natural Earth → world.svg
└── inline-html.ts               # esbuild post-step: inline JS+CSS into one HTML

tests/
├── astronomy/
│   ├── reference-fixtures.test.ts   # Stellarium references for default + 4 others
│   ├── transforms.test.ts
│   ├── sun-moon.test.ts
│   ├── planets.test.ts
│   └── fixtures/                    # JSON reference data
├── store/
│   └── observation-store.test.ts
├── render/
│   └── renderer-factory.test.ts     # Canvas2D fallback behaviour
└── e2e/
    ├── default-observation.spec.ts  # V1 from quickstart.md
    ├── offline-after-first-load.spec.ts
    ├── out-of-range-date.spec.ts
    └── fov-direction.spec.ts

index.html                           # shell; esbuild inlines JS+CSS here
package.json
tsconfig.json
esbuild.config.mjs
playwright.config.ts
vitest.config.ts
```

**Structure Decision**: Single-project web app (Option 1 from the
template), with the standard `src/` subdivided by concern (app
state, astronomy math, UI, rendering, service worker). The
`tools/` directory holds one-shot data-generation scripts
(YBSC → binary, etc.) that run only at build time — they are
*not* shipped to the browser. The `data/` directory is the
shipped runtime payload, generated by `tools/` and versioned in
git so offline GitHub Pages deployment works without a Node
toolchain on the deploy target.

## Complexity Tracking

*Empty — no principle violations to justify.*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-|-|-|
| (none) | | |
