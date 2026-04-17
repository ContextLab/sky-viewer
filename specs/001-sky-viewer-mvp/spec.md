# Feature Specification: Sky-Viewer MVP

**Feature Branch**: `001-sky-viewer-mvp`
**Created**: 2026-04-17
**Status**: Draft
**Input**: User description: "build the app! what we want: Enter a date, location (select on a map), direction, and time of day, and get back a fun animated visualization of the stars! should work as a single standalone HTML page with all code embedded. download from public, free datasets. don't require any API keys or setup. host as a github pages site. support mobile + desktop, any browser. make it awesome!"

## Clarifications

### Session 2026-04-17

- Q: When the user enters a date outside the dataset's verified range (roughly 1900–2100), how should the app respond? → A: Accept the input and render, but show a persistent, visible caveat banner indicating the result is outside the verified range and accuracy is degraded.
- Q: What is the app's default observation on first load (before the user has set anything)? → A: Location: Moore Hall, Dartmouth College, Hanover, NH, USA (approximately 43.7044°N, 72.2887°W). Facing direction: due north (bearing 0°). Date/time: 1969-12-13 00:00 America/New_York (UTC−5:00, i.e. EST, as DST had ended). This is also the canonical regression fixture for star-position accuracy (SC-006).
- Q: What does "animated" mean for the sky visualization? → A: Time auto-advances by default at a user-controllable rate (including pause, and the ability to scrub backward), in addition to ambient visual effects (twinkle, subtle drift, smooth input transitions). Default playback rate is a noticeable but not dizzying multiple of real time (the plan decides the exact number); the user can freeze the instant, speed it up, slow it down, or reverse it.
- Q: What field of view (FOV) does the user see, and is it user-controllable? → A: Default to a realistic ~90° horizontal FOV (approximating "looking up and around"), with user-controllable zoom from ~30° (binocular-like) out to 180° (full-dome hemispheric). Facing direction is therefore visually meaningful at the default FOV (rotating north→east changes what's in frame). Zoom is reachable via pinch on touch devices and scroll/+- keys on desktop.
- Q: How deep is the accessible textual summary for assistive-technology users? → A: Static minimal for MVP — a screen-reader-only heading stating the current observation (location, date, local time, UTC offset, facing direction, FOV). It updates when the user changes inputs, but does NOT continuously list visible stars/planets or narrate playback. Rationale: keeps MVP scope tight while still satisfying WCAG 2.1 AA for the UI surrounding the visualization (FR-014); a richer per-object accessible listing is deferred to a post-MVP release.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the sky for a moment in time (Priority: P1)

A curious visitor opens the site, picks a date and a time of day, and
immediately sees an animated, visually captivating rendering of the sky —
stars, constellations, brighter planets — as it would appear at that moment.
No sign-up, no configuration, no waiting on slow loading.

**Why this priority**: This is the product's core promise. If a user can do
only this one thing, the app is already meaningfully useful and shareable.
Everything else (map, direction, refinement) builds on top.

**Independent Test**: Load the published page on a fresh browser with no
cached assets. Within 3 seconds of first interaction, a believable,
animated sky renders for any chosen date + time. Verifiable by visual
comparison to a known reference sky map (e.g. Stellarium) for the same
inputs at the app's default location.

**Acceptance Scenarios**:

1. **Given** the user has just opened the page (no prior configuration
   saved), **When** the page finishes loading, **Then** an animated sky
   visualization appears immediately for the default observation —
   Moore Hall, Dartmouth College, Hanover NH (≈43.7044°N, 72.2887°W),
   facing due north, at midnight local time on 1969-12-13 (EST,
   UTC−5:00) — without the user needing to touch any control.
2. **Given** the user has rendered one sky, **When** they change the date
   or time, **Then** the visualization updates to the new sky within a
   fraction of a second and without a visible reload.
3. **Given** the user is on a modern mobile browser, **When** they load
   the page, **Then** the visualization is legible, touch-navigable, and
   runs smoothly at a fluid frame rate.
4. **Given** the user opens the page offline after a prior successful
   visit, **When** they change inputs, **Then** the visualization still
   renders (the page and its data are self-contained after first load).
5. **Given** the default (or any chosen) observation has rendered,
   **When** the user watches without interacting, **Then** time
   auto-advances and the sky visibly moves (stars rise/set, the Moon
   and planets drift) at a user-controllable playback rate, and the
   user can pause, reverse, or resume playback at any time.

---

### User Story 2 - Choose where on Earth you're standing (Priority: P2)

The user wants to see the sky from a specific place — their hometown, a
camping site, somewhere they're planning to travel. They open a map,
pick a spot, and the sky redraws from that observer's perspective.

**Why this priority**: The app is meaningfully useful with only a default
or auto-detected location (P1), but location selection is what turns it
from "cool demo" into "tool people revisit." It lifts the experience
dramatically without being required for the first render.

**Independent Test**: From a successfully rendered default sky, the user
opens a map, pins a new location on a different continent, and the sky
visibly changes to reflect that latitude and longitude — verifiable by
comparison to a reference sky map for the same place/time.

**Acceptance Scenarios**:

1. **Given** a rendered sky at the default location, **When** the user
   opens the location picker and selects a point on the map, **Then** the
   sky re-renders for the new coordinates within the same input-to-update
   latency budget as date/time changes.
2. **Given** the map is open, **When** the user searches for a named
   place OR drops a pin OR uses the device's geolocation, **Then** any of
   those three inputs sets the observer location.
3. **Given** the user has selected a location, **When** they close the
   map and later reopen it, **Then** the previously chosen location is
   still pinned and labeled.

---

### User Story 3 - Orient yourself by direction and time of day (Priority: P3)

The user wants to see the sky as they would actually see it standing
outside, facing a particular direction, at a particular time of day —
not just the full dome. The visualization reflects their facing direction
(N, S, E, W or any bearing) and the horizon/twilight conditions for the
chosen time.

**Why this priority**: Direction and accurate time-of-day framing
transform the app from an overhead sky map into a realistic "what will I
see tonight if I look that way?" tool. Valuable, but only after P1 (sky
exists) and P2 (I care about *my* location).

**Independent Test**: From a rendered sky at a chosen date + location,
the user rotates the facing direction from N to E to S to W and sees the
visible portion of the sky rotate accordingly. Separately, changing the
time of day from noon → dusk → night → dawn shows the corresponding
brightness / twilight transitions.

**Acceptance Scenarios**:

1. **Given** a rendered sky, **When** the user changes the facing
   direction via a compass control, **Then** the view rotates smoothly to
   show the slice of sky in front of them with the horizon at the bottom.
2. **Given** a rendered sky, **When** the user sets the time of day to
   noon, **Then** the sky shows daylight conditions (sun, few/no stars
   visible).
3. **Given** a rendered sky, **When** the user sets the time of day to
   night, **Then** the sky shows stars, the Moon (if up), and bright
   planets (if up) with astronomical accuracy.
4. **Given** the user is at twilight, **When** they watch the animation,
   **Then** a time-progression animation transitions smoothly through
   twilight colors without jarring cuts.

---

### Edge Cases

- **Extreme latitudes**: user selects a polar location where the sun
  stays up (or down) for the entire chosen date → sky still renders
  correctly; no divide-by-zero on elevation/azimuth computations.
- **International date line / time zone ambiguity**: user's chosen date
  and time-of-day must resolve to a single unambiguous UTC moment; the
  app MUST display the time zone or UTC offset it used.
- **Unsupported browser**: user opens the page in a browser that lacks
  WebGL/WebGPU → the app MUST still render a baseline legible sky (per
  the project's Progressive Enhancement principle) rather than a blank
  page or error screen.
- **Very old device / slow CPU**: time-to-first-stars MUST still meet
  the budget via a baseline-fidelity render; high-fidelity effects are
  skipped rather than stalling the page.
- **Offline after first load**: subsequent visits MUST work without
  network access (the page and its astronomical data are self-contained).
- **Date far in the past or future**: inputs outside the dataset's
  verified range (roughly 1900–2100) MUST still render a best-effort
  result and MUST display a persistent, visible caveat banner indicating
  the result is outside the verified range and accuracy is degraded.
  The app MUST NOT silently render wrong positions without the banner.
- **Rapid input changes** (user drags a time slider): updates MUST
  coalesce so the animation stays smooth instead of queueing a render
  per frame.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-000**: On first load (with no saved user inputs), the app MUST
  render the default observation — Moore Hall, Dartmouth College,
  Hanover NH, USA (≈43.7044°N, 72.2887°W), facing due north (bearing
  0°), at midnight local time on 1969-12-13 (America/New_York, EST,
  UTC−5:00) — without requiring any user interaction. This default
  also serves as the canonical regression fixture for SC-006.
- **FR-001**: The site MUST be delivered as a single HTML page with all
  application code and astronomical data embedded or co-located such that
  no external API, key, or server-side component is required at runtime.
- **FR-002**: The site MUST be hostable on a static file host (GitHub
  Pages is the target) with no build-time secrets or server config.
- **FR-003**: Users MUST be able to set the observation date (calendar
  day) and time of day.
- **FR-004**: Users MUST be able to set the observer location either by
  (a) picking a point on a map, (b) searching for a named place, or
  (c) using the device's geolocation with explicit consent.
- **FR-005**: Users MUST be able to set the facing direction (compass
  bearing) for the view.
- **FR-005a**: The default field of view MUST be ~90° horizontal. Users
  MUST be able to zoom the view between ~30° (binocular-like) and 180°
  (full-dome hemispheric), via pinch on touch devices and scroll /
  `+`-`-` keys on desktop. The current FOV MUST be visible to the user
  (e.g. a small numeric readout or a visual scale indicator).
- **FR-006**: The app MUST render a visually engaging, animated
  visualization of the sky for the given (date, time, location, direction)
  inputs. "Animated" means: (a) time auto-advances from the chosen
  instant at a user-controllable playback rate by default, with the
  user able to pause, resume, speed up, slow down, and scrub backward;
  and (b) ambient visual effects (twinkle, subtle drift, smooth
  transitions when inputs change) are present regardless of whether
  playback is running.
- **FR-006a**: A playback control MUST be visible and reachable in
  ≤1 user action, exposing at minimum: pause/play, speed adjustment
  (including reverse), and a way to return to the currently-selected
  instant (the "reset to now-as-entered" affordance).
- **FR-007**: Star positions and the positions of the Sun, Moon, and the
  naked-eye-visible planets MUST be computed from a public, free,
  citable astronomical dataset and standard ephemeris — never
  approximated by hand-tuned values. (Compliance with the Astronomical
  Accuracy principle.)
- **FR-008**: The observable star set MUST include all stars down to at
  least magnitude 6 (naked-eye visibility under dark skies) for the
  chosen observer location and time.
- **FR-009**: Constellation figures MUST be drawn as recognizable
  line-figures using a standard constellation line convention.
- **FR-010**: The app MUST indicate the UTC moment it is rendering
  (including the time zone or offset it assumed for the user's local
  time input) so the user can verify their inputs resolved as expected.
- **FR-011**: The app MUST work on current + previous major versions of
  Chrome, Firefox, Safari, and Edge, on Windows, macOS, Linux, iOS, and
  Android, on both desktop and mobile form factors.
- **FR-012**: The app MUST provide a baseline visualization that
  functions without WebGL/WebGPU, so that users on constrained devices
  still get a useful rendering. (Progressive Enhancement principle.)
- **FR-013**: The app MUST remain functional when reopened offline after
  at least one successful online visit.
- **FR-014**: The app MUST meet WCAG 2.1 AA for the UI surrounding the
  visualization (controls, labels, contrast, keyboard operability).
- **FR-015**: User inputs (date, time, location, direction) MUST persist
  across reloads on the same device so a returning user sees their last
  configuration by default.
- **FR-016**: The app MUST NOT transmit the user's location, date, or
  time inputs to any server. All computation happens on the client.
- **FR-017**: When the user changes any input, the visualization MUST
  update at p95 latency of 100 ms or better, and rapid input changes
  MUST coalesce rather than queue a backlog of renders.
- **FR-018**: The app MUST expose a screen-reader-only textual summary
  of the current observation, stating location (human-readable name
  where available), date, local time, UTC offset, facing direction
  (compass bearing), and field of view. This summary MUST update
  whenever the user changes any input. It MUST NOT attempt to
  continuously narrate playback or list every visible star/planet —
  per-object accessible listing is explicitly deferred beyond MVP.

### Key Entities

- **Observation**: a tuple of (date, time-of-day, observer location,
  facing direction) that uniquely determines what sky is rendered.
  Time-of-day and date resolve to a single UTC instant using the
  observer's inferred or chosen time zone.
- **Observer Location**: a point on Earth's surface described by
  latitude and longitude, optionally labeled with a human-readable name
  (e.g. "Hanover, NH").
- **Celestial Object**: a star, planet, the Sun, the Moon, or a
  constellation line-figure that may be visible from the Observation
  point. Each has an apparent position (altitude, azimuth) at the
  Observation's UTC instant and an apparent brightness (magnitude).
- **View Frame**: the slice of the sky currently being rendered,
  determined by the observer's facing direction and a user-controllable
  field of view. Default FOV is ~90° horizontal (approximating a
  realistic human "looking up and around" view). Zoom range is ~30°
  (binocular-like close-up) to 180° (full-dome hemispheric). Pinch on
  touch devices and scroll / `+`-`-` keys on desktop change the FOV.
- **Sky State**: the ordered, filtered set of Celestial Objects visible
  in the current View Frame for the current Observation, with
  visibility determined by altitude > 0 and apparent magnitude within
  the renderable range.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time visitor on a mid-range mobile device with a
  throttled 4G connection sees an animated sky within 3 seconds of the
  page loading.
- **SC-002**: Changing the date, time, location, or direction results in
  a visibly updated sky within 100 ms at p95.
- **SC-003**: On desktop, the animation sustains 60 frames per second
  during normal interaction; on mobile, at least 30 frames per second.
- **SC-004**: On browsers without WebGL/WebGPU support, the page still
  renders a legible baseline sky rather than failing or showing a blank
  screen.
- **SC-005**: The primary input flow (set date, set time, set location,
  set direction, see sky) takes no more than 5 user actions from a cold
  landing page.
- **SC-006**: Star positions rendered by the app match a reference
  astronomical tool (e.g. Stellarium) to within 0.1° for any tested
  (date, time, location) tuple within the supported date range. The
  default observation (Moore Hall, 1969-12-13 00:00 EST, facing north)
  is the canonical regression fixture and MUST be continuously verified.
- **SC-007**: The entire site is delivered from a single static hosting
  origin with no runtime API calls to any external service.
- **SC-008**: 90% of first-time users, in informal usability tests, are
  able to set a custom location and see the corresponding sky within 60
  seconds of opening the page.
- **SC-009**: The site scores at least 90 on Lighthouse Accessibility
  and at least 90 on Lighthouse Performance on a mid-range mobile
  profile.
- **SC-010**: After one successful online visit, the page continues to
  render correctly when reloaded offline.

## Assumptions

- The embedded star catalogue covers at least magnitude 6 and includes
  proper-motion data adequate for the supported date range (e.g. the
  Hipparcos or Yale Bright Star Catalogue, both public-domain /
  freely-redistributable).
- Planetary, solar, and lunar positions come from a public ephemeris
  library or pre-computed tables distributed under a permissive licence,
  bundled with the page.
- Supported date range for astronomically accurate rendering is roughly
  1900–2100; dates outside this range may render with a visible caveat
  or be blocked with a clear message.
- The user's device clock and time zone are trustworthy enough to
  interpret "time of day" into a UTC instant; users can override the
  time zone explicitly if needed.
- The GitHub Pages deployment is the primary distribution channel; no
  custom domain or backend is required for MVP.
- No user account, login, saved-observation cloud sync, or social
  feature is in scope for MVP. Input persistence is local to the device
  (browser storage) only.
- Accessibility for the star field itself is intentionally minimal in
  MVP: the screen-reader summary (FR-018) announces the current
  observation, not the list of visible objects. A richer accessible
  catalogue of currently-visible stars and planets is a post-MVP
  enhancement.
- "Direction" means compass bearing (0°–360°); tilt/altitude of view is
  out of scope for MVP and assumed to be a fixed or user-scrolled
  vertical pan around the horizon.
- Constellation line-figures use a single standard set (e.g. the IAU
  constellation boundaries with a common line-figure convention);
  alternative cultural sky traditions are out of scope for MVP.
- Initial embedded dataset size is acceptable up to the JS-payload
  budget in the project constitution (200 KB gzipped for code; data
  payload is additional and MUST be explained in the plan's research).
