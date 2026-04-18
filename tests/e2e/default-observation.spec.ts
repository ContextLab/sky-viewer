// T032 — E2E: default observation renders within 3 s and a11y summary matches spec.
import { test, expect } from "@playwright/test";

test("default observation renders within 3 seconds", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(err.message);
  });

  const start = Date.now();
  await page.goto("/");

  // Canvas signals it's configured with data-ready="true" per main.ts.
  await expect(page.locator("canvas#sky[data-ready='true']")).toBeVisible({ timeout: 3000 });
  const elapsed = Date.now() - start;
  expect(elapsed).toBeLessThan(3500); // +500ms headroom over SC-001's 3s target

  // A11y summary contains the default observation (Moore Hall, 1969-12-13, …).
  const summary = page.locator("#a11y-summary");
  await expect(summary).toContainText("Moore Hall");
  await expect(summary).toContainText("1969-12-13");
  await expect(summary).toContainText("00:00");

  // No uncaught errors or console errors.
  expect(consoleErrors, `console errors: ${consoleErrors.join("\n")}`).toEqual([]);
});

test("renderer is webgl2 or canvas2d", async ({ page }) => {
  await page.goto("/");
  await page.locator("canvas#sky[data-ready='true']").waitFor();
  const kind = await page.locator("canvas#sky").getAttribute("data-kind");
  expect(kind === "webgl2" || kind === "canvas2d").toBe(true);
});

test("canvas has rendered pixels (not entirely black)", async ({ page }) => {
  await page.goto("/");
  await page.locator("canvas#sky[data-ready='true']").waitFor();
  // Wait a second for data to load + several frames to commit.
  await page.waitForTimeout(1500);

  // Screenshot the canvas region: this captures what the user sees, which
  // is the ultimate ground truth — independent of WebGL framebuffer state.
  const canvasLocator = page.locator("canvas#sky");
  const buf = await canvasLocator.screenshot();
  expect(buf.byteLength).toBeGreaterThan(500); // any real image is > 500 bytes

  // Decode screenshot colour stats via the browser to avoid needing a
  // Node-side PNG decoder.
  const { avgR, avgG, avgB, nonBlack } = await page.evaluate(async (b64) => {
    const img = new Image();
    const loaded = new Promise<void>((r) => { img.onload = () => r(); });
    img.src = "data:image/png;base64," + b64;
    await loaded;
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    let r = 0, g = 0, bSum = 0, nb = 0;
    const px = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      const rp = d[i] ?? 0, gp = d[i + 1] ?? 0, bp = d[i + 2] ?? 0;
      r += rp; g += gp; bSum += bp;
      if (rp + gp + bp > 30) nb++;
    }
    return { avgR: r / px, avgG: g / px, avgB: bSum / px, nonBlack: nb };
  }, buf.toString("base64"));

  // Default observation is deep night at Hanover on 1969-12-13 midnight,
  // so the expected background is very dark but NOT pitch black. Stars
  // above horizon should register as non-black pixels.
  // Combined criterion: either some non-black pixels (stars/planets) OR
  // a noticeably non-zero background colour.
  const bgSignal = avgR + avgG + avgB;
  expect(
    nonBlack > 50 || bgSignal > 3,
    `too black: avgRGB=(${avgR.toFixed(2)}, ${avgG.toFixed(2)}, ${avgB.toFixed(2)}), nonBlack=${nonBlack}`,
  ).toBe(true);
});
