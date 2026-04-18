// Manual visual verification screenshot — produces a PNG for the author to
// eyeball. Not asserted automatically; deleted once the UI is stable.
import { test } from "@playwright/test";

test("visual: default observation screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.locator("canvas#sky[data-ready='true']").waitFor();
  await page.waitForTimeout(2500); // let a few seconds of playback animate
  await page.screenshot({ path: "test-results/visual-default.png", fullPage: true });
});

test("visual: mobile portrait screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("canvas#sky[data-ready='true']").waitFor();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "test-results/visual-mobile.png", fullPage: true });
});
