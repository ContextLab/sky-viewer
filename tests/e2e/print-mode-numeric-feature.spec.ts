// 003 — Issue #4: numeric editing of feature dimensions in
// wall-elevation. Verifies that selecting a feature row reveals 4
// numeric inputs (sill, height, width, x) and that editing each one
// updates the feature's outline in the print-job-store.

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

test("Numeric height/width/sill/x inputs in wall elevation drive the outline", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await page.goto("/");
  await page.locator("canvas#sky[data-ready='true']").waitFor({ timeout: 10_000 });

  await page.locator(".print-mode-trigger").click();
  const dialog = page.locator('[role="dialog"][aria-label="Print Mode"]');
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: /Use template.*Rectangle 12.*12 ft/i }).click();
  await page.waitForTimeout(150);

  // Add a window via the new feature-panel button (Issue #2).
  await dialog
    .locator(".print-mode-feature-panel")
    .getByRole("button", { name: "Add window" })
    .click();
  await page.evaluate(() => {
    const seg = document.querySelector(".print-mode-segment-hit[data-segment-index='0']") as SVGElement | null;
    if (!seg) throw new Error("segment 0 not found");
    seg.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(700);

  // Wall elevation panel should be open.
  const elev = dialog.locator(".print-mode-wall-elevation");
  await expect(elev).toBeVisible();

  // The numeric panel is hidden until a feature is selected.
  const numericPanel = elev.locator(".print-mode-feature-numeric");
  // Click the Edit button on the first feature row.
  await elev.locator(".print-mode-feature-edit").first().click();
  await expect(numericPanel).toBeVisible();

  // Read the four input fields' aria-labels for stability.
  const sillInput = numericPanel.locator("input[aria-label='Sill height in millimetres above the floor']");
  const heightInput = numericPanel.locator("input[aria-label='Feature height in millimetres']");
  const widthInput = numericPanel.locator("input[aria-label='Feature width in millimetres']");
  const xInput = numericPanel.locator("input[aria-label*='Horizontal position']");

  await expect(sillInput).toBeVisible();
  await expect(heightInput).toBeVisible();
  await expect(widthInput).toBeVisible();
  await expect(xInput).toBeVisible();

  // Default window from Issue #2: sill=900, height=900, width=600.
  // Edit them.
  await sillInput.fill("750");
  await sillInput.dispatchEvent("change");
  await heightInput.fill("1200");
  await heightInput.dispatchEvent("change");
  await widthInput.fill("800");
  await widthInput.dispatchEvent("change");
  await xInput.fill("500");
  await xInput.dispatchEvent("change");

  await page.waitForTimeout(700); // persistence-debounce

  // Read the feature's outline back from the store.
  const outline = await page.evaluate(() => {
    const raw = window.localStorage.getItem("skyViewer.printJob");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const win = (parsed.room.features as Array<{ type: string; outline: Array<{ uMm: number; vMm: number }> }>).find(
      (f) => f.type === "window",
    );
    return win?.outline ?? null;
  });
  expect(outline).not.toBeNull();
  // Compute bbox.
  const us = outline!.map((p) => p.uMm);
  const vs = outline!.map((p) => p.vMm);
  const uMin = Math.min(...us);
  const uMax = Math.max(...us);
  const vMin = Math.min(...vs);
  const vMax = Math.max(...vs);
  expect(Math.round(uMin)).toBe(500);
  expect(Math.round(uMax - uMin)).toBe(800);
  expect(Math.round(vMin)).toBe(750);
  expect(Math.round(vMax - vMin)).toBe(1200);
});
