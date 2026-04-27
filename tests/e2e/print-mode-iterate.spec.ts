// T053 — V11 from quickstart.md: iterate the room and re-Compute.
//
// Flow:
//   1. Open Print Mode, apply rectangle template, place a light fixture,
//      Compute → record page count A.
//   2. Drag a vertex to extend the room (move the SE corner outward).
//   3. Re-Compute → record page count B.
//   4. Assert B > A (larger room ⇒ more tile pages).
//   5. Close Print Mode (the close button must NOT reset the job).
//   6. Reopen Print Mode → assert the room state is preserved
//      (vertices match the larger size).

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

async function readPageCountFromStatus(
  status: import("@playwright/test").Locator,
): Promise<number> {
  // The status text is set synchronously alongside making the download
  // button visible, but a follow-up store-debounce flush can call
  // refresh() which clears the status. Poll a few times for non-empty
  // matching text to handle the race.
  for (let i = 0; i < 30; i++) {
    const text = (await status.textContent()) ?? "";
    const match = text.match(/(\d+)\s+pages?/i);
    if (match) return Number(match[1]);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `Could not parse page count from status after polling: "${(await status.textContent()) ?? ""}"`,
  );
}

async function runComputeAndDownload(
  dialog: import("@playwright/test").Locator,
  page: import("@playwright/test").Page,
): Promise<number> {
  const computeBtn = dialog.locator(".print-mode-compute");
  await computeBtn.click();
  const modal = page.locator('[role="dialog"][aria-label="Pre-flight summary"]');
  await expect(modal).toBeVisible({ timeout: 60_000 });
  // Capture page count from the modal's "Total pages" row before pressing
  // Continue — this is more robust than scraping the status text after
  // the Compute completes (the status can be cleared by subsequent
  // refresh calls).
  const totalPagesRow = modal.locator("dt").filter({ hasText: /Total pages/i });
  await expect(totalPagesRow.first()).toBeVisible();
  // The corresponding <dd> immediately follows in the dl flow.
  const totalPagesValue = await modal.evaluate((modalEl) => {
    const dts = modalEl.querySelectorAll("dt");
    for (const dt of Array.from(dts)) {
      if (/Total pages/i.test(dt.textContent ?? "")) {
        const dd = dt.nextElementSibling as HTMLElement | null;
        return dd?.textContent ?? "";
      }
    }
    return "";
  });
  const m = totalPagesValue.match(/(\d[\d,]*)/);
  await modal.getByRole("button", { name: "Continue" }).click();
  const downloadBtn = dialog.locator(".print-mode-download");
  await expect(downloadBtn).toBeVisible({ timeout: 120_000 });
  if (m) {
    return Number(m[1]?.replace(/,/g, "") ?? "0");
  }
  // Fallback to status-text scrape if the modal's row didn't parse.
  const status = dialog.locator(".print-mode-status");
  return await readPageCountFromStatus(status);
}

test("iterate room → re-Compute → page count grows; state survives close+reopen", async ({
  page,
}) => {
  test.setTimeout(240_000);

  await page.goto("/");
  await page.locator("canvas#sky[data-ready='true']").waitFor({ timeout: 10_000 });

  // Open Print Mode.
  await page.locator(".print-mode-trigger").click();
  const dialog = page.locator('[role="dialog"][aria-label="Print Mode"]');
  await expect(dialog).toBeVisible();

  // Apply rectangle template.
  await dialog.getByRole("button", { name: /Use template.*Rectangle 12.*12 ft/i }).click();
  await page.waitForTimeout(200);

  // First Compute → record page count A.
  const pageCountA = await runComputeAndDownload(dialog, page);
  expect(pageCountA).toBeGreaterThan(10);

  // Drag the SE vertex outward to enlarge the room.
  // The vertex handles are circle.print-mode-vertex-handle. We pick the
  // one whose dataset.vertexIndex is "1" (the second vertex; in the
  // rectangle template that's (+half, -half) which is in the +x,−y
  // quadrant after the SVG y-flip → upper-right of the SVG).
  const vertex = dialog.locator("circle.print-mode-vertex-handle[data-vertex-index='1']");
  await expect(vertex).toBeVisible();
  // Read its current cx, cy in client-space.
  const start = await vertex.evaluate((el: SVGCircleElement) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  // Move it 60 px further to the right (positive x) and slightly up.
  // 60 px in the floor-plan SVG (~360 px wide for 12 ft) is roughly 2 ft
  // of additional length on the eastward side — should grow the page
  // count perceptibly.
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 60, start.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // Verify the store actually updated to a larger room (xMm vertex).
  const enlargedXMm = await page.evaluate(() => {
    const raw = window.localStorage.getItem("skyViewer.printJob");
    if (!raw) return 0;
    try {
      const parsed = JSON.parse(raw);
      const vs = parsed?.room?.vertices ?? [];
      // Look for the maximum |xMm| — the SE corner's xMm should now
      // exceed the original 1828.8 mm.
      let maxAbs = 0;
      for (const v of vs) {
        if (typeof v?.xMm === "number") maxAbs = Math.max(maxAbs, Math.abs(v.xMm));
      }
      return maxAbs;
    } catch {
      return 0;
    }
  });
  expect(enlargedXMm).toBeGreaterThan(1828.8);

  // Re-Compute → record page count B.
  const pageCountB = await runComputeAndDownload(dialog, page);

  // B > A: a larger room produces more tile pages.
  expect(pageCountB).toBeGreaterThan(pageCountA);

  // Close Print Mode — must NOT reset the job.
  await dialog.getByRole("button", { name: "Close Print Mode" }).click();
  await expect(dialog).toBeHidden();

  // Reopen.
  await page.locator(".print-mode-trigger").click();
  await expect(dialog).toBeVisible();

  // Assert the persisted state still has the enlarged room.
  const persistedXMm = await page.evaluate(() => {
    const raw = window.localStorage.getItem("skyViewer.printJob");
    if (!raw) return 0;
    try {
      const parsed = JSON.parse(raw);
      const vs = parsed?.room?.vertices ?? [];
      let maxAbs = 0;
      for (const v of vs) {
        if (typeof v?.xMm === "number") maxAbs = Math.max(maxAbs, Math.abs(v.xMm));
      }
      return maxAbs;
    } catch {
      return 0;
    }
  });
  expect(persistedXMm).toBeGreaterThan(1828.8);
  // And it should match what we saw before close (no reset on close).
  expect(Math.abs(persistedXMm - enlargedXMm)).toBeLessThan(1);
});
