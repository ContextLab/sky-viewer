<!--
SYNC IMPACT REPORT
==================
Version change: (template / uninitialized) → 1.0.0
Bump rationale: Initial ratification. No prior numbered version existed; this
  replaces the untouched template with concrete project principles. Per the
  policy in this document, a first real version is 1.0.0 (MAJOR=1 because the
  governance contract is now binding on all future PRs/plans).

Modified principles (template slot → ratified name):
  - [PRINCIPLE_1_NAME]  → I. Universal Performance (NON-NEGOTIABLE)
  - [PRINCIPLE_2_NAME]  → II. User Delight
  - [PRINCIPLE_3_NAME]  → III. Astronomical Accuracy
  - [PRINCIPLE_4_NAME]  → IV. Progressive Enhancement & Accessibility
  - [PRINCIPLE_5_NAME]  → V. Spec-Driven Discipline

Added sections:
  - Additional Constraints (browser support matrix, performance budgets,
    privacy defaults)
  - Development Workflow & Quality Gates (review process, testing gates,
    Constitution Check wiring)

Removed sections: none (all template slots filled)

Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — Constitution Check gate still reads
    "[Gates determined based on constitution file]"; the gate items in this
    constitution (see "Development Workflow & Quality Gates") now populate it.
    No text change required — the template reference resolves dynamically.
  - ✅ .specify/templates/spec-template.md — Success Criteria section already
    requires "measurable and technology-agnostic" outcomes, which matches
    Principle II's measurable-delight requirement.
  - ✅ .specify/templates/tasks-template.md — "Tests are OPTIONAL" clause is
    compatible with Principle V (tests required for accuracy-critical and
    cross-browser code paths, optional elsewhere).
  - ✅ CLAUDE.md — already flags that populating this constitution is a
    prerequisite to planning; no edit needed.
  - ⚠ README.md — one-line pitch does not yet reference the performance /
    delight promises. Optional follow-up, not blocking.

Follow-up TODOs: none. RATIFICATION_DATE is today (first adoption).
-->

# Sky-Viewer Constitution

## Core Principles

### I. Universal Performance (NON-NEGOTIABLE)

Sky-viewer MUST run acceptably on every popular browser (current + previous
major of Chrome, Firefox, Safari, Edge) on every popular OS (Windows, macOS,
Linux, iOS, Android), on both desktop and mobile form factors. "Acceptably"
is defined by the performance budgets in *Additional Constraints*. Features
that cannot meet these budgets MUST be feature-flagged off on the affected
target rather than shipped degraded silently.

**Rationale**: The product is a public-facing visualization. A user on a
mid-range Android phone and a user on a desktop workstation are equally our
audience. Any decision that trades broad reach for per-device polish requires
explicit justification in the plan's Complexity Tracking table.

### II. User Delight

Every user-visible surface MUST be designed to inspire wonder, not merely to
function. This principle is enforced through measurable gates, not taste:

- Time-to-first-stars (from initial load, cold cache, on a throttled 4G /
  mid-tier mobile device) MUST be ≤ 3 seconds.
- Input-to-animation latency (user changes date/location/direction/time → sky
  updates) MUST be ≤ 100 ms at p95.
- Animation MUST sustain ≥ 60 fps on desktop and ≥ 30 fps on mobile during
  normal interaction; dropped-frame spikes > 100 ms MUST be treated as bugs.
- The primary input flow (date, map location, direction, time-of-day →
  visualization) MUST be completable in ≤ 5 user actions from landing.

**Rationale**: "Amazing UI" is a slippery promise; measurable gates make it
enforceable and prevent regression. If a feature cannot be built within these
gates, the feature — not the gates — is what changes.

### III. Astronomical Accuracy

Star positions, constellation rendering, planetary bodies, and any celestial
events depicted MUST be computed from a named, citable astronomical model
(e.g. a published star catalogue + standard ephemeris). Accuracy requirements:

- Star positions MUST be correct to within 0.1° of arc for the given date,
  observer location, and time.
- The tech-stack choice in each feature's plan MUST name the catalogue /
  ephemeris library used and the coordinate transforms applied.
- Visual "fun" embellishments (trails, twinkle, stylization) MUST be layered
  *on top of* accurate positional data, never substituted for it.
- Any known simplification (e.g. ignoring atmospheric refraction, proper
  motion, parallax for nearby stars) MUST be documented in the feature's
  `research.md` with the expected error bound.

**Rationale**: Delight without correctness is a screensaver. Users who can
verify what they see against the real night sky are the ones who will share
the app. Fabricated or ad-hoc star positions are an immediate trust breach.

### IV. Progressive Enhancement & Accessibility

The app MUST degrade gracefully across capability tiers rather than refusing
to run. Concretely:

- A baseline experience (static sky for the given inputs, legible UI) MUST
  work without WebGL/WebGPU, with JavaScript constrained to a widely-supported
  baseline (no features newer than the oldest supported browser version).
- High-fidelity rendering (WebGL/WebGPU, shaders, particle effects) MUST be
  feature-detected at runtime and activated only where supported, never
  required for core functionality.
- The app MUST meet WCAG 2.1 AA for contrast, keyboard navigation, and
  screen-reader labeling of interactive controls. The star visualization MAY
  be exempt from screen-reader parity provided an accessible textual summary
  of the computed sky is reachable from every state.
- Touch and pointer inputs MUST both work for all interactive elements; no
  control may be hover-only.

**Rationale**: Principle I (universal performance) is impossible without
progressive enhancement. Accessibility is bundled here because the same
discipline — don't assume the user's device or abilities — produces both.

### V. Spec-Driven Discipline

All non-trivial feature work MUST flow through the Spec Kit pipeline
(`/speckit.specify` → `/speckit.clarify` → `/speckit.plan` → `/speckit.tasks`
→ `/speckit.implement`) on a feature branch matching the naming scheme
enforced by `.specify/scripts/bash/common.sh`. Specifically:

- No implementation code may land on `main` without a corresponding entry in
  `specs/NNN-slug/` containing at minimum `spec.md`, `plan.md`, and `tasks.md`.
- Each user story in a spec MUST be independently testable and prioritized
  (P1/P2/P3), per the repository's spec template.
- Success criteria (SC-NNN lines) MUST be technology-agnostic and measurable.
- Plans MUST pass the Constitution Check gate (see *Development Workflow*)
  before Phase 0 research and again after Phase 1 design.

**Rationale**: The repository's tooling, git hooks, and branch conventions
are all built around this pipeline. Bypassing it means the auto-commit trail,
gate reviews, and traceability from story to task to commit all break.
"Trivial" is narrowly scoped: typo fixes, dependency bumps, and documentation
edits are exempt; anything that changes user-visible behavior is not.

## Additional Constraints

**Browser & device support matrix**. Tier 1 (MUST work at full fidelity):
latest + previous major of Chrome, Firefox, Safari, Edge on Windows 10+,
macOS 12+, iOS 16+, Android 10+. Tier 2 (MUST work at baseline fidelity per
Principle IV): two versions back of the same browsers. Explicitly out of
scope: IE11, browsers without ES2020 support.

**Performance budgets** (hard gates; a plan that cannot meet these MUST list
the violation in Complexity Tracking and justify it):

- Initial JS payload: ≤ 200 KB gzipped on first load.
- Time-to-first-stars: ≤ 3 s on a throttled 4G connection with mid-tier
  mobile CPU (e.g. Moto G4-equivalent).
- Frame rate: ≥ 60 fps desktop, ≥ 30 fps mobile sustained during animation.
- Input-to-visualization latency: ≤ 100 ms p95.
- Memory footprint: ≤ 150 MB resident on mobile during steady-state
  visualization.

**Privacy defaults**. Location input MUST be handled client-side by default;
no location, date, or time data may be transmitted to a server without an
explicit, feature-specific user action. Any future backend service that
handles user input MUST list the data flow in its plan and include a privacy
note in its spec's Assumptions section.

**Dependency discipline**. Runtime dependencies MUST be justified in the
plan's `research.md` when they exceed 20 KB gzipped. Prefer standard browser
APIs over polyfills; prefer small, focused libraries over frameworks when
the feature does not require framework infrastructure.

## Development Workflow & Quality Gates

**Constitution Check gate** (wired into `.specify/templates/plan-template.md`):
Every plan MUST confirm, before Phase 0 and again after Phase 1, that:

1. The feature's target performance envelope is declared and fits within the
   budgets in *Additional Constraints*, OR a Complexity Tracking entry
   justifies the violation.
2. The feature's UI touchpoints have explicit time-to-first-stars and
   input-to-animation latency estimates (Principle II).
3. If the feature renders celestial bodies, the plan names the astronomical
   model / catalogue used (Principle III).
4. The feature declares its baseline (no-WebGL) behavior (Principle IV).
5. The feature follows the Spec Kit branch and directory conventions
   (Principle V).

**Review requirements**. PRs MUST be reviewed against this constitution.
Reviewers MUST reject PRs that silently violate a principle without a
corresponding Complexity Tracking entry. "Silently" means: the violation is
present in code but not surfaced in the plan.

**Testing gates**. Tests are not uniformly mandatory, but the following
categories MUST have automated tests before merge:

- Astronomical computation: any function that converts (date, location, time)
  → (star position) MUST have unit tests with known reference values.
- Cross-browser rendering: any feature that uses WebGL/WebGPU MUST have at
  least one smoke test confirming the baseline (no-WebGL) fallback renders.
- Performance: any feature expected to be on the critical render path MUST
  have a recorded baseline measurement in its `quickstart.md`.

Other tests (contract, integration, unit) follow the optional-by-default
rule in `.specify/templates/tasks-template.md`.

**Amendments**. Amendments to this constitution require: (a) a PR editing
this file, (b) a Sync Impact Report comment at the top summarizing the
change, (c) a version bump per the policy in *Governance*, and (d) updates
to any dependent templates flagged by the report.

## Governance

This constitution supersedes ad-hoc conventions and prior informal practice.
All feature plans, PRs, and reviews MUST verify compliance. Deviations
from any principle MUST be recorded in the plan's Complexity Tracking
table with a justification and a rejected simpler alternative.

**Versioning policy**. `CONSTITUTION_VERSION` follows semantic versioning:

- MAJOR: backward-incompatible principle removal or redefinition.
- MINOR: new principle or materially expanded guidance added.
- PATCH: wording, typo, or non-semantic clarification.

**Runtime guidance**. [CLAUDE.md](../../CLAUDE.md) provides operational
guidance for agents working in this repo and references this constitution
as the source of truth for principles.

**Version**: 1.0.0 | **Ratified**: 2026-04-17 | **Last Amended**: 2026-04-17
