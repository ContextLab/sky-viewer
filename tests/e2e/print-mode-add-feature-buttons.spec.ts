// 003 — Issue #2: explicit "Add Window / Add Door / Add Closet" buttons
// in the feature panel arm a place-on-next-wall-click mode in the room
// editor.

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

test("Add window arms place mode; clicking a wall drops a no-paint window on it", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await page.goto("/");
  await page.locator("canvas#sky[data-ready='true']").waitFor({ timeout: 10_000 });

  await page.locator(".print-mode-trigger").click();
  const dialog = page.locator('[role="dialog"][aria-label="Print Mode"]');
  await expect(dialog).toBeVisible();

  // Apply rectangle template so we know wall geometry.
  await dialog.getByRole("button", { name: /Use template.*Rectangle 12.*12 ft/i }).click();
  await page.waitForTimeout(150);

  // The new "Add window" button is in the feature panel.
  const addWindowBtn = dialog.locator(".print-mode-feature-panel").getByRole("button", { name: "Add window" });
  await expect(addWindowBtn).toBeVisible();
  await addWindowBtn.click();

  // Status hint must appear.
  const placeStatus = dialog.locator(".print-mode-place-status");
  await expect(placeStatus).toBeVisible();
  await expect(placeStatus).toHaveText(/Click a wall to place the window\./i);

  // The button shows aria-pressed=true while armed.
  await expect(addWindowBtn).toHaveAttribute("aria-pressed", "true");

  // Click wall-0 (the south wall - first segment in the rectangle template).
  // The segment-hit lines have a transparent stroke (so they're not
  // visible to Playwright but they ARE clickable). Dispatch the click
  // directly so we don't fight the visibility check.
  await page.evaluate(() => {
    const seg = document.querySelector(".print-mode-segment-hit[data-segment-index='0']") as SVGElement | null;
    if (!seg) throw new Error("wall-0 segment hit not found");
    seg.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });

  // The pending state should clear.
  await expect(placeStatus).toBeHidden();
  await expect(addWindowBtn).toHaveAttribute("aria-pressed", "false");

  // Poll for the window to appear in localStorage (up to 5 s) — under
  // parallel test load the 500 ms persistence-debounce can be longer.
  await page.waitForFunction(() => {
    const raw = window.localStorage.getItem("skyViewer.printJob");
    if (!raw) return false;
    try {
      const job = JSON.parse(raw);
      return (job?.room?.features ?? []).some(
        (f: { type: string; surfaceId: string; paint: boolean }) =>
          f.type === "window" && f.surfaceId === "wall-0" && f.paint === false,
      );
    } catch {
      return false;
    }
  }, { timeout: 5_000 });

  // The store must now contain a window feature on wall-0 with paint=false.
  const featuresJson = await page.evaluate(() => {
    const raw = window.localStorage.getItem("skyViewer.printJob");
    return raw ?? "";
  });
  expect(featuresJson).toBeTruthy();
  const parsed = JSON.parse(featuresJson);
  const wins = (parsed.room.features as Array<{ type: string; surfaceId: string; paint: boolean }>).filter(
    (f) => f.type === "window" && f.surfaceId === "wall-0",
  );
  expect(wins.length).toBeGreaterThanOrEqual(1);
  expect(wins[0]?.paint).toBe(false);

  // Wall-0 should be enabled now (so the projection accounts for it).
  expect(parsed.room.surfaceEnable.walls["wall-0"]).toBe(true);

  // The wall elevation panel should also be open showing the new feature.
  const elevationPanel = dialog.locator(".print-mode-wall-elevation");
  await expect(elevationPanel).toBeVisible();
});

test("Add door arms place mode; clicking a wall drops a door", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.locator("canvas#sky[data-ready='true']").waitFor({ timeout: 10_000 });
  await page.locator(".print-mode-trigger").click();
  const dialog = page.locator('[role="dialog"][aria-label="Print Mode"]');
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Use template.*Rectangle 12.*12 ft/i }).click();
  await page.waitForTimeout(150);

  await dialog.locator(".print-mode-feature-panel").getByRole("button", { name: "Add door" }).click();
  // Wait for the pending-feature status to be visible (confirming the
  // event listener is attached and the click was processed) before
  // clicking the wall. Under parallel load, racing past this checkpoint
  // can cause the segment click to fire while pendingFeatureType is
  // still null in the room editor.
  await expect(dialog.locator(".print-mode-place-status")).toBeVisible();
  await page.evaluate(() => {
    const seg = document.querySelector(".print-mode-segment-hit[data-segment-index='1']") as SVGElement | null;
    if (!seg) throw new Error("wall-1 segment hit not found");
    seg.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  // Poll for the door to appear in localStorage (up to 5 s) — the
  // 500 ms persistence-debounce can be longer under parallel load.
  await page.waitForFunction(() => {
    const raw = window.localStorage.getItem("skyViewer.printJob");
    if (!raw) return false;
    try {
      const job = JSON.parse(raw);
      return (job?.room?.features ?? []).some(
        (f: { type: string; surfaceId: string }) => f.type === "door" && f.surfaceId === "wall-1",
      );
    } catch {
      return false;
    }
  }, { timeout: 5_000 });
  const featuresJson = await page.evaluate(() => window.localStorage.getItem("skyViewer.printJob") ?? "");
  const parsed = JSON.parse(featuresJson);
  const doors = (parsed.room.features as Array<{ type: string; surfaceId: string }>).filter(
    (f) => f.type === "door" && f.surfaceId === "wall-1",
  );
  expect(doors.length).toBeGreaterThanOrEqual(1);
});
