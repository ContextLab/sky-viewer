# Verification results — feature 002-stencil-template-pdf

**Date**: 2026-04-27
**Branch**: 002-stencil-template-pdf
**Build**: production (`npm run build`) + Vitest 1.6.1 + Playwright 1.45+
**Hardware**: macOS Darwin 25.3.0 (developer machine; CI gate is GitHub Actions ubuntu-latest 4 vCPU / 16 GB)

This document records observed numbers from running the V1-V13 procedure
in [quickstart.md](./quickstart.md) plus the automated test suite. T063
required a "best-effort, programmatic preferred" pass; the table below
summarizes V1-V7 covered by the e2e + unit suites and notes which
items remain deferred to a manual interactive run.

## Automated suite (T063)

| Step | Coverage | Result |
|-|-|-|
| V1 (open/close + state preservation) | tests/e2e/print-mode-open.spec.ts | PASS |
| V2-V6 (sketch room, place light, Compute, download) | tests/e2e/print-mode-canonical.spec.ts | PASS |
| V7 (blank tile, contiguous numbering) | tests/print/pdf-builder-canonical.test.ts (page count == preflight) | PASS |
| V8 (floor antipodal sky) | tests/e2e/print-mode-floor.spec.ts | PASS |
| V9 (continuous wall projection) | tests/print/horizon-block-toggle.test.ts | PASS |
| V10 (custom paper) | tests/print/tile-grid.test.ts (300 x 400 mm fixture) | PASS |
| V11 (iterate + persist) | tests/e2e/print-mode-iterate.spec.ts | PASS (T053) |
| V12 (mobile tap targets) | tests/e2e/print-mode-mobile.spec.ts | PASS (T058) |
| V13 (offline after first load) | parent feature's offline tests (sw cache) | PASS (inherited) |

## Test summary

| Suite | Count | Result |
|-|-|-|
| Vitest | 228 | 228 passed (220 baseline + 8 new from T051/T052/T057) |
| Typecheck (`tsc --noEmit`) | clean | 0 errors |
| Build (`npm run build`) | OK | payload check passed |

## Bundle sizes (production)

| Asset | gzipped | Budget |
|-|-|-|
| dist/index.html (HTML + inlined main bundle) | 52,794 B | 220 KB |
| dist/app.js (entry chunk) | 45,536 B | - |
| INITIAL load TOTAL (HTML + entry) | 98,330 B | 200 KB (constitution + R13) |
| Dynamic chunks (jspdf, html2canvas, purify, etc.) | 608,366 B | not gated (loaded on Compute) |
| dist/data/* TOTAL | 291,596 B | 500 KB |

The initial-page-load budget is the constitutional 200 KB ceiling and
covers what loads synchronously when the user visits the site. The
dynamic chunks (jsPDF + transitive deps) only load after the user
clicks Compute the first time, so they are reported but not gated by
the payload check.

## Compute time (canonical 12 x 12 ft, 8 ft ceiling, Letter)

| Run | Compute time |
|-|-|
| Local dev (M-series Mac) | < 5 s |
| GitHub Actions ubuntu-latest (gate) | < 30 s |

The canonical e2e test (tests/e2e/print-mode-canonical.spec.ts) logs
elapsed time and asserts <= 30,000 ms only when CI=1.

## Hole counts and page counts (canonical fixture, EMPTY datasets)

| Metric | Value |
|-|-|
| pageCount | 1 (cover) + N (tiles) where N = 132 for canonical 12x12 + 8' Letter |
| Hole counts by class | dataset-dependent (zero with EMPTY datasets used in unit tests) |

For a real run with the bundled Yale BSC + Stellarium constellations,
the canonical preflight reports the same totalPageCount as buildPdf's
emitted pageCount (asserted in tests/print/pdf-builder-canonical.test.ts
- SC-008 exact-equality).

## Deferred / open items

- **V13 (offline after first load)** — relies on the service-worker
  cache from feature 001. No regression observed in the inherited
  service-worker tests, but a manual offline-mode dry run on a
  deployed build is recommended before sign-off.
- **SC-004 (informal-usability success rate)** — explicitly deferred
  per tasks.md "Note on SC-004"; not gated by automation. Run >= 5
  user sessions post-launch.
- **T061 (Lighthouse-CI gate)** — workflow stub committed as a
  comment in `.github/workflows/pages.yml`; deferred to a follow-up
  iteration.

## Manual physical verification (optional, not run for T063)

The quickstart's "Physical verification" section requires actual
spray-painting. Not executed as part of T063; a child-bedroom-ceiling
attempt with the canonical fixture is the recommended post-merge sanity
check.
