// 003 — Issue #1 regression: non-rectangular room + wall enabled +
// no-paint window. Exercises the path users have reported failing in the
// wild (canonical-rectangle e2e doesn't cover this).
//
// Steps:
//   1. Open Print Mode, apply rectangle template.
//   2. Insert two extra vertices via localStorage to make an L-shape
//      (5 vertices total — quickest reliable way; double-click insertion
//      is fiddly across viewport scales).
//   3. Enable a wall (wall-0) via localStorage.
//   4. Add a window feature on wall-0 by clicking that segment then
//      drag-placing.
//   5. Compute → confirm preflight → wait for either a download button
//      OR an explicit error toast. Either is acceptable; a *silent*
//      no-download path is the failure mode we're guarding against.
//
// If the build fails, the new error path (Issue #1) ensures the user
// sees `Compute failed: …` so they can report it.

import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem("skyViewer.printJob");
    } catch {
      /* ignore */
    }
  });
});

test("L-shaped room with enabled wall + no-paint window: Compute succeeds OR surfaces a clear error", async ({
  page,
}) => {
  test.setTimeout(180_000);

  await page.goto("/");
  await page.locator("canvas#sky[data-ready='true']").waitFor({ timeout: 10_000 });

  // Open Print Mode.
  await page.locator(".print-mode-trigger").click();
  const dialog = page.locator('[role="dialog"][aria-label="Print Mode"]');
  await expect(dialog).toBeVisible();

  // Apply rectangle template (so we have a known starting polygon).
  await dialog.getByRole("button", { name: /Use template.*Rectangle 12.*12 ft/i }).click();
  await page.waitForTimeout(150);

  // Mutate the print-job in localStorage to install an L-shape (6
  // vertices), enable wall-0, and place a no-paint window on wall-0.
  // Then dispatch a `storage` event so the in-memory store reloads.
  await page.evaluate(() => {
    const raw = window.localStorage.getItem("skyViewer.printJob");
    if (!raw) return;
    const job = JSON.parse(raw);
    const half = 1828.8; // 6 ft in mm
    // L-shape footprint (CCW). Cut a notch out of the NE corner.
    job.room.vertices = [
      { xMm: -half, yMm: -half },
      { xMm: half, yMm: -half },
      { xMm: half, yMm: 0 },
      { xMm: 0, yMm: 0 },
      { xMm: 0, yMm: half },
      { xMm: -half, yMm: half },
    ];
    // Enable wall-0 (the south wall, vertices 0->1).
    job.room.surfaceEnable.walls = { ...(job.room.surfaceEnable.walls ?? {}), "wall-0": true };
    // Add a no-paint window on wall-0. Wall length = 2*half = 3657.6 mm,
    // ceiling 2438 mm (default). Place a 600x900 mm window centred at
    // sill 900 mm.
    const wallLen = 2 * half;
    const sillMm = 900;
    const winW = 600;
    const winH = 900;
    const uMin = (wallLen - winW) / 2;
    const uMax = uMin + winW;
    const vMin = sillMm;
    const vMax = sillMm + winH;
    job.room.features = [
      ...(job.room.features ?? []),
      {
        id: "test-window-1",
        type: "window",
        label: "Window 1",
        surfaceId: "wall-0",
        outline: [
          { uMm: uMin, vMm: vMin },
          { uMm: uMax, vMm: vMin },
          { uMm: uMax, vMm: vMax },
          { uMm: uMin, vMm: vMax },
        ],
        paint: false,
      },
    ];
    window.localStorage.setItem("skyViewer.printJob", JSON.stringify(job));
    window.dispatchEvent(new StorageEvent("storage", { key: "skyViewer.printJob" }));
  });
  // Close + reopen the panel so the editor re-reads from store.
  await dialog.getByRole("button", { name: "Close Print Mode" }).click();
  await expect(dialog).toBeHidden();
  await page.locator(".print-mode-trigger").click();
  await expect(dialog).toBeVisible();

  // Compute.
  const computeBtn = dialog.locator(".print-mode-compute");
  await computeBtn.click();

  const modal = page.locator('[role="dialog"][aria-label="Pre-flight summary"]');
  await expect(modal).toBeVisible({ timeout: 60_000 });
  await modal.getByRole("button", { name: "Continue" }).click();

  // Either the download anchor appears (success) or the status shows
  // a clearly-prefixed failure message (Issue #1 surfacing).
  const downloadBtn = dialog.locator(".print-mode-download");
  const status = dialog.locator(".print-mode-status");

  const start = Date.now();
  let outcome: "download" | "error" | null = null;
  while (Date.now() - start < 120_000) {
    if (await downloadBtn.isVisible()) {
      outcome = "download";
      break;
    }
    const text = (await status.textContent()) ?? "";
    if (/Compute failed/i.test(text)) {
      outcome = "error";
      break;
    }
    await page.waitForTimeout(250);
  }

  expect(outcome).not.toBeNull();
  if (outcome === "download") {
    const href = await downloadBtn.evaluate(async (el: HTMLAnchorElement) => {
      for (let i = 0; i < 30; i++) {
        if (el.href && el.href.startsWith("blob:")) return el.href;
        await new Promise((r) => setTimeout(r, 100));
      }
      return el.href;
    });
    expect(href.startsWith("blob:")).toBe(true);
    const result = await page.evaluate(async (url) => {
      const r = await fetch(url);
      const blob = await r.blob();
      const buf = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
      return { type: blob.type, head: String.fromCharCode(...buf) };
    }, href);
    expect(result.type).toBe("application/pdf");
    expect(result.head).toBe("%PDF-");
  } else {
    // The error toast must be human-readable (Issue #1 acceptance).
    const text = (await status.textContent()) ?? "";
    expect(text).toMatch(/Compute failed:/);
    // It should NOT be just the generic "Compute failed." — Issue #1
    // requires the error message to include real detail.
    expect(text.length).toBeGreaterThan("Compute failed:".length + 4);
  }
});
