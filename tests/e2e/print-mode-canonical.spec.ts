// T027 — V2..V6 canonical Print Mode flow.
//
// Open Print Mode → Use template (Rectangle 12×12 ft) → Add Light
// fixture → Compute → confirm pre-flight modal → Continue → wait for
// Download anchor → assert href is a Blob URL pointing at an
// application/pdf payload.
//
// FR-017 / SC-002 says ≤ 30 s on the canonical hardware. Local hardware
// varies; we log the elapsed time but only fail if CI is the runner.

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

test(
  "canonical V2..V6 — sketch room, place light, Compute, download PDF",
  async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto("/");
    await page.locator("canvas#sky[data-ready='true']").waitFor({ timeout: 10_000 });

    // V1 — open Print Mode.
    await page.locator(".print-mode-trigger").click();
    const dialog = page.locator('[role="dialog"][aria-label="Print Mode"]');
    await expect(dialog).toBeVisible();

    // V2 — apply rectangle template.
    await dialog
      .getByRole("button", { name: /Use template.*Rectangle 12.*12 ft/i })
      .click();

    // V3 — add a light fixture.
    await dialog
      .getByRole("button", { name: /Add feature.*Light fixture/i })
      .click();
    // The features list should now show one row.
    const featureList = dialog.locator(".print-mode-feature-list");
    await expect(featureList.locator(".print-mode-feature-row")).toHaveCount(1);

    // V4 — Compute.
    const computeBtn = dialog.locator(".print-mode-compute");
    const startMs = Date.now();
    await computeBtn.click();

    // Pre-flight modal appears.
    const modal = page.locator('[role="dialog"][aria-label="Pre-flight summary"]');
    await expect(modal).toBeVisible({ timeout: 30_000 });

    // Continue → builds PDF.
    await modal.getByRole("button", { name: "Continue" }).click();

    // Wait for download button to appear (PDF ready).
    const downloadBtn = dialog.locator(".print-mode-download");
    await expect(downloadBtn).toBeVisible({ timeout: 90_000 });

    const elapsedMs = Date.now() - startMs;
    // Log elapsed for visibility regardless of platform.
    // eslint-disable-next-line no-console
    console.log(`Compute time: ${elapsedMs} ms`);

    // FR-017 / SC-002: ≤ 30 s on the canonical mid-tier laptop. CI gates
    // this; locally we log only — slow developer machines should not
    // block the test suite.
    if (process.env.CI) {
      expect(elapsedMs).toBeLessThanOrEqual(30_000);
    }

    // The download anchor should have a blob: URL pointing at a PDF blob.
    // Read the .href DOM property (always reflects the actual URL) rather
    // than getAttribute("href"). Wait for it to be non-empty — if two
    // tests share a chromium webServer process, state from a prior test
    // can briefly clobber the href via the print-job-store's `refresh`
    // callback, so we poll until it stabilises.
    const href = await downloadBtn.evaluate(async (el: HTMLAnchorElement) => {
      for (let i = 0; i < 30; i++) {
        if (el.href && el.href.startsWith("blob:")) return el.href;
        await new Promise((r) => setTimeout(r, 100));
      }
      return el.href;
    });
    expect(href).toBeTruthy();
    expect(href.startsWith("blob:")).toBe(true);

    // Verify the blob is an application/pdf payload by re-fetching it
    // from the page and reading the first 5 bytes (%PDF-).
    const result = await page.evaluate(async (url) => {
      const r = await fetch(url);
      const blob = await r.blob();
      const buf = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
      return { type: blob.type, head: String.fromCharCode(...buf) };
    }, href);
    expect(result.type).toBe("application/pdf");
    expect(result.head).toBe("%PDF-");
  },
);
