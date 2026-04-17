---
description: "Task list for Sky-Viewer MVP (feature 001-sky-viewer-mvp)"
---

# Tasks: Sky-Viewer MVP

**Input**: Design documents from `/specs/001-sky-viewer-mvp/`
**Prerequisites**: plan.md, spec.md (both required), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. Rationale — the feature spec (SC-006) and the contract (`contracts/observation-api.md`) explicitly require astronomy tests against Stellarium reference fixtures, and FR-012/SC-004 require verifiable fallback behaviour. Tests are therefore treated as *requested* for this feature.

**Organization**: Tasks are grouped by user story from spec.md (US1/US2/US3) so each story can be implemented, tested, and shipped independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks).
- **[Story]**: `[US1]`, `[US2]`, `[US3]` — only in user-story phases.
- Every task names an exact file path.

## Path Conventions

Single-project web app, per [plan.md](../../specs/001-sky-viewer-mvp/plan.md)
§ "Structure Decision". All paths are repo-root-relative.

- Source: `src/{app,astro,ui,render,sw}/`
- Data-generation tools (build-time only): `tools/`
- Shipped runtime data: `data/`
- Tests: `tests/{astronomy,store,render,e2e}/`
- Entry / config at repo root: `index.html`, `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `playwright.config.ts`, `vitest.config.ts`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization — toolchain, configs, and directory skeleton. No application logic yet.

- [ ] T001 Create the source-tree skeleton: empty directories `src/app/`, `src/astro/`, `src/ui/`, `src/render/webgl2/`, `src/render/canvas2d/`, `src/sw/`, `tools/`, `data/`, `tests/astronomy/fixtures/`, `tests/store/`, `tests/render/`, `tests/e2e/` (add an empty `.gitkeep` in each). Keeps subsequent `[P]` tasks collision-free.
- [ ] T002 Write `package.json` at repo root: `name: "sky-viewer"`, `type: "module"`, `engines.node: ">=20"`, devDependencies `typescript ^5`, `esbuild ^0.21`, `vitest ^2`, `@playwright/test ^1.45`, and npm scripts `dev`, `build`, `test`, `test:e2e`, `deploy`.
- [ ] T003 [P] Write `tsconfig.json` at repo root: `target: ES2020`, `module: ESNext`, `moduleResolution: Bundler`, `strict: true`, `noUncheckedIndexedAccess: true`, `lib: ["ES2020", "DOM", "DOM.Iterable", "WebWorker"]`, `types: ["vitest/globals"]`.
- [ ] T004 [P] Write `esbuild.config.mjs` at repo root that bundles `src/app/main.ts` → ESM minified, writes to `dist/app.js`, generates a meta file for payload-size checks, and runs a post-step that inlines `dist/app.js` + `dist/app.css` into `index.html` → `dist/index.html`.
- [ ] T005 [P] Write `vitest.config.ts` at repo root: environment `jsdom`, globals on, `test/**/*.test.ts` include pattern, and coverage reporter `text-summary`.
- [ ] T006 [P] Write `playwright.config.ts` at repo root configuring three browsers (chromium, firefox, webkit), `webServer` pointing at `npm run preview` on port 4173, `testDir: tests/e2e`.
- [ ] T007 [P] Write the HTML shell `index.html` at repo root containing the static document frame (no app logic yet): `<meta viewport>`, `<title>Sky-viewer</title>`, a `<main id="app">`, a visually-hidden `<div id="a11y-summary" role="status" aria-live="polite">`, and `<script type="module" src="/src/app/main.ts"></script>`.
- [ ] T008 [P] Write `src/styles.css`: CSS custom-property palette (night sky + twilight stops), fluid type scale, focus-ring style hitting 3:1 contrast, and a `.sr-only` utility class.

**Checkpoint**: `npm install && npm run build` succeeds producing an empty-but-valid `dist/index.html`. No story-level code yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The astronomy math, the Observation state store, and the build-time data-generation tools. Every user story depends on these.

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete.

### Astronomical core (pure TypeScript; no DOM)

- [ ] T009 [P] Implement `src/astro/time.ts`: `utcMsFromLocal(localDate, localTime, tz)`, `julianDate(utcMs)`, `julianCenturiesJ2000(utcMs)`, `greenwichApparentSiderealTime(utcMs): rad` (IAU 2000B reduced series). No deps.
- [ ] T010 [P] Implement `src/astro/transforms.ts`: `equatorialToHorizontal(ra, dec, latRad, lonRad, utcMs) → {altDeg, azDeg}` applying precession (Meeus low-order), nutation (truncated), and atmospheric refraction for altitudes > −1°. Per [contracts/observation-api.md](./contracts/observation-api.md) § `astronomy`.
- [ ] T011 [P] Implement `src/astro/sun-moon.ts`: `sunPosition(utcMs) → {ra, dec}` via Meeus Ch. 25 and `moonPosition(utcMs) → {ra, dec, phase, angularDiameterArcsec}` via truncated ELP-2000/82B.
- [ ] T012 [P] Implement `src/astro/planets.ts`: `planetPosition(body, utcMs) → {ra, dec, apparentMag}` for Mercury…Neptune via VSOP87 truncated series inlined as JS tables.
- [ ] T013 [P] Implement `src/astro/twilight.ts`: `twilightPhase(sunAltDeg) → 'day'|'civil'|'nautical'|'astronomical'|'night'` and `skyBackgroundColor(phase, sunAltDeg) → RGB` interpolating across the thresholds in data-model.md.
- [ ] T014 [P] Implement `src/astro/stars.ts`: binary-parser for `data/stars.bin` (uint16 id + 5×float32 + int8) plus `propagateStar(star, epochMs) → {ra, dec}` applying proper motion from J2000.0.
- [ ] T015 [P] Implement `src/astro/constellations.ts`: loader for `data/constellations.json` plus a `constellationLinesForFrame(stars, observation) → Array<[x1,y1,x2,y2]>` projector (uses a Stereographic projection scaled by FOV).

### Observation state (application layer)

- [ ] T016 Implement `src/app/observation-store.ts` per [contracts/observation-api.md](./contracts/observation-api.md): `getObservation`, `setObservation` (with coercion: bearing mod 360, FOV clamp 30–180, rate clamp ±86400), `subscribe`, `resetToDefault`, `isOutsideVerifiedDateRange`. Defaults from data-model.md § Observation.
- [ ] T017 [P] Implement `src/app/persistence.ts`: 500 ms-debounced writer to `localStorage.skyViewer.observation` (JSON) plus a loader that validates `schemaVersion === 1` and falls back silently to `DEFAULT_OBSERVATION` on any parse error.
- [ ] T018 [P] Implement `src/app/a11y-summary.ts`: `updateSummary(obs, el)` writing the FR-018 text template, 200 ms-debounced.

### Build-time data generation (runs at `npm run build:data`)

- [ ] T019 [P] Implement `tools/build-stars.ts`: downloads/reads YBSC5 input, filters V-magnitude ≤ 6.5, packs to the binary layout in data-model.md § Star, writes `data/stars.bin` (~155 KB uncompressed, ~65 KB gzipped). Also emits a JSON index of HR numbers for human debugging.
- [ ] T020 [P] Implement `tools/build-constellations.ts`: reads Stellarium's Western `constellationship.fab`, resolves star names to YBSC HR numbers, writes `data/constellations.json` with `{name, fullName, lines}` entries per data-model.md § Constellation.
- [ ] T021 [P] Implement `tools/build-world.ts`: reads Natural Earth 1:110m `admin_0_countries` shapefile, simplifies (Douglas-Peucker at tolerance matching on-screen pixel cost), and writes a single optimised continents-only `data/world.svg` (~40 KB gzipped).
- [ ] T022 [P] Implement `tools/build-cities.ts`: reads GeoNames `cities15000.txt`, keeps `{name, asciiName, country, lat, lon, population}`, sorts by descending population, writes `data/cities.json` (~30 KB gzipped).
- [ ] T023 [P] Implement `tools/build-tz.ts`: reads the public tz boundary polygons at coarse resolution (≈0.25°), produces a flat rectangular lat/lon→IANA-zone lookup, writes `data/tz.json` (~80 KB gzipped).
- [ ] T024 Wire an `npm run build:data` script in `package.json` that runs T019–T023 sequentially and fails fast on any output exceeding its declared payload budget. Commit the generated files to git (per plan.md § Structure Decision).

### Foundational tests

- [ ] T025 [P] Write `tests/astronomy/fixtures/moore-hall-1969.json`: Stellarium-derived reference altitudes and azimuths for Polaris, Vega, Sirius, Betelgeuse, Rigel, Arcturus, Capella, Aldebaran, Procyon, Altair + Sun + Moon at the canonical default observation (Moore Hall, 1969-12-13 00:00 EST). Human-readable comments explain each source.
- [ ] T026 [P] Write `tests/astronomy/fixtures/quito-equinox.json`, `tests/astronomy/fixtures/longyearbyen-midnight-sun.json`, `tests/astronomy/fixtures/mcmurdo-midday-sun.json`, `tests/astronomy/fixtures/sydney-crux.json` — the four secondary fixtures from quickstart.md § "Expected fixtures".
- [ ] T027 [P] Write `tests/astronomy/transforms.test.ts`: for every fixture, `equatorialToHorizontal` must agree with Stellarium within **0.01°** for the 10 anchor stars (SC-006 with a stricter internal tolerance than 0.1°).
- [ ] T028 [P] Write `tests/astronomy/sun-moon.test.ts`: Sun altitude within 0.01°, Moon altitude within 0.05°, Moon phase within 0.01, for every fixture.
- [ ] T029 [P] Write `tests/astronomy/planets.test.ts`: each planet's (altitude, azimuth) within 0.05° of its Stellarium reference at every fixture where altitude > 0°.
- [ ] T030 [P] Write `tests/store/observation-store.test.ts`: `setObservation({bearingDeg: 370})` stores 10; `resetToDefault()` writes exactly the FR-000 tuple; `isOutsideVerifiedDateRange` returns false for the default and true for 1850-01-01.

**Checkpoint**: `npm test` runs Vitest end-to-end and every astronomy + store test passes. `npm run build:data` produces all five `data/*` files within their payload budgets. The project has no UI yet, but the math and state are provably correct. User-story work can begin in parallel from this point.

---

## Phase 3: User Story 1 — See the sky for a moment in time (Priority: P1) 🎯 MVP

**Goal**: First-time visitor opens the page and an animated, astronomically-correct default sky renders within 3 seconds. Inputs `date` + `time` modify it. Works with **no** map, **no** direction picker, and **no** WebGL if the browser lacks it.

**Independent Test**: Per [spec.md](./spec.md) § US1 Independent Test — load on fresh browser; within 3 s the Moore Hall 1969-12-13 default sky renders; changing date or time updates within 100 ms; mobile is legible; offline-reload after first visit still works (offline service worker is a Polish-phase task, so this last clause is validated in Phase 6).

### Tests for US1 ⚠️

> Write these tests FIRST; ensure they FAIL before implementation tasks T036–T044.

- [ ] T031 [P] [US1] Write `tests/render/renderer-factory.test.ts`: `createRenderer(canvas)` returns a `Canvas2D` renderer when `HTMLCanvasElement.prototype.getContext('webgl2')` returns null; returns a WebGL2 renderer otherwise. Both returns satisfy the same interface. (Covers FR-012, SC-004.)
- [ ] T032 [P] [US1] Write `tests/e2e/default-observation.spec.ts` (Playwright): load the preview server, wait ≤ 3 s for a `<canvas data-ready="true">` attribute, assert the a11y summary text matches the FR-018 template for the default observation.
- [ ] T033 [P] [US1] Write `tests/e2e/input-latency.spec.ts` (Playwright): after initial render, programmatically dispatch a date-input change and assert the next-rendered-frame occurs within 100 ms (p95 across 20 repeats). Covers SC-002 / FR-017.
- [ ] T034 [P] [US1] Write `tests/e2e/date-time-change.spec.ts`: changing the date from 1969-12-13 to 2000-06-21 measurably changes the rendered star positions (sample 3 pixel coordinates of known stars; assert displacement > 50 px at default FOV).
- [ ] T035 [P] [US1] Write `tests/e2e/fallback-render.spec.ts`: inject a script into the page that deletes `WebGL2RenderingContext` before load, assert the page still produces a visible sky (non-blank canvas, > 100 drawn pixels).

### Implementation for US1

- [ ] T036 [P] [US1] Implement `src/render/webgl2/shaders.ts`: export two GLSL strings — a point-sprite vertex shader that takes `(ra, dec, mag)` and projects to screen via the current View Frame uniforms, and an additive-blend fragment shader that renders a soft star disc sized by magnitude with subtle twinkle driven by a time uniform.
- [ ] T037 [US1] Implement `src/render/webgl2/star-pass.ts`: creates and binds a VAO populated from the star catalogue (after `propagateStar`), draws via `gl.drawArraysInstanced` in one call. Dependency: T014, T036.
- [ ] T038 [US1] Implement `src/render/webgl2/planet-pass.ts`: draws Sun, Moon, planets as textured billboards with magnitude-based sizing. Dependency: T011, T012.
- [ ] T039 [US1] Implement `src/render/webgl2/line-pass.ts`: draws constellation line-figures as a single `gl.LINES` batch with anti-aliasing. Dependency: T015.
- [ ] T040 [US1] Implement `src/render/canvas2d/fallback.ts`: full Canvas2D baseline renderer (monochrome dots for stars ≤ mag 4, straight lines for constellations, text symbols for planets). Same interface as the WebGL2 renderer. Covers FR-012, SC-004.
- [ ] T041 [US1] Implement `src/render/renderer.ts`: `createRenderer(canvas)` factory with WebGL2 feature-detection and graceful fallback; the returned `Renderer` exposes `render(skyState, viewFrame)` and `dispose()`. Dependency: T037–T040.
- [ ] T042 [US1] Implement `src/ui/date-time-input.ts`: two inputs bound to `observation.localDate` and `observation.localTime`, committing via `setObservation` on change/blur. Keyboard-accessible; ARIA-labelled.
- [ ] T043 [US1] Implement `src/ui/playback-control.ts`: compact bar with pause/play toggle, speed selector (−60×, 1×, 60×, 600×, 3600×), and a "reset to entered instant" button per FR-006a.
- [ ] T044 [US1] Implement `src/app/main.ts`: the page entry point — loads all five `data/*` files in parallel, initialises the Observation store (reading localStorage), creates the renderer, mounts the date/time inputs and the playback control, and drives the render loop via `requestAnimationFrame` with a single input-coalescing scheduler that enforces the 100 ms p95 budget. On each frame it computes `SkyState` (per-frame Sun/Moon/planet positions + filtered visible stars) and calls `renderer.render`. Calls `a11y-summary.updateSummary` on every observation change.

**Checkpoint**: The page loads the default observation, animates at 60× real-time, responds to date/time input within 100 ms, falls back cleanly when WebGL2 is unavailable, and passes the e2e tests T031–T035. **MVP is shippable at this point** (without map/direction/offline).

---

## Phase 4: User Story 2 — Choose where on Earth you're standing (Priority: P2)

**Goal**: From the rendered default sky, a user can open a map picker, either drop a pin, search a city by name, or opt into `navigator.geolocation`; the sky re-renders for the new location within the 100 ms p95 budget. Location persists across reloads.

**Independent Test**: Per spec.md § US2 Independent Test — from the rendered default, pin Sydney on the map; the Southern Cross becomes visible; Polaris disappears; verifiable against Stellarium for the same place/time.

### Tests for US2 ⚠️

- [ ] T045 [P] [US2] Write `tests/e2e/map-pick-sydney.spec.ts`: open the map, pick a point at (−33.9°, 151.2°), close the map; assert at least one star from the Crux constellation is now visible (present in the `visibleStars` debug hook) and Polaris is not.
- [ ] T046 [P] [US2] Write `tests/e2e/city-search.spec.ts`: open the map, type "Tokyo", select the top autocomplete result, close the map; assert the observation label reads "Tokyo" and lat is within 0.1° of 35.6895.
- [ ] T047 [P] [US2] Write `tests/e2e/geolocation-opt-in.spec.ts`: stub `navigator.geolocation.getCurrentPosition` to return a fixed Paris coordinate; click the "use my location" button; assert the observation updates.
- [ ] T048 [P] [US2] Write `tests/e2e/location-persistence.spec.ts`: pick Sydney, close the map, reload the page; assert the pin is still on Sydney with the correct label.

### Implementation for US2

- [ ] T049 [P] [US2] Implement `src/ui/map-picker.ts` base: renders `data/world.svg`, handles pan (drag / touch) and pinch-zoom, emits `(lat, lon)` on tap/click. No search yet.
- [ ] T050 [US2] Add city search to `src/ui/map-picker.ts`: text input with prefix autocomplete against `data/cities.json` (pre-sorted by population, so no index is required for correctness — a linear scan on the first 500 entries is fast enough); selecting a result drops a pin there.
- [ ] T051 [US2] Add geolocation opt-in to `src/ui/map-picker.ts`: a single button that calls `navigator.geolocation.getCurrentPosition` with a clear permission prompt the first time; gracefully no-ops when the API is absent or the user denies.
- [ ] T052 [P] [US2] Implement `src/ui/tz-resolver.ts`: given a `(lat, lon)`, look up the IANA zone in `data/tz.json` and derive the current UTC offset (respecting DST via the JS `Intl.DateTimeFormat` fallback). Wire into `setObservation` so changing location also updates `timeZone` and `utcOffsetMinutes`.
- [ ] T053 [US2] Wire the map picker into `src/app/main.ts`: mount as an overlay triggered by a "location" button in the top bar; on close, call `setObservation({location, timeZone, utcOffsetMinutes})`.

**Checkpoint**: Users can now choose any location on Earth. Phase 4 tests pass. US1 still passes (no regressions in render path).

---

## Phase 5: User Story 3 — Orient yourself by direction and time of day (Priority: P3)

**Goal**: The user rotates the facing direction and changes the time-of-day; the view frame and sky background respond accordingly. Compass rotation changes which slice of sky is visible at the default ~90° FOV; twilight colours animate smoothly.

**Independent Test**: Per spec.md § US3 Independent Test — rotate N→E→S→W and confirm the visible slice rotates; set time-of-day to noon → dusk → night → dawn and confirm sky background, star visibility, and sun altitude update correctly.

### Tests for US3 ⚠️

- [ ] T054 [P] [US3] Write `tests/e2e/direction-rotation.spec.ts`: rotate bearing from 0° to 90°; assert the set of stars with `onscreen=true` changes measurably and that a known star at azimuth ~0° (Polaris at Moore Hall) leaves the visible set.
- [ ] T055 [P] [US3] Write `tests/e2e/twilight-colors.spec.ts`: for the default location, step time-of-day through noon → 18:00 → 22:00 → midnight → 04:00 → 06:00 local; sample the canvas background colour after each step and assert it matches the `twilightPhase` lookup within a small tolerance.
- [ ] T056 [P] [US3] Write `tests/e2e/fov-zoom.spec.ts`: default FOV=90°; synthesize a pinch-in gesture; assert FOV readout drops below 60°; synthesize scroll-out; assert FOV rises to 180°.

### Implementation for US3

- [ ] T057 [P] [US3] Implement `src/ui/compass.ts`: a circular compass widget accepting touch-drag + keyboard left/right; commits `bearingDeg` via `setObservation`. Visible cardinal labels N/E/S/W rotate with the bearing so the horizon orientation stays truthful.
- [ ] T058 [P] [US3] Implement `src/ui/fov-control.ts`: listens for `wheel`, `keydown` (`+`/`-`), and `gesturechange` / pinch events on the canvas; clamps to 30–180° and commits via `setObservation`. Displays a small numeric FOV readout per FR-005a.
- [ ] T059 [US3] Extend `src/app/main.ts` render pipeline: the View Frame now projects only the sky slice within the current bearing ± FOV/2 horizontally; combine with the twilight background colour from T013 for a continuous day-night backdrop.
- [ ] T060 [US3] Implement `src/ui/caveat-banner.ts`: subscribes to observation; when `isOutsideVerifiedDateRange` is true, renders a persistent, dismissible-but-reappearing banner per the Q1 clarification and FR-007.

**Checkpoint**: All three user stories fully functional. Phase 5 tests pass. Phase 3 and 4 tests still pass.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Offline support, performance / accessibility hardening, GitHub Pages deploy pipeline. None of these are required to ship US1–US3, but together they hit every outstanding FR / SC.

- [ ] T061 [P] Implement `src/sw/service-worker.ts`: a minimal precache-first service worker that caches `index.html` and every `/data/*.{bin,json,svg}` on `install`, serves same-origin requests from cache with network-fallback. Register it from `src/app/main.ts` after first successful render. Covers FR-013, SC-010, SC-007. Add `tests/e2e/offline-after-first-load.spec.ts`.
- [ ] T062 [P] Implement `tools/inline-html.ts`: the esbuild post-step from T004 — reads the built `dist/app.js` and `dist/app.css`, injects them inline into `index.html`, writes `dist/index.html`. Fail the build if the final `dist/index.html` (with inlined JS+CSS, gzipped) exceeds 220 KB — a hard margin over the constitution's 200 KB code budget.
- [ ] T063 [P] Add a CI payload budget check: a `package.json` script `check:payload` that gzips every file in `dist/` and fails if JS code exceeds 200 KB gzipped or total data exceeds 250 KB gzipped. Matches plan.md § Gate 1 and research.md R13. Wire into `npm run build`.
- [ ] T064 [P] Add a Lighthouse CI check: run `lhci autorun` in mobile profile against the built site and fail if Performance < 90 or Accessibility < 90. Matches SC-009.
- [ ] T065 Write `tests/e2e/out-of-range-date.spec.ts`: set date to 1850-01-01; assert the caveat banner becomes visible with the Q1-clarified wording; set date back to 2000-01-01; assert the banner disappears.
- [ ] T066 [P] Write `tests/e2e/keyboard-navigation.spec.ts`: tab through every interactive control in order; assert every focus stop has a visible focus ring and an accessible name. Matches FR-014.
- [ ] T067 [P] Add a `deploy` npm script that pushes `dist/` to the `gh-pages` branch via `git subtree push` (no third-party gh-pages tools — keeps the deploy reproducible from a vanilla clone). Matches FR-002.
- [ ] T068 Run the full quickstart.md verification procedure (V1–V10) against a deployed GitHub Pages build; record observed numbers (time-to-first-stars, fps desktop, fps mobile, input latency p95) in `specs/001-sky-viewer-mvp/verification-results.md`. Matches Principle V validation.
- [ ] T069 Update the top-level [README.md](../../README.md) with a short "how to run" + "what it is" blurb and a link to the deployed site. Matches the constitution sync-impact follow-up.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies; can start immediately.
- **Foundational (Phase 2)**: depends on Setup; **blocks** all user stories.
- **US1 (Phase 3)**: depends on Foundational.
- **US2 (Phase 4)**: depends on Foundational and *light* integration from US1 (needs `src/app/main.ts` to exist — T044 — before its wiring task T053 runs). US2 tests and most US2 implementation tasks (T049–T052) are independent of US1 and can start as soon as Foundational is done.
- **US3 (Phase 5)**: depends on Foundational; integrates via `src/app/main.ts` (T059) so it needs T044 for its wiring task, but tests + widget files (T054–T058) are independent.
- **Polish (Phase 6)**: depends on US1–US3 being complete for the full run of T068; individual polish tasks can land earlier.

### Within each phase

- In **Foundational**, T009–T015 (pure astronomy) are all `[P]`; T016 depends on nothing outside Foundational itself; T017–T018 are `[P]` once T016 exists. Data-generation tools T019–T023 are all `[P]`; T024 depends on them.
- In **US1**, tests T031–T035 are `[P]` and MUST precede T036–T044. Within implementation, T037 depends on T014+T036; T041 depends on T037–T040; T044 depends on everything else in US1.
- In **US2**, T049–T052 are `[P]`; T053 depends on T049 and T052 (and on T044 existing from US1).
- In **US3**, T057–T058 are `[P]`; T059 depends on T044 existing and T058 (FOV); T060 depends on T016 (store) only.

## Parallel Opportunities

### Largest parallel fan-out: Foundational phase

After Setup, the following can run in parallel (different files, no shared state):

```bash
# 7-wide pure-astronomy parallel (T009–T015):
Task: "src/astro/time.ts"
Task: "src/astro/transforms.ts"
Task: "src/astro/sun-moon.ts"
Task: "src/astro/planets.ts"
Task: "src/astro/twilight.ts"
Task: "src/astro/stars.ts"
Task: "src/astro/constellations.ts"

# 5-wide data-generation parallel (T019–T023):
Task: "tools/build-stars.ts"
Task: "tools/build-constellations.ts"
Task: "tools/build-world.ts"
Task: "tools/build-cities.ts"
Task: "tools/build-tz.ts"

# 6-wide test-writing parallel (T025–T030):
Task: "tests/astronomy/fixtures/moore-hall-1969.json"
Task: "tests/astronomy/fixtures/*.json (secondary)"
Task: "tests/astronomy/transforms.test.ts"
Task: "tests/astronomy/sun-moon.test.ts"
Task: "tests/astronomy/planets.test.ts"
Task: "tests/store/observation-store.test.ts"
```

### Across user stories after Foundational

Once Phase 2 is complete, if staffed with multiple developers:

- Developer A: US1 (T031–T044)
- Developer B: US2 widgets (T049–T052) + tests (T045–T048)
- Developer C: US3 widgets (T057–T058, T060) + tests (T054–T056)

Each developer's wiring task in `src/app/main.ts` (T044, T053, T059) must serialise (same file), but everything else is parallel.

## Implementation Strategy

### MVP first (ship US1 only)

1. Complete Phase 1: Setup (T001–T008).
2. Complete Phase 2: Foundational (T009–T030).
3. Complete Phase 3: US1 (T031–T044).
4. **STOP and validate**: run V1–V4 and V7 from quickstart.md.
5. Deploy. This is a real, public-valuable MVP: anyone can open the page and see an astronomically accurate default sky that responds to date and time.

### Incremental delivery

1. Setup + Foundational → math + state are provably correct, no UI.
2. + US1 → shippable MVP.
3. + US2 → users can go anywhere on Earth.
4. + US3 → users can orient themselves realistically.
5. + Polish → offline-after-first-load, payload budgets enforced in CI, Lighthouse ≥ 90.

### Parallel team strategy

With three developers: A on US1, B on US2, C on US3 after Foundational is merged. Integration happens at `src/app/main.ts`, which each developer amends in a short, sequential wiring PR at the end of their story.

---

## Notes

- [P] tasks touch different files; [Story] label traces each task back to its source user story.
- Tests for each story MUST be written before its implementation tasks and MUST fail before implementation begins.
- Astronomical accuracy is verified by comparing to Stellarium-derived fixtures on every test run; SC-006 is enforced as a CI gate, not a manual check.
- Commit after each task or logical group; each checkpoint (end of a phase) is a natural PR boundary.
- Do not break previous user stories when adding a new one — the e2e suite for all completed stories runs on every PR.
