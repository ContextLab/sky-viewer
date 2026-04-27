// T026 — Open / close Print Mode + state preservation across reopen.
//
// V1 from quickstart.md: visit /, click Print Mode, assert overlay
// opens; press Esc, assert it closes; reopen, assert in-progress state
// (a 12 × 12 ft template room committed via the room editor) survives.

import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Force the print-job-store to start clean for each test so we don't
  // inherit a previous run's room layout.
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem("skyViewer.printJob");
    } catch {
      /* ignore */
    }
  });
});

test("opens Print Mode overlay, closes via Esc, preserves state across reopen", async ({
  page,
}) => {
  await page.goto("/");

  // Wait for the main view to be configured before reaching for the
  // top-bar widgets. data-ready is set by main.ts after renderer setup.
  await page.locator("canvas#sky[data-ready='true']").waitFor({ timeout: 5000 });

  // Trigger button is added to the top-right with class "print-mode-trigger".
  const trigger = page.locator(".print-mode-trigger");
  await expect(trigger).toBeVisible();

  // Click → overlay opens.
  await trigger.click();
  const dialog = page.locator('[role="dialog"][aria-label="Print Mode"]');
  await expect(dialog).toBeVisible();

  // Use the rectangle template button so we have observable in-progress state.
  const templateBtn = dialog.getByRole("button", {
    name: /Use template.*Rectangle 12.*12 ft/i,
  });
  await templateBtn.click();

  // The store debounces persistence by 500 ms; give it enough time to flush.
  await page.waitForTimeout(700);

  // Esc closes the overlay.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Reopen: same trigger button.
  await trigger.click();
  await expect(dialog).toBeVisible();

  // Assert the persisted state survived: localStorage["skyViewer.printJob"]
  // contains the rectangle template's vertex set (a 4-vertex polygon
  // around (±1828.8, ±1828.8) — half of 12 ft in mm).
  const stored = await page.evaluate(() => {
    return window.localStorage.getItem("skyViewer.printJob");
  });
  expect(stored).not.toBeNull();
  const parsed = JSON.parse(stored ?? "null");
  expect(parsed).not.toBeNull();
  expect(parsed.room.vertices).toHaveLength(4);
  // Half of 12 ft in mm = 1828.8.
  const verts = parsed.room.vertices as Array<{ xMm: number; yMm: number }>;
  for (const v of verts) {
    expect(Math.abs(Math.abs(v.xMm) - 1828.8)).toBeLessThan(0.5);
    expect(Math.abs(Math.abs(v.yMm) - 1828.8)).toBeLessThan(0.5);
  }
});
