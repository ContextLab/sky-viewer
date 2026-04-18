# Data Model: Sky-Viewer MVP

**Feature**: 001-sky-viewer-mvp
**Date**: 2026-04-17

All entities here are *client-side only* (per FR-016). No database,
no server. "Persistent" means `localStorage`; "static" means bundled
data file fetched once and cached by the service worker.

## Entity: Observation

The single piece of user-editable state. Persisted to
`localStorage.skyViewer.observation` as JSON.

| Field | Type | Constraint | Notes |
|-|-|-|-|
| `schemaVersion` | integer | = 1 | Forward migration hook |
| `utcInstant` | ISO 8601 string (UTC) | required | Canonical resolved UTC moment |
| `localDate` | ISO date `YYYY-MM-DD` | required | As user entered it |
| `localTime` | `HH:MM` | required | As user entered it (24-hour) |
| `timeZone` | IANA zone name | required | e.g. `America/New_York` |
| `utcOffsetMinutes` | integer | −840 … +900 | Displayed to user per FR-010 |
| `location.lat` | number | −90 … 90 | Degrees |
| `location.lon` | number | −180 … 180 | Degrees |
| `location.label` | string \| null | ≤ 80 chars | Human name ("Hanover, NH") |
| `bearingDeg` | number | 0 … 360 | Compass direction |
| `fovDeg` | number | 30 … 180 | View frame horizontal FOV |
| `playback.rate` | number | −86400 … 86400 | Sky-seconds per wall-second |
| `playback.paused` | boolean |  | True = sky frozen at `utcInstant` |

**Derived invariants** (not stored, validated at load):

- `utcInstant` MUST equal the UTC conversion of
  `(localDate, localTime, timeZone)`. If mismatched, canonicalise
  from the local triple.
- If `timeZone` is not present in the embedded tz table, fall back
  to `Etc/GMT` with `utcOffsetMinutes` explicitly set.

**Defaults** (FR-000 — the canonical first-load observation):

```json
{
  "schemaVersion": 1,
  "utcInstant": "1969-12-13T05:00:00.000Z",
  "localDate": "1969-12-13",
  "localTime": "00:00",
  "timeZone": "America/New_York",
  "utcOffsetMinutes": -300,
  "location": {
    "lat": 43.7044,
    "lon": -72.2887,
    "label": "Moore Hall, Dartmouth College, Hanover, NH"
  },
  "bearingDeg": 0,
  "fovDeg": 90,
  "playback": { "rate": 60, "paused": false }
}
```

### State transitions

Observation is mutated by user input events. Every mutation
re-derives `utcInstant` and emits a `observationChanged` event that
the render loop and the a11y summary listen to.

```
[user input] → validate → update Observation → persist (debounced 500ms)
                                            └→ emit observationChanged
```

## Entity: Star (static, catalogue)

Loaded once from `/data/stars.bin` (YBSC subset, magnitude ≤ 6.5).
Immutable at runtime.

| Field | Type | Units | Notes |
|-|-|-|-|
| `id` | uint16 | — | YBSC HR number |
| `raJ2000` | float32 | radians | Right ascension at J2000.0 |
| `decJ2000` | float32 | radians | Declination at J2000.0 |
| `pmRa` | float32 | mas/yr | Proper motion (RA × cos Dec) |
| `pmDec` | float32 | mas/yr | Proper motion (Dec) |
| `vmag` | float32 | mag | V-band apparent magnitude |
| `bvIndex` | int8 | 0.01 mag units | Colour index ×100 (−40…+200) |

Packed as little-endian binary for fast parse and small payload;
~17 B/star × 9,110 stars ≈ 155 KB uncompressed / ~65 KB gzipped.

## Entity: Constellation (static)

Loaded from `/data/constellations.json`.

| Field | Type | Notes |
|-|-|-|
| `name` | string | IAU abbreviation ("UMa") |
| `fullName` | string | "Ursa Major" |
| `lines` | `Array<[hr1: uint16, hr2: uint16]>` | Star-pair line segments (references Star.id) |

~88 constellations; ~400 line segments total.

## Entity: PlanetaryBody (static config + runtime computed state)

Configuration (what to render, static):

| Field | Type | Notes |
|-|-|-|
| `id` | enum `'sun'|'mercury'|'venus'|'earth'|'moon'|'mars'|'jupiter'|'saturn'|'uranus'|'neptune'` | |
| `displayColor` | CSS colour | |
| `symbol` | string | Unicode astronomical symbol, e.g. ☉ ☽ ♂ |
| `magBase` | number | Reference magnitude for size scaling |

Runtime state (computed per frame from VSOP87/ELP):

| Field | Type | Units |
|-|-|-|
| `raApparent` | number | radians |
| `decApparent` | number | radians |
| `altitudeDeg` | number | degrees above horizon |
| `azimuthDeg` | number | degrees E of N |
| `apparentMag` | number | mag |
| `angularDiameterArcsec` | number | arcsec (for Sun/Moon discs) |
| `phase` | number | 0–1 (for Moon only) |

## Entity: ObserverLocation (alias for `Observation.location`)

Exposed as its own named entity for readability in code. Same
fields as above. Additional *searchable* form backed by the cities
dataset:

- `/data/cities.json` — GeoNames subset, 25k rows:
  `{ name, asciiName, country, lat, lon, population }`
  sorted by descending population for fast prefix-match UX.

## Entity: MapPolygon (static)

The embedded low-poly world map for the map picker.

- `/data/world.svg` — Natural Earth 1:110m `admin_0_countries`
  converted to a single optimised SVG of continent outlines, no
  country boundaries, no labels, ~40 KB gzipped.

## Entity: TzZone (static)

- `/data/tz.json` — coarse lat/lon grid → IANA zone name. Used to
  resolve a map pick into a timezone without any network call.

## Entity: SkyState (computed, volatile)

Produced each animation frame by the render pipeline. Never
persisted.

| Field | Type | Notes |
|-|-|-|
| `utcInstant` | number (ms since epoch) | |
| `siderealTimeRad` | number | GAST for the current instant |
| `visibleStars` | typed array view | Indices into Star table with `altitude > −refractionAllowance` |
| `visibleConstellationLines` | array of `[x1,y1,x2,y2]` | Screen-space after projection |
| `visiblePlanets` | `PlanetaryBody[]` | Runtime state filled in |
| `twilightPhase` | enum `'day'|'civil'|'nautical'|'astronomical'|'night'` | Derived from Sun altitude |
| `skyBackgroundColor` | RGB | Interpolated across twilight phases |

## Validation rules summary (derived from FRs)

- Any dated outside 1900-01-01…2100-12-31 → caveat banner toggled
  ON (FR-007 + Q1 clarification).
- `fovDeg` clamp on every setter (FR-005a).
- `bearingDeg` wraps modulo 360 on every setter.
- `localTime` parsed permissively (`12:00 am` and `00:00` both accepted).
- Invalid `localStorage` payload → reset to default Observation
  (FR-000) without throwing.
