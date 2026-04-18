# Theming + Polish Pass — 2026-04-17

## Branch
001-sky-viewer-mvp

## Files changed
- `src/styles.css` — full rewrite, 524 → 731 lines (14,850 bytes, under 15 KB budget)
- `src/app/main.ts` — added `top-left`/`top-right` class names; added auto-hide idle timer
- `index.html` — added Google Fonts preconnect + DM Sans / DM Mono link

## Status
All checks pass:
- `npx tsc --noEmit` — 0 errors
- `npx vitest run` — 151/151
- `npx playwright test` (chromium, 5 tests) — 5/5 pass

## Known issue (not fixed — render layer problem)
Constellation lines are drawn after the ground pass, so they overdraw the horizon silhouette near the bottom of the viewport. This is a render ordering issue in `src/render/` and needs a separate fix.
