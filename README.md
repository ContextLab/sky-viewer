# sky-viewer

Enter a date, location (select on a map), direction, and time of day, and get back a fun animated visualization of the stars — with astronomical accuracy to better than 0.1° over 1900–2100.

The default view opens on **Moore Hall, Dartmouth College**, facing due north, at midnight on 1969-12-13 EST.

## What it is

- **Single-HTML-page web app.** No backend. No API keys. No runtime external calls.
- **Offline-capable** after the first load (service worker precaches everything).
- **Hosted on GitHub Pages**, works in every popular browser on desktop and mobile.
- **Astronomically accurate**: Yale Bright Star Catalogue (≤ mag 6.5), Stellarium Western constellation figures, Meeus-derived Sun / Moon / planet ephemeris, refraction-corrected altitude/azimuth transforms.
- **Rendered in WebGL2** with a full **Canvas2D fallback** for devices without WebGL.

## Local development

```bash
npm install
npm run dev            # serves at http://localhost:5173
```

## Production build

```bash
npm run build          # inlines JS+CSS into dist/index.html, enforces payload budget
npm run preview        # serves dist/ at http://localhost:4173
```

## Tests

```bash
npm test               # Vitest — astronomy math, state store, a11y
npm run test:e2e       # Playwright — end-to-end in Chromium/Firefox/WebKit
```

**Astronomical accuracy is verified** by comparing every test fixture against [`astronomy-engine`](https://github.com/cosinekitty/astronomy) (MIT, NASA-derived). Tolerances: 0.1° for stars, 0.2° for planets, 0.5 mag for planet brightness.

## Deploy

```bash
npm run deploy         # pushes dist/ to the gh-pages branch
```

## Data sources (all public domain / CC0)

- **Stars:** Yale Bright Star Catalogue, 5th revised edition
- **Constellations:** Stellarium Western skyculture
- **World map:** Natural Earth 1:110m admin-0 countries
- **Cities:** GeoNames `cities15000`
- **Timezones:** `timezone-boundary-builder` 2024a

Raw datasets are pulled by `npm run build:data` and processed into the compact runtime files under `data/`.

## Architecture

See [`specs/001-sky-viewer-mvp/`](specs/001-sky-viewer-mvp/) for the full specification, plan, research, and tasks. Key principles in [`.specify/memory/constitution.md`](.specify/memory/constitution.md).

## Licence

MIT. See [LICENSE](LICENSE).
