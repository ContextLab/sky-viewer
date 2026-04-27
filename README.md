# sky-viewer

**Live demo:** <https://context-lab.com/sky-viewer/>

An interactive, astronomically accurate planetarium in your browser. Pick a date, location (by map, city search, or GPS), direction, and time of day; see the sky as it would appear from that vantage point. Works offline after first load, on any browser, desktop or mobile.

The default view opens on **Moore Hall, Dartmouth College, Hanover NH**, facing due north, at the current time.

---

## About this project

sky-viewer was built as an in-class demo hackathon project for the **Storytelling with Data** course at Dartmouth, during the *Vibe Coding* lecture.

- Course: <https://context-lab.com/storytelling-with-data/>
- Vibe coding lecture: <https://context-lab.com/storytelling-with-data/slides/vibe-coding.html>

The entire codebase — spec, plan, tasks, astronomy math, rendering pipeline, UI, tests, CI — was generated through a single Claude Code session using the Spec Kit workflow (`/speckit.constitution` → `/speckit.specify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.implement`) plus many rounds of interactive back-and-forth. The commit history tells the story of the live build.

---

## Features

- **Astronomically accurate.** Yale Bright Star Catalogue (≤ mag 6.5, 8,404 stars) plus Sun, Moon, and all eight planets computed via Meeus-derived ephemeris (VSOP87 / ELP / low-precision Keplerian with empirical corrections). Target accuracy: ≤ 0.1° over 1900–2100.
- **Any time, any place.** Date, time-of-day, and latitude/longitude are fully user-controllable. Observer time-zones resolve offline via a compact 0.25° IANA boundary lookup.
- **Click-to-pick location.** Offline map picker with a Natural Earth admin-0 SVG, a GeoNames city autocomplete, and an opt-in `navigator.geolocation` shortcut.
- **Drag-to-rotate, pinch-to-zoom.** Bearing, pitch (−30° to +90°), and field-of-view (30° to 180°) are all manipulable from the sky canvas or dedicated instrument widgets.
- **88 IAU constellation line-figures + 87 named bright stars.** Layer toggles for each.
- **Live View (mobile).** On devices with real sensors, GPS + compass + accelerometer slave the view to where the phone is pointing.
- **Night Vision Mode.** Red-channel-only overlay to preserve dark-adapted eyes for real stargazing.
- **Offline after first load.** A small service worker precaches the HTML shell and all five data files so subsequent visits work with no network.
- **Single-page, no backend.** No API keys. No accounts. No telemetry. No runtime external calls. Host the static output anywhere.
- **Print Mode (Star Stencil PDF).** Press the Print Mode button to enter a dedicated overlay where you sketch your room (rectangular template or arbitrary closed polygon, draggable vertices/segments, place light fixtures + windows + doors with paint/no-paint flags), pick a paper size, and press Compute. The app emits a multi-page PDF: cover page with calibrated hole-size markers (pencil / large nail / small nail / pin) and assembly instructions, followed by numbered tile pages that tile your ceiling, walls, and (optionally) floor. Cut, tape, spray-paint, peel — your room becomes the night sky from any chosen instant. Floor pages render the antipodal sky (the constellations currently below the horizon, "through the Earth"). All client-side; no server. See [specs/002-stencil-template-pdf/spec.md](specs/002-stencil-template-pdf/spec.md) for the full design.

---

## Run it locally

```bash
npm install
npm run dev              # http://localhost:5173
```

## Build and preview production

```bash
npm run build            # emits dist/ (single inlined index.html + data/)
npm run preview          # http://localhost:4173
```

## Tests

```bash
npm test                 # Vitest: astronomy math, observation store, a11y
npm run test:e2e         # Playwright: cross-browser E2E with screenshots
```

Astronomical accuracy is verified each run against [`astronomy-engine`](https://github.com/cosinekitty/astronomy) (NASA-derived reference, MIT) at five fixture observations.

## Deploy

A GitHub Actions workflow (`.github/workflows/pages.yml`) auto-deploys to GitHub Pages on every push to `main`.

---

## Data sources (all public domain / CC0)

| Source | Used for |
|-|-|
| Yale Bright Star Catalogue 5th revised (Harvard) | Star positions + proper motion |
| Stellarium Western skyculture | Constellation line-figures |
| Natural Earth 1:110m admin-0 countries | World map SVG |
| GeoNames `cities15000` | City search |
| `timezone-boundary-builder` 2024a | Offline tz resolution |

Raw datasets are downloaded and processed to compact runtime files by `npm run build:data`; processed files live under `data/` and ship with the repo.

---

## Architecture

- **`src/astro/`** — pure TypeScript astronomy (time, transforms, Sun/Moon/planets, twilight, star catalogue, constellations)
- **`src/app/`** — Observation state store with localStorage persistence + a11y live-region summary
- **`src/render/`** — WebGL2 primary renderer + Canvas2D progressive-enhancement fallback (byte-for-byte-identical projection math)
- **`src/ui/`** — Date/time, map picker, compass, pitch, FOV, playback, labels, layer toggles, Live View, Night Vision Mode
- **`specs/001-sky-viewer-mvp/`** — full Spec Kit artifacts (spec, plan, research, data-model, contracts, tasks)
- **`.specify/memory/constitution.md`** — guiding principles (performance, delight, accuracy, progressive enhancement, spec-driven discipline)

---

## License

MIT. See [LICENSE](LICENSE).

Copyright © 2026 Contextual Dynamics Laboratory.
