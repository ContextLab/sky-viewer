# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Product Vision

Sky-viewer: user enters a date, location (selected on a map), facing direction, and time of day, and receives an animated visualization of the stars visible from that vantage point. No technology stack has been chosen yet — see "Before writing code" below.

## Repository State

Feature `001-sky-viewer-mvp` is in the **planning** phase (spec + plan + research + data-model + contracts written; no source code yet). The tech stack has been chosen in [specs/001-sky-viewer-mvp/plan.md](specs/001-sky-viewer-mvp/plan.md): **TypeScript 5.x → ES2020** built with **esbuild**, tested with **Vitest** (astronomy math) and **Playwright** (cross-browser smoke). No runtime dependencies. State in `localStorage`; offline via service worker. See plan.md before implementing — do not improvise alternative stacks.

## Development Workflow: Spec-Driven Development

All feature work flows through the Spec Kit pipeline. Each stage has a slash command (available as skills) and an auto-commit git hook configured in [.specify/extensions.yml](.specify/extensions.yml):

1. `/speckit.constitution` — define/update project principles in [.specify/memory/constitution.md](.specify/memory/constitution.md) (currently still the placeholder template — populating it is prerequisite to meaningful planning)
2. `/speckit.specify` — creates a feature branch (`NNN-short-name`) and a spec in `specs/NNN-short-name/spec.md` from a natural-language description
3. `/speckit.clarify` — surfaces up to 5 targeted ambiguities and folds answers back into the spec
4. `/speckit.plan` — produces `plan.md`, `research.md`, `data-model.md`, `quickstart.md`, `contracts/` under the feature directory; chooses the tech stack
5. `/speckit.tasks` — generates dependency-ordered `tasks.md`
6. `/speckit.analyze` — non-destructive consistency check across spec/plan/tasks
7. `/speckit.implement` — executes tasks

Each `/speckit.*` command has a `before_*` and `after_*` git hook that auto-commits. `before_constitution` runs `speckit.git.initialize`; `before_specify` runs `speckit.git.feature` to cut the branch.

The `specify` workflow ([.specify/workflows/speckit/workflow.yml](.specify/workflows/speckit/workflow.yml)) chains specify → plan → tasks → implement with manual gate reviews between each.

### Feature directory resolution

Scripts in [.specify/scripts/bash/](.specify/scripts/bash/) (notably `common.sh:get_feature_paths`) resolve the active feature in this order: `$SPECIFY_FEATURE_DIRECTORY` env var → `.specify/feature.json` → prefix match on current git branch (e.g. branch `004-foo` → `specs/004-*`). Expected branch shapes: `NNN-slug` (sequential, 3+ digits) or `YYYYMMDD-HHMMSS-slug` (timestamp). `init-options.json` pins this project to **sequential** numbering.

### Template override stack

`resolve_template()` in `common.sh` searches in priority order: `.specify/templates/overrides/` → installed presets (by `.registry` priority) → `.specify/extensions/*/templates/` → core `.specify/templates/`. Override templates here rather than editing `.specify/templates/` directly.

## Before writing code

- The constitution is still the placeholder — run `/speckit.constitution` first so Constitution Check gates in plans have something to check against.
- Do not skip straight to implementation. Even small features go through `/speckit.specify` first so the branch, spec directory, and auto-commit trail exist.
- The tech stack is determined *in the plan* — `plan-template.md` has `NEEDS CLARIFICATION` slots for Language/Version, Primary Dependencies, Storage, Testing, Target Platform. Pick based on the feature, not on prior assumption.

## Conventions baked into the tooling

- Branch names must match `^[0-9]{3,}-` or `^[0-9]{8}-[0-9]{6}-` (enforced by `check_feature_branch` in `common.sh`). Gitflow-style `feat/NNN-slug` is also accepted — the prefix is stripped before validation.
- User stories in specs are prioritized P1/P2/P3 and must each be **independently testable** (delivering value as a standalone MVP slice) — see [.specify/templates/spec-template.md](.specify/templates/spec-template.md).
- Success criteria in specs must be **measurable and technology-agnostic** (no framework names in SC-NNN lines).

## Active feature (001-sky-viewer-mvp)

- **Canonical default observation** (FR-000, also SC-006 regression fixture): Moore Hall, Dartmouth College, Hanover NH (≈43.7044°N, 72.2887°W), facing north, 1969-12-13 00:00 America/New_York (EST, UTC−05:00). Any change to the astronomy math MUST re-verify star positions against Stellarium for this fixture.
- **Datasets** (all public domain / CC0, bundled same-origin): Yale Bright Star Catalogue 5th revised (mag ≤ 6.5), Stellarium Western `constellationship.fab`, Natural Earth 1:110m admin-0, GeoNames cities15000, coarse tz boundaries.
- **Astronomical models**: VSOP87 (Sun + planets), ELP-2000/82 (Moon), Meeus reductions (precession/nutation/refraction). Target accuracy ≤ 0.1° over 1900–2100.
- **Renderer**: WebGL2 primary with a full Canvas2D fallback (same interface). Feature-detected at startup per Principle IV.
- **Payload budgets** (constitution): JS ≤ 200 KB gzipped; data ~200 KB gzipped separately accounted for in research.md R13.
- **Out-of-range dates** (Q1 clarification): render with a persistent caveat banner, never block, never silently fabricate.
- **Animation semantics** (Q3): time auto-advances at default 60× real-time; user can pause, reverse, scrub, or change rate.
- **FOV** (Q4): default 90°, user-zoomable 30°–180° via pinch / scroll / `+`-`-`.
- **A11y summary** (Q5): screen-reader-only observation line (location/date/time/UTC/facing/FOV) only — no per-object narration in MVP.
