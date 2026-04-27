// 003 — Issues #5 & #6: shift-snap to 90 deg + Cmd/Ctrl multi-vertex
// drag in the room editor.

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

async function readVertices(page: import("@playwright/test").Page): Promise<Array<{ xMm: number; yMm: number }>> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("skyViewer.printJob");
    if (!raw) return [];
    return JSON.parse(raw).room.vertices;
  });
}

test("Shift-drag snaps the segment to a horizontal/vertical axis (Issue #5)", async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto("/");
  await page.locator("canvas#sky[data-ready='true']").waitFor({ timeout: 10_000 });
  await page.locator(".print-mode-trigger").click();
  const dialog = page.locator('[role="dialog"][aria-label="Print Mode"]');
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Use template.*Rectangle 12.*12 ft/i }).click();
  await page.waitForTimeout(150);

  // Initial vertex 1 (NE corner) should be at (+half, -half) = (1828.8, -1828.8).
  const before = await readVertices(page);
  expect(Math.round(before[1]!.xMm)).toBe(1829);
  expect(Math.round(before[1]!.yMm)).toBe(-1829);

  // Shift-drag vertex 1 mostly horizontally + a smaller vertical jitter.
  // The shift-snap should zero out the y-delta (segment between v0 and
  // v1 stays purely horizontal), keeping yMm at -1828.8.
  const handle = dialog.locator("circle.print-mode-vertex-handle[data-vertex-index='1']");
  const start = await handle.evaluate((el: SVGCircleElement) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.keyboard.down("Shift");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Move mostly +x, a small -y jitter (drag toward upper-right).
  await page.mouse.move(start.x + 60, start.y - 12, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await page.waitForTimeout(700);

  const after = await readVertices(page);
  // The y of vertex 1 should equal v0.yMm (snap).
  expect(Math.abs(after[1]!.yMm - after[0]!.yMm)).toBeLessThan(1);
  // x should have grown from 1828.8.
  expect(after[1]!.xMm).toBeGreaterThan(2000);
});

test("Cmd/Ctrl-click multi-select; dragging moves all selected vertices together (Issue #6)", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await page.goto("/");
  await page.locator("canvas#sky[data-ready='true']").waitFor({ timeout: 10_000 });
  await page.locator(".print-mode-trigger").click();
  const dialog = page.locator('[role="dialog"][aria-label="Print Mode"]');
  await dialog.getByRole("button", { name: /Use template.*Rectangle 12.*12 ft/i }).click();
  await page.waitForTimeout(150);

  // Add vertices 0 and 3 (the two left-side corners) to the selection
  // by Cmd/Ctrl-clicking each.
  const v0 = dialog.locator("circle.print-mode-vertex-handle[data-vertex-index='0']");
  const v3 = dialog.locator("circle.print-mode-vertex-handle[data-vertex-index='3']");

  // Click vertex 0 to select it (plain click).
  await v0.click();
  // Cmd/Ctrl-click vertex 3 to add to selection.
  // Use modifier "Meta" on macOS, "Control" elsewhere — both branches in
  // the source handle event.metaKey || event.ctrlKey, so either works.
  await v3.click({ modifiers: ["Meta"] });

  // Visually, both vertices should now have the selected class.
  await expect(v0).toHaveClass(/print-mode-vertex-handle-selected/);
  await expect(v3).toHaveClass(/print-mode-vertex-handle-selected/);

  // Snapshot vertex positions before drag.
  const before = await readVertices(page);
  const v0Before = before[0]!;
  const v3Before = before[3]!;
  const v1Before = before[1]!; // NOT selected — should stay put

  // Drag vertex 0. Both selected vertices should translate by the same delta.
  const start = await v0.evaluate((el: SVGCircleElement) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 40, start.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(700);

  const after = await readVertices(page);
  const dx0 = after[0]!.xMm - v0Before.xMm;
  const dx3 = after[3]!.xMm - v3Before.xMm;
  const dx1 = after[1]!.xMm - v1Before.xMm;

  // v0 and v3 should have moved by the same delta (within 1 mm).
  expect(Math.abs(dx0 - dx3)).toBeLessThan(1);
  // v1 should NOT have moved (it wasn't selected).
  expect(Math.abs(dx1)).toBeLessThan(1);
  // The delta should be negative (we dragged left).
  expect(dx0).toBeLessThan(0);
});
