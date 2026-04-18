# Contract: Observation state API (internal module boundary)

**Feature**: 001-sky-viewer-mvp
**Scope**: The TypeScript module that owns the current `Observation`
and is the single source of truth the renderer and UI read from.
This is an *internal* contract — the app has no public HTTP API by
FR-001/FR-016. But having the contract written lets us test the
astronomy math in isolation and keeps the render loop decoupled.

## Module: `observation-store`

### `getObservation(): Observation`

Returns the current observation tuple (see data-model.md).
Synchronous. Never throws.

### `setObservation(next: Partial<Observation>): Observation`

Merges `next` with the current observation, re-derives
`utcInstant` from `(localDate, localTime, timeZone)` if any local
field changed, persists to `localStorage` (debounced 500 ms), emits
`observationChanged`, returns the merged value.

Validation: invalid inputs are *coerced*, not rejected.
`bearingDeg` is reduced mod 360; `fovDeg` is clamped to 30…180;
`playback.rate` is clamped to ±86400.

### `subscribe(listener: (obs: Observation) => void): Unsubscribe`

Registers a listener invoked synchronously after every mutation.
Used by: renderer, a11y summary, input debounce.

### `resetToDefault(): Observation`

Equivalent to `setObservation(DEFAULT_OBSERVATION)` where
`DEFAULT_OBSERVATION` is the Moore Hall / 1969-12-13 tuple (FR-000).

### `isOutsideVerifiedDateRange(obs: Observation): boolean`

Returns true when `obs.utcInstant` is before 1900-01-01 UTC or
after 2100-12-31 UTC. Drives the caveat banner (Q1 clarification).

## Module: `astronomy`

Pure functions. No DOM, no side-effects. Testable with Vitest
against Stellarium-derived reference values.

### `equatorialToHorizontal(ra: rad, dec: rad, lat: rad, lon: rad, utcMs: number): { altDeg: number; azDeg: number }`

Apparent position including refraction for altitudes > −1°.
Must agree with Stellarium to within 0.01° for the canonical
Moore Hall / 1969-12-13 fixture for a curated list of 10
reference stars (Polaris, Vega, Sirius, Betelgeuse, Rigel,
Arcturus, Capella, Aldebaran, Procyon, Altair).

### `greenwichApparentSiderealTime(utcMs: number): rad`

GAST via IAU 2000B reduced polynomial. Accuracy ≤ 0.01″ over
1900–2100.

### `sunPosition(utcMs: number): { ra: rad; dec: rad }`
### `moonPosition(utcMs: number): { ra: rad; dec: rad; phase: 0..1; angularDiameterArcsec: number }`
### `planetPosition(body: 'mercury'|...|'neptune', utcMs: number): { ra: rad; dec: rad; apparentMag: number }`

Arc-minute accuracy over 1900–2100.

### `propagateStar(star: Star, epochMs: number): { ra: rad; dec: rad }`

Applies proper motion from J2000.0 to `epochMs` and returns
apparent position.

### `twilightPhase(sunAltDeg: number): 'day' | 'civil' | 'nautical' | 'astronomical' | 'night'`

Thresholds: day ≥ 0°, civil −6° to 0°, nautical −12° to −6°,
astronomical −18° to −12°, night < −18°.

## Module: `renderer`

### `createRenderer(canvas: HTMLCanvasElement): Renderer`

Feature-detects WebGL2. If present, returns the WebGL2 renderer.
Otherwise returns the Canvas2D fallback. The returned `Renderer`
has identical interface (Principle IV: progressive enhancement).

### `Renderer.render(skyState: SkyState, viewFrame: ViewFrame): void`

Commits one frame. Must return within 8 ms on desktop (for 120 Hz
headroom) and 16 ms on mobile (for 60 Hz headroom) at the
canonical fixture on reference hardware.

### `Renderer.dispose(): void`

Releases GPU resources.

## Module: `a11y-summary`

### `updateSummary(obs: Observation, el: HTMLElement): void`

Writes the FR-018 textual summary into the `aria-live="polite"`
region. Format:

> "Sky for [location.label || formatted lat/lon] on [localDate]
> at [localTime] [timeZone] (UTC[±HH:MM]), facing
> [bearingDeg]° [cardinal], field of view [fovDeg]°."

Debounced 200 ms so rapid input scrubs don't overwhelm screen
readers.

## Contract test checklist

- `equatorialToHorizontal` agrees with Stellarium to 0.01° for 10
  reference stars at the canonical fixture.
- `setObservation` with an invalid `bearingDeg` (370°) stores 10°.
- `resetToDefault` writes exactly the FR-000 tuple to localStorage.
- `isOutsideVerifiedDateRange(default)` is `false`.
- `isOutsideVerifiedDateRange({...default, utcInstant: '1850-01-01Z'})` is `true`.
- `createRenderer(canvas)` on a jsdom canvas (no WebGL) returns
  the Canvas2D fallback without throwing.
- `updateSummary` produces text matching the FR-018 template.
