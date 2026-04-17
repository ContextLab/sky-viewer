# Phase 0 Research: Sky-Viewer MVP

**Feature**: 001-sky-viewer-mvp
**Date**: 2026-04-17
**Scope**: Resolve every "NEEDS CLARIFICATION" implied by Technical
Context, pick datasets and libraries, and document the reasoning so
the Constitution Check gate can be re-evaluated.

## R1. Star catalogue

**Decision**: Yale Bright Star Catalogue, 5th revised edition (BSC5 /
BSC5P), subset to stars with V-magnitude ≤ 6.5.

**Rationale**:

- Public domain (redistributable; no attribution legal risk for
  GitHub Pages hosting).
- 9,110 entries covers every naked-eye star — matches FR-008's
  "magnitude 6" requirement with headroom.
- With proper-motion, RA/Dec, V-magnitude, and spectral type stored
  as a packed binary (4 floats + 1 byte per entry ≈ 17 B/star), the
  whole catalogue fits in ≈ 155 KB uncompressed, ≈ 60–80 KB gzipped.
  Well within the *data payload* budget (the constitution's 200 KB
  gzipped budget is for code; data is accounted for separately but
  MUST be explained — done here).
- Proper-motion is adequate for ±100 yr (the spec's 1900–2100
  supported range); for the default 1969 fixture, propagation from
  J2000.0 is <30 arcseconds for all stars → well within 0.1°.

**Alternatives considered**:

- **Hipparcos main catalogue (118k stars)**: 10× the byte size, 99%
  of the extra stars below naked-eye magnitude. Rejected for payload.
- **Tycho-2 (2.5M stars)**: Tens of megabytes; wildly over budget.
  Rejected.
- **Smithsonian Astrophysical Observatory (SAO) catalogue**: Larger
  than YBSC with worse metadata; no advantage.

## R2. Ephemeris for Sun / Moon / planets

**Decision**: VSOP87 (analytic series) for the Sun and the 8 major
planets; ELP-2000/82B truncated series for the Moon. Hand-port of the
Meeus (*Astronomical Algorithms*, 2nd ed.) reductions for
precession, nutation, and apparent position.

**Rationale**:

- VSOP87 truncated to the terms needed for arc-minute accuracy is a
  few hundred coefficients, ≈ 20 KB of JS tables — fits the payload.
- Accuracy over 1900–2100 is well under the 0.1° SC-006 target (sub
  arc-minute for planets, sub arc-second for Sun).
- ELP-2000/82 for the Moon, truncated similarly, gives ~1′ accuracy —
  far better than 0.1°.
- All three models are public-domain (CNRS / Bureau des Longitudes);
  no licence blocker.
- Meeus reductions are textbook; implementations in JS exist under
  permissive licences (e.g. astronomia, astronomy-engine). We'll
  either vendor a small portion or reimplement the needed pieces to
  keep the payload minimal.

**Alternatives considered**:

- **JPL DE440 / DE441 numerical ephemeris**: gold standard, but the
  data files are MB-scale even at daily-sampled chunks. Overkill for
  0.1° accuracy; rejected.
- **Hand-tuned low-precision Sun/Moon formulas**: violates the
  "never hand-tune" clause of FR-007 and the Astronomical Accuracy
  constitution principle. Rejected.

## R3. Coordinate transforms

**Decision**: Implement the standard chain: Julian Date (from UTC) →
mean + apparent sidereal time (GMST/GAST per IAU 2000B reduced
series) → hour angle → equatorial→horizontal (altitude/azimuth) with
refraction correction for altitudes > −1°.

**Rationale**:

- Deterministic, closed-form, <100 lines of JS per step.
- All formulas are textbook Meeus / SOFA; no dependencies.
- Arc-second accuracy is more than enough for 0.1° SC-006 target.

**Alternatives considered**:

- **Full IAU 2006/2000A precession-nutation (CIO-based)**: overkill
  for our accuracy tier; would add KB of nutation coefficients.
- **Skip refraction**: would cost up to 0.5° accuracy near the
  horizon — would break SC-006 when comparing to Stellarium, which
  applies refraction.

## R4. Constellation line-figures

**Decision**: Stellarium's "Western" `constellationship.fab` file
(GPL-compatible, widely used), bundled. IAU constellation boundaries
are *not* drawn for MVP (lines only).

**Rationale**:

- ~400 line segments total, trivially small (< 10 KB).
- Matches what users see in reference tools (Principle III).
- Standard = recognisable; "make it awesome" works better with
  shapes people already know.

**Alternatives considered**:

- **IAU rectilinear boundaries**: aesthetic clutter for MVP; defer.
- **Custom artistic figures**: risks cultural-specificity claims we
  don't want to make and violates the "single standard set"
  assumption in the spec.

## R5. Offline-capable map + geocoder (for User Story 2)

**Decision**: An embedded low-poly world map (continents as SVG
paths, ~40 KB gzipped, derived from Natural Earth 1:110m admin0)
with drag-to-pan + pinch-to-zoom, plus an embedded GeoNames
"cities15000" subset (~30 KB gzipped, ~25k cities ≥ 15k population)
for name-based search. No tile server, no API calls. Device
geolocation (`navigator.geolocation`) is offered as a separate
opt-in path.

**Rationale**:

- The single-HTML + offline-after-first-load + no-API-keys
  constraints make tile-based maps (Leaflet/OSM) disqualified for
  core functionality. A stylised world map is actually on-brand: the
  app isn't about street-level navigation, it's about picking a
  point on Earth.
- Natural Earth + GeoNames are both public domain / CC0 — no
  attribution landmines.
- Combined ~70 KB gzipped is within reasonable data budget.

**Alternatives considered**:

- **Leaflet + OSM tiles**: beautiful, but offline-hostile and
  violates FR-001/FR-013. Rejected.
- **Just lat/lon text inputs**: loses Principle II delight.
  Rejected.
- **Full GeoNames (11M rows)**: > 100 MB; absurd. Subset is enough.

## R6. Time-zone resolution without network

**Decision**: Embed a compact lat/lon → IANA-zone lookup (`tz.json`
compressed rectangular bins with zone IDs, derived from the public
`tzdb` + `timezone-boundary-builder` at low resolution ≈ 0.25°
granularity). Pair with a JS implementation of the tz offset rules
(e.g. a vendored `@js-temporal/polyfill` subset, or native
`Intl.DateTimeFormat` where available).

**Rationale**:

- Turns the "time zone ambiguity" edge case into a non-issue:
  picking a pin on the map determines the tz deterministically,
  offline.
- Coarse 0.25° resolution is fine: tz boundaries are political, not
  physical, and the user sees the chosen offset and can override it
  (per the spec's tz-override assumption).
- Compressed lookup ~80 KB gzipped.

**Alternatives considered**:

- **Browser `Intl` + hardcoded offset-from-device-tz**: fails for
  users who pin a location in a different tz than their device.
- **Ask an online tz service**: violates FR-001/FR-016.

## R7. Rendering technology

**Decision**: Primary renderer is **WebGL2** (single vertex + fragment
shader pair for the star field, instanced points with per-star size
modulated by magnitude, plus additive blending for twinkle; a second
simple pass for constellation lines and planet billboards). Fallback
is **Canvas2D** when WebGL2 is unavailable, rendering a reduced
star set with monochrome dots and straight constellation lines.

**Rationale**:

- WebGL2 is supported by every Tier 1 browser we target (FR-011) and
  delivers the 60 fps desktop / 30 fps mobile target easily even
  with 9k instanced stars.
- The Canvas2D fallback is not theoretical: it's the contract that
  makes FR-012 + SC-004 true.
- No WebGPU for MVP: Safari's WebGPU is still in flux across our
  Tier 1 range. We'll add WebGPU later as a capability-detected
  upgrade if it becomes worthwhile (Principle IV: progressive
  enhancement).

**Alternatives considered**:

- **Canvas2D only**: cannot hit 60 fps on mid-range mobile for 9k
  stars with twinkle; would miss SC-003.
- **WebGPU primary**: not yet broad enough; would violate FR-011.
- **Three.js / regl**: adds 100–200 KB of framework we don't need
  for a single fullscreen scene. The payload budget makes bespoke
  shaders cheaper than a general-purpose engine.

## R8. Single-HTML-file packaging

**Decision**: Build with **esbuild** (minify + tree-shake) plus a
small post-build inliner that emits one `index.html` with:

- CSS inlined in `<style>`.
- JS bundle inlined in `<script type="module">`.
- Astronomical data (catalogue, constellations, map, cities, tz)
  kept as a small number of *sibling* static files fetched with
  `fetch()` on load. These are same-origin; they satisfy FR-001
  (no external runtime dependency) and FR-013 (the service worker
  caches them on first load).

**Rationale**:

- "All code embedded" per user request + FR-001 = JS and CSS are
  inlined. Data, however, is large enough (~300 KB total across all
  datasets) that inlining as base64 blows past the HTML gzip sweet
  spot and delays time-to-first-paint. Splitting data into a
  handful of same-origin files lets the page render the shell
  immediately and stream data in parallel — crucial for SC-001
  (≤ 3 s time-to-first-stars on throttled 4G).
- esbuild: zero-config, fast, well under 100 ms rebuilds during
  development.

**Alternatives considered**:

- **Fully inline everything (inc. data) as base64 in the HTML**:
  pushes first-paint past 3 s on throttled 4G; blocks streaming.
- **Parcel / Vite / webpack**: heavier than needed; esbuild is
  sufficient.
- **No build step (write one monolithic HTML by hand)**: works for
  the P1 MVP but fights the minification/size budgets once we add
  WebGL shaders + ephemeris data. Build step is net-positive.

## R9. Offline support

**Decision**: Ship a tiny **service worker** that precaches the HTML
shell and every sibling data file on install, and serves them cache-
first. No runtime API calls to precache (per FR-001).

**Rationale**:

- Directly satisfies FR-013 (offline after first load) and SC-010.
- Service workers are Tier-1 browser-supported (FR-011).
- GitHub Pages serves over HTTPS, which is required for service
  worker registration — no blocker.

**Alternatives considered**:

- **AppCache**: deprecated.
- **No offline support**: violates FR-013.

## R10. Default playback rate

**Decision**: **60× real-time** as the default. User can toggle to
1× (real time), 600×, 3600×, or −60× (reverse), and pause.

**Rationale**:

- 60× means 1 s of wall clock = 1 minute of sky: fast enough that
  stars visibly drift (0.25°/s in declination for circumpolar stars,
  easily perceivable), slow enough that it doesn't induce motion
  discomfort. Matches the spec's "noticeable but not dizzying" from
  the Q3 clarification.
- 3600× (= 1 s wall clock per sky-hour) is the "show me the whole
  night in a few minutes" preset.
- Exposing both directions satisfies the spec's
  "scrub backward" requirement.

**Alternatives considered**:

- **1× default (real-time)**: motion is imperceptible except to
  careful observers; fails the "animated" promise for most users.
- **3600× default**: stars whip across the sky so fast the page
  feels strobing on mobile. Too much.

## R11. Input persistence

**Decision**: `localStorage` for the Observation tuple
(date, time, location, direction, FOV, playback rate, paused
state) under a single JSON-encoded key, schema-versioned.

**Rationale**:

- Simple; no IndexedDB overhead for ~200 B of state.
- Schema version field lets future migrations move forward safely.
- Directly satisfies FR-015.

**Alternatives considered**:

- **IndexedDB**: overkill for this volume.
- **URL query params only**: nice for shareability (future), but
  not the primary persistence mechanism per FR-015.

## R12. Accessibility implementation

**Decision**:

- A visually hidden `<h1>` and `<div role="status" aria-live="polite">`
  region contain the observation summary (FR-018). Updated via a
  single function on every input-commit.
- Every interactive control has a visible label, a focus ring, and
  a keyboard equivalent. Map pin uses `arrow keys + enter` to
  move/confirm.
- Colour contrast meets 4.5:1 for all text; the sky itself (dark on
  dark) is exempt as graphical content per WCAG.
- No colour is the only carrier of information (planet identity uses
  symbol + colour).

**Rationale**:

- Directly satisfies FR-014 and FR-018 and keeps the Q5
  clarification's MVP scope.

**Alternatives considered**:

- **Skip keyboard nav for the map**: fails FR-014.

## R13. Performance envelope reconciliation

**Decision**: Measure against the constitution's hard budgets on
every PR that touches render path:

| Budget | Target | Plan |
|-|-|-|
| JS bundle | ≤ 200 KB gzipped | Monitor via esbuild meta-output; fail CI on regression. |
| Time-to-first-stars | ≤ 3 s on throttled 4G / Moto G4 | Measure in Lighthouse mobile profile (SC-009). |
| Frame rate | ≥ 60 fps desktop, ≥ 30 fps mobile | `performance.now()` sampling + a dev-only FPS overlay. |
| Input→update latency p95 | ≤ 100 ms | Measure at input-event → `requestAnimationFrame` commit. |
| Memory | ≤ 150 MB steady-state mobile | Chrome DevTools performance profile. |

Payload accounting (pre-minification estimate):

| Asset | Approx. size (gz) |
|-|-|
| JS code (esbuild output) | 60–90 KB |
| CSS | < 5 KB |
| Stars (YBSC subset, binary) | 60–80 KB |
| Constellation lines | < 5 KB |
| World map SVG | 30–50 KB |
| Cities (GeoNames subset) | 20–40 KB |
| tz boundaries (coarse) | 60–100 KB |
| **Total wire** | **~250–370 KB gzipped** |

Code fits the 200 KB budget. Total data is ~200 KB gzipped and is
explicitly accounted for here, as the constitution requires.

## R14. Browser test matrix

**Decision**: Playwright smoke tests across Chromium, Firefox, WebKit
on CI; manual verification on iOS Safari and Android Chrome for each
release. Critical-path assertion: the default observation renders
without errors and produces at least 100 rendered star vertices
within 3 s of page load.

**Rationale**:

- WebKit in Playwright approximates Safari adequately for headless
  CI; real-device verification still required for touch gestures.

**Alternatives considered**:

- **BrowserStack / SauceLabs**: unnecessary cost for MVP.

---

## Summary: All NEEDS CLARIFICATION items resolved

- Language/Version → TypeScript 5.x targeting ES2020.
- Primary Dependencies → none at runtime except the browser; dev
  dependencies: esbuild, TypeScript compiler, Playwright.
- Storage → `localStorage` for Observation state; service worker
  cache for static assets.
- Testing → Vitest (unit, astronomy math), Playwright (integration /
  cross-browser smoke).
- Target Platform → Tier 1 browsers per constitution; mobile + desktop.
- Project Type → single-project static web app.
- Performance Goals → per the constitution; reconciled in R13.
- Constraints → single HTML shell, no runtime external deps, offline
  after first load, no API keys.
- Scale/Scope → MVP: 3 user stories, ~9k stars, 88 constellations,
  ~25k searchable cities, ~500 timezones. All static.

No open NEEDS CLARIFICATION remain.
