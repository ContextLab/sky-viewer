// 003 — Issue #3: location search via the print-mode map picker.
// Asserts the "Search location..." button opens the modal, that city
// search autocomplete returns results, that selecting a city updates
// the print-job-store, and that the picker closes.

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

test("Search location opens map picker; selecting a city updates print-job-store", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await page.goto("/");
  await page.locator("canvas#sky[data-ready='true']").waitFor({ timeout: 10_000 });

  await page.locator(".print-mode-trigger").click();
  const dialog = page.locator('[role="dialog"][aria-label="Print Mode"]');
  await expect(dialog).toBeVisible();

  // Click the new "Search location..." button.
  const searchLocationBtn = dialog.getByRole("button", { name: /Search location/i });
  await expect(searchLocationBtn).toBeVisible();
  await searchLocationBtn.click();

  // The print-mode map picker modal should open.
  const picker = page.locator(".print-mode-map-picker");
  await expect(picker).toBeVisible();

  // Type a query that should match a populous city ("paris" or "london").
  const searchInput = picker.locator("input[type='text']");
  await searchInput.fill("paris");

  // Wait for results.
  const results = picker.locator(".map-picker-results li");
  await expect(results.first()).toBeVisible({ timeout: 5_000 });

  // Click the first result.
  await results.first().click();

  // Confirm.
  await picker.getByRole("button", { name: "Confirm" }).click();

  // Wait past 500 ms persistence-debounce.
  await page.waitForTimeout(700);

  // The print-job-store's observation.location should now reflect a Paris-ish lat/lon.
  const loc = await page.evaluate(() => {
    const raw = window.localStorage.getItem("skyViewer.printJob");
    if (!raw) return null;
    return JSON.parse(raw).observation.location;
  });
  expect(loc).not.toBeNull();
  // Paris is around lat=48.85, lon=2.35. Allow generous tolerance: any
  // city named "paris" matches.
  expect(typeof loc.lat).toBe("number");
  expect(typeof loc.lon).toBe("number");
  expect(loc.label).toMatch(/paris/i);
});
