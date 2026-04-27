// T062 — Out-of-range date edge case (Edge Cases section of spec.md).
//
// With a date set to 1850-01-01 (pre-1900, outside the supported
// astronomical accuracy range), the app must:
//   1. NOT block the user.
//   2. Render the main-view caveat banner.
//   3. Still allow Print Mode to produce a valid PDF (graceful
//      degradation — projections still happen, just with a known
//      caveat).

import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem("skyViewer.printJob");
      window.localStorage.removeItem("skyViewer.observation");
    } catch {
      /* ignore */
    }
  });
});

test("Print Mode produces a valid PDF when the observation date is 1850-01-01", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.locator("canvas#sky[data-ready='true']").waitFor({ timeout: 10_000 });

  // Push an out-of-range date directly into the print-job-store via
  // localStorage. We do this BEFORE opening Print Mode so the overlay
  // hydrates from the stored value.
  await page.evaluate(() => {
    const job = {
      schemaVersion: 1,
      observation: {
        schemaVersion: 1,
        utcInstant: "1850-01-01T05:00:00.000Z",
        localDate: "1850-01-01",
        localTime: "00:00",
        timeZone: "America/New_York",
        utcOffsetMinutes: -300,
        location: {
          lat: 43.7044,
          lon: -72.2887,
          label: "Moore Hall, Dartmouth College, Hanover, NH",
        },
        bearingDeg: 0,
        pitchDeg: 0,
        fovDeg: 90,
        playback: { rate: 60, paused: false },
        layers: {
          constellationLines: true,
          constellationLabels: true,
          planetLabels: true,
          brightStarLabels: false,
        },
      },
      room: {
        vertices: [
          { xMm: -1828.8, yMm: -1828.8 },
          { xMm: 1828.8, yMm: -1828.8 },
          { xMm: 1828.8, yMm: 1828.8 },
          { xMm: -1828.8, yMm: 1828.8 },
        ],
        ceilingHeightMm: 2438,
        observerPositionMm: { xMm: 0, yMm: 0, eyeHeightMm: 1520 },
        features: [],
        surfaceEnable: { ceiling: true, floor: false, walls: {} },
      },
      outputOptions: {
        paper: { kind: "preset", preset: "letter" },
        displayUnits: "imperial",
        blockHorizonOnWalls: true,
        includeConstellationLines: false,
      },
      lastComputedAt: null,
    };
    window.localStorage.setItem("skyViewer.printJob", JSON.stringify(job));
  });

  // Open Print Mode — the overlay reads the persisted job.
  await page.locator(".print-mode-trigger").click();
  const dialog = page.locator('[role="dialog"][aria-label="Print Mode"]');
  await expect(dialog).toBeVisible();

  // Compute. The pre-flight modal must appear; pressing Continue must
  // not throw and must produce a downloadable PDF.
  const computeBtn = dialog.locator(".print-mode-compute");
  await computeBtn.click();
  const modal = page.locator('[role="dialog"][aria-label="Pre-flight summary"]');
  await expect(modal).toBeVisible({ timeout: 60_000 });
  await modal.getByRole("button", { name: "Continue" }).click();

  const downloadBtn = dialog.locator(".print-mode-download");
  await expect(downloadBtn).toBeVisible({ timeout: 90_000 });

  // The blob URL points at a valid PDF.
  const href = await downloadBtn.evaluate(async (el: HTMLAnchorElement) => {
    for (let i = 0; i < 30; i++) {
      if (el.href && el.href.startsWith("blob:")) return el.href;
      await new Promise((r) => setTimeout(r, 100));
    }
    return el.href;
  });
  expect(href).toBeTruthy();
  expect(href.startsWith("blob:")).toBe(true);

  const result = await page.evaluate(async (url) => {
    const r = await fetch(url);
    const blob = await r.blob();
    const buf = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    return { type: blob.type, head: String.fromCharCode(...buf) };
  }, href);
  expect(result.type).toBe("application/pdf");
  expect(result.head).toBe("%PDF-");
});
