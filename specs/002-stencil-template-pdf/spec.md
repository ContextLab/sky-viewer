# Feature Specification: Star-Stencil PDF Generator ("Print Mode")

**Feature Branch**: `002-stencil-template-pdf`
**Created**: 2026-04-27
**Status**: Draft
**Input**: User description: "next I'd like to add a special feature: a template for turning a room in a house into a projection of the night sky. the way it works is: press a button to enter print mode, enter the date, time, location, and direction, enter the room dimensions (draw it out using a nice interface; click/drag, editable line segments, etc.) including the ceiling height, lighting, windows, closets, doors, etc. then press 'compute' to generate a PDF of numbered pages: each page contains a 'template' with indicated elements to be cut out (e.g. with a hole pencil, nail, pin, etc.) and taped to the wall so that all pages fully tile the wall surfaces. then the entire thing can be spray painted (or similar) and removed to reveal the stars and planets behind it. also include an initial page with 'template' markers on it, using 4 variations in size: pencil, large nail, small nail, pin that are labled, along with instructions for how to use the template."

## Clarifications

### Session 2026-04-27

- Q: Should empty tile pages be omitted from the PDF to save paper? → A: **No.** Every grid position MUST appear in the PDF as a numbered page even when it contains zero holes. Skipping pages would break the user's ability to verify positioning and dimensions during assembly; blank-but-numbered pages preserve the registration grid.
- Q: Which surfaces can be stenciled? → A: **Per-surface user choice including the floor.** Each surface (ceiling, each wall, and the floor) has an independent on/off toggle. When the floor is enabled, the projection shows the sky **through the Earth** — i.e. the antipodal sky, the constellations currently below the horizon as they would be seen if the planet were transparent.
- Q: Are paper sizes restricted to Letter and A4? → A: **No.** Letter and A4 remain presets, but the user MUST be able to choose any standard size (Letter, Legal, Tabloid, A3, A4, A5) AND enter a custom width × height in either inches or millimetres.
- Q: How should room features (windows, doors, closets, light fixtures) interact with stencilling? → A: **Each feature has a per-feature "paint / no-paint" toggle.** Painted features get stars projected onto them like any other surface region. No-paint features are omitted from the spray zone, but their outlines MUST still appear on every overlapping tile page as **dotted cut lines** so the user trims through them after taping — this both removes the no-paint region and provides a real-world registration anchor (the cut shape matches the actual feature).
- Q: Should the wall horizon (the line where the wall "sees the ground") block out stars below it? → A: **User-configurable.** A single Print Job toggle "Block horizon on walls" controls it. When **on** (default): stars on walls are clipped at the horizon line — below-horizon wall regions are blank (the conventional sky-on-walls behaviour). When **off**: the entire wall, top to bottom, is projected as if the Earth were transparent — above-horizon stars on the upper portion AND antipodal stars on the lower portion, with a smooth seam at the horizon line. Independent of the per-surface "floor" toggle (which controls a different surface).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate a stencil for a child's bedroom ceiling (Priority: P1)

A parent wants to paint the night sky from their child's birth date and birthplace onto the ceiling of the kid's bedroom. They open the app, enter Print Mode, key in the birth date / time / location, sketch the room (a simple 12 × 11 ft rectangle, 8 ft ceiling, one ceiling light fixture), and click **Compute**. The app produces a downloadable PDF: cover page with size legend + instructions, then numbered pages that tile to cover only the ceiling. The parent prints, cuts out the marked holes, tapes the pages up, sprays paint through them, peels them down, and reveals an accurate star-map of that special moment.

**Why this priority**: This is the simplest meaningful slice — one surface (ceiling), rectangular footprint, a single light-fixture feature flagged no-paint. It exercises every core mechanic (date/time/location entry, room dimensions, projection from sky → surface → tiled pages, hole-size encoding, PDF assembly, instructions page) without needing wall or multi-surface complexity. It's also the most popular real-world use case for a "starry ceiling" project.

**Independent Test**: A user with no prior context can: (a) enter Print Mode from the main UI; (b) key in (date, time, location, direction); (c) draw a rectangular room with a ceiling-mounted light fixture; (d) press **Compute**; (e) within ~30 seconds receive a printable PDF whose cover page has the four size markers + instructions, followed by tile pages numbered with their grid position. Spot-checked against a reference star map (Stellarium), the brightest stars on the ceiling-tile pages must appear at the correct positions to within ~½″ at room scale.

**Acceptance Scenarios**:

1. **Given** a successful Print Mode session, **When** the user clicks **Compute**, **Then** the app produces a PDF that downloads (or appears in a print preview) without requiring any external service call.
2. **Given** the generated PDF, **When** the user prints page 1 ("cover"), **Then** they see four hole-size markers labeled **Pencil**, **Large nail**, **Small nail**, **Pin** with example holes punched/drawn at exact diameters, plus a step-by-step instructions block covering: cut, align grid edges, tape, spray, peel.
3. **Given** the generated PDF, **When** the user examines a tile page, **Then** they see a clearly-labeled **page number** (e.g. "Ceiling — row 3, column 5"), unambiguous edge-alignment marks, every hole annotated with a labelled symbol matching one of the four size markers, and any no-paint room features in this tile (e.g. light fixture cutout) shown as a labelled dotted cut line.
4. **Given** the user has marked a ceiling light fixture, **When** the app generates the tile pages, **Then** stars whose holes would fall on or within a small margin (≥ ½″) of the fixture are omitted and the fixture footprint is drawn on the affected pages.

---

### User Story 2 - Cover the whole room (ceiling + walls) (Priority: P2)

A more ambitious user wants the room to feel immersive: they want stars wrapping the walls as well as the ceiling, with the visible portion of the sky for that observation flowing seamlessly across surfaces (so a constellation that crosses the wall-ceiling seam appears unbroken when assembled). They draw the room, identify two windows and a closet door on the walls, choose to include all surfaces, and again receive a printable PDF.

**Why this priority**: Multi-surface projection is the showpiece use case but builds directly on US1's machinery. It adds a real geometric challenge (continuity at the wall-ceiling seam) and a real product challenge (lots of pages — pre-flight summary needs to tell the user how many pages they'll print).

**Independent Test**: From US1, the user can enable additional surfaces (walls, optionally floor) and add wall features (windows, doors, closets — each toggled paint or no-paint). The resulting PDF includes pages tagged for each enabled surface (e.g. "North wall — row 2, col 3", "Ceiling — row 4, col 1"). Stars visible above the horizon at the chosen instant appear distributed across the above-horizon surfaces, with constellation lines (if shown) continuous across surface boundaries. No-paint windows and doors render as dotted cut lines on their respective wall pages.

**Acceptance Scenarios**:

1. **Given** a room with a window on the north wall and the user has selected "all surfaces", **When** Compute runs, **Then** the north-wall pages show the window outlined as a do-not-cover zone and any stars whose holes would fall inside the window are omitted.
2. **Given** a constellation line crosses from the north wall to the ceiling, **When** the user assembles all pages, **Then** the line endpoints meet to within ¼″ at the seam (no visible kink or gap).
3. **Given** the user has chosen "all surfaces", **When** Compute completes, **Then** before downloading, a summary tells them: total page count, paper used (sheets), and approximate paint coverage area, so they can decide whether to proceed.

---

### User Story 3 - Iterate on the room layout without losing the observation (Priority: P3)

A user who's already entered the date/time/location and drawn the room realizes they forgot a recessed light, or the room dimensions are slightly off. They want to edit the room layout (move a wall, add a fixture, drag a window's outline) without re-entering the observation, and re-Compute.

**Why this priority**: This is a refinement-loop affordance. The first two stories deliver the core value; this one makes the tool usable for actual projects. Without it the user has to redo work on every change. Genuinely valuable but not load-bearing for the MVP.

**Independent Test**: Starting from a completed US1 or US2 session, the user can edit the room (drag a wall edge, add a feature, delete a feature, toggle a feature paint/no-paint) and re-press Compute. The new PDF reflects the change exactly; the observation (date/time/location/direction) is unchanged.

**Acceptance Scenarios**:

1. **Given** a user has completed US1, **When** they drag a wall segment from 12 ft to 14 ft and re-Compute, **Then** the new PDF has a different total page count corresponding to the larger ceiling and the star positions are re-projected to fill the new ceiling.
2. **Given** a Print Mode session, **When** the user navigates away to the main map view and back, **Then** their in-progress room sketch is preserved.
3. **Given** the user edits a feature (e.g. window) on the room sketch, **When** they re-Compute, **Then** the corresponding tile pages reflect the new feature footprint and unaffected pages are unchanged (so re-printing only the changed pages is feasible).

---

### Edge Cases

- **Room is irregular** (L-shape, alcove, sloped ceiling, dormer): the sketcher MUST allow non-rectangular footprints by editing arbitrary line segments. Sloped ceilings (out of scope for MVP) MAY be approximated as flat with a caveat.
- **Observer position in room is asymmetric** (off-center bed): the projection must respect this — the user picks an observer point on the floor plan; stars project onto each surface from that point, not from the geometric centre. This affects tile contents.
- **No stars visible above the horizon** (e.g. polar daytime): when only above-horizon surfaces (ceiling/walls) are enabled and zero stars are above the horizon, the app warns but still produces the PDF (with the cover page + blank-but-numbered tiles); when the **floor** is enabled, the antipodal sky always has plenty of stars, so this edge case is naturally avoided.
- **Date+time outside the supported astronomical range** (pre-1900 / post-2100): the app warns with the same caveat banner the main view uses, and proceeds.
- **Tile pages with no holes and no feature cutouts**: NOT omitted. They appear in the PDF as **blank-but-numbered** pages with grid label, alignment marks, and paint-side indicator preserved (FR-014).
- **Holes within ½″ of a tile edge**: tile boundaries MUST split such holes onto both adjacent tiles with matching alignment marks so the user can reconstruct the correct hole when both tiles are taped together.
- **Holes whose centres fall inside a no-paint feature**: omitted (the feature gets cut away after taping).
- **Holes whose centres fall inside a paint feature**: rendered normally — the feature is part of the surface for projection.
- **Holes that cross a feature edge**: split — the portion outside the feature is rendered if the feature is no-paint; the portion inside is rendered if the feature is paint.
- **Very large rooms / many surfaces enabled**: the page count is reported up-front via the pre-flight summary; the user may cancel.
- **Insufficient paper / printer constraints**: out of scope; we provide the PDF, the user prints it.
- **Changing the surface set after drawing features**: when surfaces are toggled off, features placed on them are retained (so toggling back on restores the layout).
- **Floor enabled with observer position not at room centre**: the antipodal projection still uses the user's observer point. Most users will leave the observer at the centre; off-centre is supported but produces an asymmetric floor pattern.
- **Mixed paper sizes**: the user picks one paper size (preset or custom) per job; mixing within a job is not supported.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to enter "Print Mode" from a single, prominent control reachable from the main view in ≤ 1 user action.
- **FR-002**: Print Mode MUST present an Observation editor allowing the user to set date, time-of-day, observer location (lat/lon, optionally via the existing map picker or city search), and facing direction. The observation defaults to whatever observation is currently active in the main view.
- **FR-003**: Print Mode MUST present a Room editor allowing the user to draw the room footprint (an arbitrary closed polygon) by clicking/dragging vertices, drag existing segments to move/resize them, insert new vertices on existing segments, and delete vertices.
- **FR-004**: The Room editor MUST allow the user to set the ceiling height as a single numeric value in the user's preferred unit (feet or metres; user-toggleable).
- **FR-005**: The Room editor MUST allow the user to place rectangular (or polygonal) **room features** on the room's surfaces, of these types: light fixture (ceiling), window (wall), door (wall), closet opening (wall), recessed light (ceiling), other (user-named, on any surface). Each feature has a labelled position and a 2D footprint relative to its surface, AND a **paint / no-paint** toggle. Default per type:
  - **Light fixture, recessed light, closet opening**: no-paint.
  - **Window, door**: no-paint.
  - **Other**: user chooses on creation.
  When set to "paint", the feature behaves identically to surrounding surface (stars project onto it). When set to "no-paint", the feature's footprint is excluded from the spray zone, AND its outline MUST appear on every overlapping tile page as a **dotted cut line** so the user trims it out after taping (the cut serves as a real-world registration anchor confirming the page is in the correct position).
- **FR-006**: The Room editor MUST allow the user to mark an **observer position** as a point on the floor plan, defaulting to the geometric centre of the floor.
- **FR-007**: The Room editor MUST allow the user to **independently toggle each surface** on or off for stencilling. Surfaces are: the ceiling, every wall (one per floor-plan segment, named e.g. "North wall"), and the **floor**. Default: ceiling on, all other surfaces off. When the **floor** is enabled, the projection MUST render the **antipodal sky** — i.e. the constellations currently *below* the observer's horizon, as they would appear if the Earth were transparent and the observer looked downward through the ground.
- **FR-008**: When the user presses **Compute**, the app MUST project the night sky (stars, Moon, planets, optionally constellation lines) from the chosen Observation onto each enabled surface from the chosen observer position, using a projection that preserves the angular accuracy targets the rest of the app respects (≤ 0.1° for stars).
  - **Ceiling**: above-horizon sky.
  - **Walls**: above-horizon sky for the upper portion (between the wall horizon line and the ceiling); the lower portion (between the floor and the wall horizon line) is governed by FR-008a.
  - **Floor**: the **antipodal sky** — stars and bodies whose altitude is *below* the observer's horizon at the chosen instant, projected as if the Earth were transparent (their apparent positions reflected through the observer's nadir onto the floor plane).
- **FR-008a**: The Print Job MUST expose a single boolean **"Block horizon on walls"** (default: ON). When ON, wall regions below the horizon line are blank (no stars). When OFF, those regions are filled with the **antipodal sky** as if the Earth were transparent, providing a continuous floor-to-ceiling projection on every wall with a seamless transition at the horizon line.
- **FR-009**: The PDF MUST begin with a single **cover page** containing: (a) four labelled size markers showing **Pencil**, **Large nail**, **Small nail**, **Pin** holes drawn to exact diameter; (b) a numbered, illustrated step-by-step instruction block; (c) a project summary (date/time/location of the rendered sky, surfaces chosen, total tile pages, total stars, observer position).
- **FR-010**: Each tile page MUST contain: (a) a unique **page label** identifying the surface and grid position (e.g. "Ceiling — row 3, col 5"); (b) **alignment marks** at the corners that match adjacent pages; (c) one **labelled hole** per star or other point object falling within this tile, where the label includes the size class and (when meaningful) the star/planet name; (d) the outlines of any **no-paint** room features intersecting this tile, drawn as **dotted cut lines** with a feature-type label, to be trimmed by the user after taping; (e) a **paint-side indicator** showing which side of the page faces the surface.
- **FR-011**: Holes MUST be encoded by **size class**, with exactly four classes mapping monotonically to apparent magnitude:
  - **Pencil** (largest): brightest stars + Sun (if visible) + bright planets (Venus, Jupiter at opposition).
  - **Large nail**: mag 0–1 stars + Moon outline.
  - **Small nail**: mag 1–3 stars + remaining naked-eye planets.
  - **Pin** (smallest): mag 3–6 stars.
  Exact magnitude cutoffs are documented in *Assumptions*.
- **FR-012**: Holes that fall within ½″ (≈ 13 mm) of a tile edge MUST be split between adjacent tiles, with matching alignment marks so the user can reconstruct the hole correctly when both tiles are taped together.
- **FR-013**: For **no-paint** room features, holes whose centres fall **inside** the feature's footprint MUST be omitted from the print (no spray happens here once the user trims the dotted cut line). Holes within the feature's interior are not represented on adjacent paint surface either. For **paint** features, holes are rendered normally — the feature is treated as part of the surface for projection.
- **FR-014**: **Every** tile in the row × column grid for every enabled surface MUST appear in the PDF as a numbered page, **including blank tiles** that contain zero holes and zero feature cutouts. Blank tiles are critical for assembly: they preserve the registration grid and let the user verify dimensions and positioning. A blank tile still carries its page label, alignment marks, and paint-side indicator.
- **FR-015**: The app MUST report a **pre-flight summary** (total pages, total holes, paper sheets, estimated paint area) before generating the PDF and let the user cancel.
- **FR-016**: The PDF MUST be generated entirely client-side; no user input is transmitted to any server.
- **FR-017**: The PDF MUST be downloadable (or trigger the browser's print dialog) within 30 seconds of pressing Compute on a typical mid-tier laptop, for the canonical "12 × 12 ft, 8 ft ceiling, ceiling-only" case.
- **FR-018**: Page output MUST target a single user-chosen paper size for the entire job. The user picks from the following before Compute:
  - **Standard presets**: Letter (8.5 × 11 in, default in US locales), Legal (8.5 × 14 in), Tabloid / Ledger (11 × 17 in), A3 (297 × 420 mm), A4 (210 × 297 mm, default in metric locales), A5 (148 × 210 mm).
  - **Custom**: arbitrary width × height in inches OR millimetres (user-toggleable units), with sensible bounds (min 4 × 6 in / 100 × 150 mm; max 24 × 36 in / 600 × 900 mm to keep tile counts manageable).
  Mixed paper sizes within a single job are NOT supported.
- **FR-019**: The Room editor's state (footprint, ceiling height, room features with their paint/no-paint flags, observer position including eye height, per-surface enable map, "Block horizon on walls" flag, "Include constellation lines" flag, paper size, units) MUST persist across reloads on the same device.
- **FR-020**: Print Mode MUST be reachable and usable on both desktop and mobile form factors. On mobile, the Room editor MUST support touch (tap to add vertex, drag to move).
- **FR-021**: Each room feature in the cover page summary AND each affected tile page MUST be reachable for an assistive-tech user: an accessible textual list of features (type, surface, position, dimensions, paint/no-paint flag) MUST be provided alongside the visual rendering.

### Key Entities

- **Print Job**: a single user session of Print Mode containing an Observation, a Room, output options (paper size + units + per-surface enable flags), and a generated PDF artifact (or "not yet computed" state).
- **Room**: a closed 2D floor-plan polygon with vertices and segments, plus a numeric ceiling height, an observer position (point in floor plane), a list of room features per surface (each with paint / no-paint flag), and a per-surface enable map covering ceiling, every wall, and the floor.
- **Surface**: a flat planar region of the room — the ceiling, the floor, or one of the wall faces (one per floor segment). Each surface has a 2D bounding rectangle in its own plane, a 3D pose in room space, and an **enabled** flag. The floor's projection samples the **antipodal sky** rather than the above-horizon sky.
- **Room Feature**: a 2D footprint on a Surface representing a real-world object (light fixture, window, door, closet, recessed light, other). Has type, label, polygonal outline in surface-local coordinates, AND a **paint / no-paint** toggle. Paint features behave identically to surrounding surface for star projection. No-paint features are excluded from the spray zone and rendered as **dotted cut lines** on overlapping tile pages.
- **Observer Position**: a single 3D point in room space (typically eye height above the floor) from which the sky is projected onto the surfaces.
- **Tile**: one printable page covering a sub-rectangle of one Surface. Has a row, column, page number, list of star-holes clipped to the tile (possibly empty for a blank tile), list of feature-outline polygons clipped to the tile, and edge-alignment marks. **Every** grid position produces a Tile, including blank ones.
- **Hole**: a single point on a tile encoding a star, planet, Sun, or Moon, with a size class (Pencil / Large nail / Small nail / Pin) and a label. Counterpart of a Celestial Object in the rendered Sky State.
- **Cover Page**: the first PDF page containing labelled size markers and instructions; not associated with a Surface.
- **Output Document**: the assembled multi-page PDF (cover page + tile pages, in the canonical print order: cover → ceiling pages → wall pages, surface by surface → floor pages, row-major within each surface; blank tiles included).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time user can complete the full Print Mode flow (enter Print Mode → set observation → sketch a rectangular room → press Compute → download PDF) in ≤ 5 minutes.
- **SC-002**: For the canonical "12 × 12 ft, 8 ft ceiling, ceiling only" case, the generated PDF downloads in ≤ 30 seconds on a mid-tier laptop.
- **SC-003**: Star-hole positions on the assembled physical stencil match a reference sky-map (e.g. Stellarium) for the same observation to within ½ inch (≈ 13 mm) at room scale, when the user assembles the printed pages with reasonable care.
- **SC-004**: 95 % of users in informal usability tests can correctly cut and assemble at least one tile page following only the cover-page instructions.
- **SC-005**: When **no-paint** room features are present, every overlapping tile page renders the feature's outline as a dotted cut line, and no star hole's centre falls inside the feature footprint — verifiable by automated geometric check.
- **SC-006**: Adjacent tile pages assemble seamlessly: when two adjacent tiles are aligned by their corner alignment marks, holes that were split across the seam reconstitute to within 1/16 inch (≈ 1.5 mm) of their original position.
- **SC-007**: For a constellation that crosses a surface boundary (e.g. wall-to-ceiling), the line endpoints on the two surfaces meet to within ¼ inch (≈ 6 mm) when assembled.
- **SC-008**: The pre-flight summary's total-page count exactly equals the actual generated PDF page count (cover page + every tile in the row × column grid for every enabled surface).
- **SC-009**: The cover page is legible without colour: every instruction, label, and size marker remains identifiable when printed in greyscale on a black-and-white printer.
- **SC-010**: All Print Mode features are usable on a 6″ mobile screen: every interactive control has a tap target ≥ 44 × 44 px and the room sketch can be drawn without zooming.
- **SC-011**: Print Mode introduces no regression to the existing main-view experience: time-to-first-stars, frame rate, and offline-after-first-load remain at their existing levels.
- **SC-012**: When the **floor** surface is enabled, the rendered antipodal sky reflects the constellations currently below the observer's horizon to within the same ≤ 0.1° angular accuracy used elsewhere — verifiable against any reference sky tool by inverting (alt, az) → (−alt, az + 180°).
- **SC-013**: For every enabled surface, the PDF contains a contiguous numbered grid of pages with **no skipped numbers** — verifiable by inspecting the page sequence.
- **SC-014**: The user can choose any of the listed presets OR a custom paper size and the PDF respects it within ±1 mm on each dimension.
- **SC-015**: When **"Block horizon on walls"** is OFF, every wall page below its local horizon line shows antipodal stars to within the same ≤ 0.1° accuracy and the seam at the horizon line shows no gap or duplication greater than ¼ inch (≈ 6 mm) when assembled.

## Assumptions

- **Magnitude → size-class cutoffs**: Pencil = mag ≤ 0 (Sirius, Vega and brighter; Sun and Moon when visible); Large nail = 0 < mag ≤ 1; Small nail = 1 < mag ≤ 3; Pin = 3 < mag ≤ 6. Exact thresholds are tunable but these defaults match a common naked-eye perception scale.
- **Hole diameters** (printed at 1:1 with the cover-page legend): Pencil ≈ 6 mm, Large nail ≈ 4 mm, Small nail ≈ 2.5 mm, Pin ≈ 1 mm. The user calibrates by physically placing each tool through the matching legend hole.
- **Observer eye height** for projection geometry defaults to 5 ft (152 cm) above the floor at the chosen observer position. Eye height is user-overridable in advanced settings.
- **Wall faces** are assumed vertical and rectangular (no slope, no curvature). Sloped ceilings, dormers, and bay windows are out of scope for MVP.
- **Floor is excluded** from stencilling (people walk on it). The user cannot select "floor" as a surface.
- **Constellation lines** are off by default for the stencil PDF (purely the stars+planets+Sun+Moon as holes); the user may opt-in, in which case lines are rendered as faint dashed connectors on the tile pages, NOT as holes.
- **Room dimensions are entered in user units** (feet by default in US locales, metres elsewhere); internal storage is metric, conversion happens at the boundary.
- **No 3D room visualization** in MVP — the editor is strictly a 2D floor plan plus a separate "wall elevation" view per wall for placing windows/doors.
- **Bleed and registration tolerance** of ⅛″ is added around each tile so the user can trim cleanly; pages are designed to be assembled with ⅛″ overlap, not edge-to-edge.
- **Printable margin**: most home printers cannot print to the absolute edge; we lay out the tile so that the printable region of a Letter or A4 page contains the full tile content, with the ⅛″ bleed inside the printable area.
- **No support for adhesive transfer or vinyl plotters** in MVP — output is paper-and-tape.
- **Floor projection convention**: the antipodal sky for the floor is computed by negating the apparent altitude of every body (alt → −alt) while keeping azimuth — equivalent to looking through the Earth from the observer's nadir. The floor tile pattern, when assembled and viewed by someone lying on the floor looking up, shows the sky that would otherwise be visible underneath them.
- **Wall horizon convention**: each wall has a horizon line whose height above the floor equals the observer's eye height (default 5 ft / 152 cm). With "Block horizon on walls" ON, only the region above this line is stenciled. With it OFF, the region below uses the same antipodal projection as the floor.
- **Custom paper-size bounds**: minimum 4 × 6 in / 100 × 150 mm; maximum 24 × 36 in / 600 × 900 mm. Sizes outside this range are rejected with a friendly message.
- **Per-feature paint defaults**: light fixtures, recessed lights, and closet openings default to no-paint. Windows and doors default to no-paint. "Other" prompts the user. All defaults are user-overridable per feature.
- **Blank tiles are first-class**: even tiles with zero holes and no feature cutouts are printed and numbered (FR-014); they are critical for the user's ability to verify dimensions during assembly.
- **Single observer / single instant**: the stencil shows the sky at one specific UTC moment. Animated playback is not represented in print.
- **Spray paint / removal techniques** are the user's responsibility — the cover page recommends, but does not warrant, specific paints, masking tapes, or removal procedures.
