# Quickstart: Sky-Viewer MVP

**Feature**: 001-sky-viewer-mvp
**Audience**: Anyone running the project locally or verifying a
deployment.

## Prerequisites

- Node.js ≥ 20 (for the dev build pipeline only; the app itself
  has no runtime Node dependency).
- A modern browser (Chrome, Firefox, Safari, Edge — current or
  previous major).

## One-time setup

```bash
git checkout 001-sky-viewer-mvp
npm install
```

Installs dev-only tools: `typescript`, `esbuild`, `vitest`,
`@playwright/test`.

## Run locally

```bash
npm run dev
```

Serves `index.html` with the full data payload at
`http://localhost:5173/`. First paint should occur within
~1 s on localhost; open the app — you should immediately see the
canonical default: Moore Hall, 1969-12-13 00:00 EST, facing north,
90° FOV, playback at 60× real-time.

## Build for production

```bash
npm run build
```

Produces `dist/` containing:

- `index.html` (HTML shell with inlined JS + CSS)
- `sw.js` (service worker)
- `data/stars.bin`
- `data/constellations.json`
- `data/world.svg`
- `data/cities.json`
- `data/tz.json`

Everything in `dist/` is static; deploy as-is to GitHub Pages.

## Deploy to GitHub Pages

```bash
npm run deploy          # pushes dist/ to gh-pages branch
```

Site lives at `https://<user>.github.io/sky-viewer/`.

## Verify a deployment

Run these in order; stop and investigate on any failure.

### V1: Default observation renders (FR-000, SC-001)

1. Open the deployed URL in an incognito / fresh-cache window.
2. Within 3 seconds, the page shows an animated sky.
3. The observation readout shows:
   *"Moore Hall, Dartmouth College, Hanover, NH · 1969-12-13 ·
   00:00 America/New_York (UTC−05:00) · facing N (0°) · FOV 90°"*.

### V2: Astronomical accuracy (SC-006)

1. At the default observation, pause playback.
2. Compare the positions of Polaris, Vega, Sirius, Betelgeuse,
   Rigel against Stellarium for the same instant and location.
3. Every star must be within 0.1° of its Stellarium position.
4. Vitest `npm test` must pass the contract tests in
   `tests/astronomy/reference-fixtures.test.ts` for the same set
   on every commit.

### V3: Playback (Q3 clarification, FR-006/FR-006a)

1. On the default observation, watch without interacting for 10 s.
2. Stars and the Moon visibly drift (at 60×, 10 s of wall clock is
   10 minutes of sky).
3. Use the playback control: pause — motion stops. Press reverse —
   motion reverses. Press 1× — motion slows to real-time.

### V4: FOV and direction (Q4 clarification, FR-005/FR-005a)

1. Pinch-zoom (or scroll) in — FOV indicator drops toward 30°;
   stars spread out.
2. Pinch-zoom out — FOV approaches 180°; view becomes hemispheric.
3. Rotate direction to E, S, W — the visible slice of sky rotates.

### V5: Map location picker (US2, FR-004)

1. Open the map picker. Drop a pin on Sydney, Australia.
2. Close the map. The sky re-renders for the southern hemisphere —
   the Southern Cross (Crux) should now be visible; Polaris should
   not.
3. Reopen the map — the pin is still on Sydney with the label.

### V6: Offline after first load (FR-013, SC-010)

1. After V1 succeeds, close the browser tab.
2. Disconnect the network.
3. Reopen the deployed URL. The sky still renders correctly using
   the service worker cache.

### V7: No external runtime calls (FR-001, SC-007, FR-016)

1. Open DevTools → Network tab, uncheck "Preserve log".
2. Hard-reload the page.
3. After the initial same-origin HTML + JS + data requests, there
   must be **zero** cross-origin requests for any user input
   (date change, location pick, direction change).

### V8: Caveat banner on out-of-range date (Q1 clarification)

1. Set date to 1850-01-01. A persistent banner appears:
   *"Outside verified range (1900–2100); accuracy is degraded."*
2. Set date back to 2000-01-01. Banner disappears.

### V9: Progressive enhancement (FR-012, SC-004)

1. Open DevTools → run `delete WebGL2RenderingContext.prototype`
   in the console and reload.
2. The page renders a legible fallback sky (monochrome dots,
   thinner feature set) without errors.

### V10: Accessibility (FR-014, FR-018, SC-009)

1. Tab through the UI; every control receives a visible focus ring.
2. Invoke a screen reader (VoiceOver / NVDA). Change the date. The
   live region announces the new observation per the FR-018 format.
3. Run Lighthouse (mobile profile) — Accessibility score ≥ 90,
   Performance score ≥ 90.

## Expected fixtures

Unit/contract tests reference a small set of anchor observations:

- **Default**: Moore Hall, 1969-12-13 00:00 EST (primary regression fixture)
- **Equatorial**: Quito (0°, −78.5°), 2000-03-20 12:00 local (vernal equinox noon)
- **Arctic**: Longyearbyen (78.2°, 15.6°), 2020-06-21 00:00 local (midnight sun)
- **Antarctic**: McMurdo (−77.8°, 166.7°), 2020-12-21 00:00 local (midday sun)
- **Southern**: Sydney (−33.9°, 151.2°), 2025-01-01 00:00 AEDT (Crux visible)

Each fixture has Stellarium-derived reference altitudes and azimuths
for 10 anchor stars + Sun + Moon, stored in
`tests/astronomy/fixtures/*.json`.
