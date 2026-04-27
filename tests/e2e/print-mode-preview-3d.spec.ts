// 3D preview tab e2e — verifies the tab is reachable, the SVG draws
// the room wireframe + per-tile borders + at least one star hole, that
// drag rotation mutates the scene, and that "Reset view" returns it to
// the known initial state.

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

test("3D preview tab — wireframe + tiles + holes + drag + reset", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await page.goto("/");
  await page.locator("canvas#sky[data-ready='true']").waitFor({ timeout: 10_000 });

  // Open Print Mode and apply the rectangle template.
  await page.locator(".print-mode-trigger").click();
  const dialog = page.locator('[role="dialog"][aria-label="Print Mode"]');
  await expect(dialog).toBeVisible();

  await dialog
    .getByRole("button", { name: /Use template.*Rectangle 12.*12 ft/i })
    .click();

  // Switch to the 3D preview tab.
  const previewTab = dialog.getByRole("tab", { name: "3D preview" });
  await previewTab.click();
  await expect(previewTab).toHaveAttribute("aria-selected", "true");

  const svg = dialog.locator(".print-mode-preview-3d-svg");
  await expect(svg).toBeVisible();

  // Even before computing stars, the wireframe should already show
  // (room is drawn from the print-job geometry — no datasets needed).
  const roomLines = dialog.locator(".print-mode-preview-3d-room line");
  await expect.poll(async () => roomLines.count()).toBeGreaterThan(0);

  // Click "Refresh stars" to compute the per-surface tiles + holes.
  const refreshBtn = dialog.locator(".print-mode-preview-3d-refresh");
  await refreshBtn.click();

  // Wait until tile borders + holes appear (datasets load + compute).
  const tileLines = dialog.locator(".print-mode-preview-3d-tiles line");
  const holeCircles = dialog.locator(".print-mode-preview-3d-hole");
  await expect
    .poll(async () => tileLines.count(), { timeout: 60_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => holeCircles.count(), { timeout: 60_000 })
    .toBeGreaterThan(0);

  // Snapshot the stroke positions before dragging.
  async function readLineX1s(): Promise<string[]> {
    return await roomLines.evaluateAll((els) =>
      (els as SVGLineElement[]).slice(0, 8).map((el) => el.getAttribute("x1") ?? ""),
    );
  }
  const beforeDrag = await readLineX1s();

  // Drag the SVG (mouse-down → move → up). The pointermove rotates the
  // camera, which re-projects every line — so x1 attributes must change
  // for at least one line.
  const box = await svg.boundingBox();
  if (!box) throw new Error("SVG has no bounding box");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy + 40, { steps: 4 });
  await page.mouse.up();

  const afterDrag = await readLineX1s();
  expect(afterDrag.join("|")).not.toBe(beforeDrag.join("|"));

  // Click "Reset view" — the camera should return to the initial
  // orientation, so the line positions should match the pre-drag set.
  await dialog.locator(".print-mode-preview-3d-reset").click();
  const afterReset = await readLineX1s();
  expect(afterReset.join("|")).toBe(beforeDrag.join("|"));
});
