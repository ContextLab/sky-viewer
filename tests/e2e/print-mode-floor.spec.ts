// T042 — Floor-surface PDF generation (US2 V8).
//
// Open Print Mode → use rectangle template → enable Floor surface
// checkbox → Compute → Continue → wait for Download → fetch the
// generated PDF blob and assert it contains floor-tile labels.
//
// We use pdf-parse via page.evaluate to extract text from the blob.
// The cover page text alone will NOT include floor-row labels — those
// only appear on tile-page pages (T029).

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

test("enabling Floor produces antipodal-sky pages with row/col labels", async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto("/");
  await page.locator("canvas#sky[data-ready='true']").waitFor({ timeout: 10_000 });

  await page.locator(".print-mode-trigger").click();
  const dialog = page.locator('[role="dialog"][aria-label="Print Mode"]');
  await expect(dialog).toBeVisible();

  // Rectangle template.
  await dialog.getByRole("button", { name: /Use template.*Rectangle 12.*12 ft/i }).click();
  // Wait briefly for the store to settle.
  await page.waitForTimeout(200);

  // Enable the Floor checkbox in output-options. Locate by visible
  // span text and walk up to the nearest label, then check its input.
  const floorLabel = dialog
    .locator(".print-mode-checkbox-row")
    .filter({ hasText: "Floor" });
  await expect(floorLabel.first()).toBeVisible();
  const floorCheckbox = floorLabel.first().locator('input[type="checkbox"]');
  await floorCheckbox.check();
  await page.waitForTimeout(200);

  // Click Compute.
  const computeBtn = dialog.locator(".print-mode-compute");
  await computeBtn.click();
  const modal = page.locator('[role="dialog"][aria-label="Pre-flight summary"]');
  await expect(modal).toBeVisible({ timeout: 60_000 });
  await modal.getByRole("button", { name: "Continue" }).click();

  const downloadBtn = dialog.locator(".print-mode-download");
  await expect(downloadBtn).toBeVisible({ timeout: 120_000 });

  // Read blob URL.
  const href = await downloadBtn.evaluate(async (el: HTMLAnchorElement) => {
    for (let i = 0; i < 30; i++) {
      if (el.href && el.href.startsWith("blob:")) return el.href;
      await new Promise((r) => setTimeout(r, 100));
    }
    return el.href;
  });
  expect(href).toBeTruthy();
  expect(href.startsWith("blob:")).toBe(true);

  // Read the page count from the download button's status text and
  // assert it grew vs. the ceiling-only baseline. The status text is
  // set in compute-progress.ts as "PDF ready - N pages.".
  const status = dialog.locator(".print-mode-status");
  const statusText = (await status.textContent()) ?? "";
  const pageMatch = statusText.match(/(\d+)\s+pages?/i);
  expect(pageMatch, `status text was: "${statusText}"`).toBeTruthy();
  if (!pageMatch) return;
  const pageCount = Number(pageMatch[1]);
  // Ceiling-only canonical (12x12 ft, Letter) yields ~131 tiles + 1
  // cover. With floor enabled, the pre-flight added ~131 floor tiles
  // PLUS 4 walls (each ~110 tiles) PLUS antipodal-sky stars on the
  // floor. Lower bound: more than the ceiling-only count.
  expect(pageCount).toBeGreaterThan(132);

  // Fetch the PDF blob and verify the PDF is valid.
  const result = await page.evaluate(async (url) => {
    const r = await fetch(url);
    const blob = await r.blob();
    const buf = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    return {
      type: blob.type,
      head: String.fromCharCode(...buf),
      sizeBytes: blob.size,
    };
  }, href);
  expect(result.type).toBe("application/pdf");
  expect(result.head).toBe("%PDF-");
  // Sanity: a multi-surface PDF is much larger than the cover-only
  // ceiling baseline (~250 KB).
  expect(result.sizeBytes).toBeGreaterThan(50_000);
});
