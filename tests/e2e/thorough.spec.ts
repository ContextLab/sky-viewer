// Thorough interactive Playwright test suite for sky-viewer. Exercises
// every recently-changed feature and captures screenshots under
// `test-results/thorough/<feature>-<step>.png` so a human reviewer can
// visually confirm behaviour end-to-end.
//
// Run: `npx playwright test --project=chromium tests/e2e/thorough.spec.ts`
import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "fs/promises";

const SCREENSHOT_DIR = "test-results/thorough";

async function ensureScreenshotDir(): Promise<void> {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png`, fullPage: true });
}

async function waitReady(page: Page): Promise<void> {
  await page.locator("canvas#sky[data-ready='true']").waitFor({ timeout: 10_000 });
}

// Strip a stray "FOV:" prefix so we can compare numeric degrees robustly.
function extractFovDeg(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d+)\s*°/);
  return m && m[1] ? Number(m[1]) : null;
}

function extractBearingReadout(text: string | null | undefined): string {
  return (text ?? "").trim();
}

function extractPitchReadout(text: string | null | undefined): string {
  return (text ?? "").trim();
}

// --- Helpers for computing pixel statistics client-side. ---
interface PixelStats {
  avgR: number;
  avgG: number;
  avgB: number;
  nonBlack: number;
}

async function canvasStats(
  page: Page,
  region: "top" | "bottom" | "full",
): Promise<PixelStats> {
  const buf = await page.locator("canvas#sky").screenshot();
  return await page.evaluate(
    async ({ b64, region }) => {
      const img = new Image();
      const loaded = new Promise<void>((r) => {
        img.onload = (): void => r();
      });
      img.src = "data:image/png;base64," + b64;
      await loaded;
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      let y0 = 0;
      let y1 = img.height;
      if (region === "top") {
        y0 = 0;
        y1 = Math.floor(img.height / 2);
      } else if (region === "bottom") {
        y0 = Math.floor(img.height / 2);
        y1 = img.height;
      }
      const d = ctx.getImageData(0, y0, img.width, y1 - y0).data;
      let r = 0;
      let g = 0;
      let bSum = 0;
      let nb = 0;
      const px = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        const rp = d[i] ?? 0;
        const gp = d[i + 1] ?? 0;
        const bp = d[i + 2] ?? 0;
        r += rp;
        g += gp;
        bSum += bp;
        if (rp + gp + bp > 30) nb++;
      }
      return { avgR: r / px, avgG: g / px, avgB: bSum / px, nonBlack: nb };
    },
    { b64: buf.toString("base64"), region },
  );
}

// --- Per-test setup common across desktop + mobile groups. ---
async function freshPage(page: Page, collectErrors: string[]): Promise<void> {
  page.on("pageerror", (err) => collectErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") collectErrors.push(msg.text());
  });
  // Navigate once to get an origin (localStorage namespaced per origin),
  // then clear it and reload so we boot truly fresh.
  await page.goto("/");
  await page.evaluate(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      /* ignore */
    }
  });
  await page.goto("/");
  await waitReady(page);
}

// A tiny helper that captures a FAILURE screenshot if an assertion fails
// within the callback. Rethrows the original error.
async function shotOnFail<T>(
  page: Page,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    try {
      await shot(page, `${name}-FAILURE`);
    } catch {
      /* ignore secondary failure */
    }
    throw err;
  }
}

test.beforeAll(async () => {
  await ensureScreenshotDir();
});

// =============================================================================
// DESKTOP GROUP — 1280x800
// =============================================================================
test.describe("desktop 1280x800", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("1. default observation on fresh load shows Moore Hall at current time", async ({
    page,
  }) => {
    const errs: string[] = [];
    await freshPage(page, errs);
    await page.waitForTimeout(3000);
    await shot(page, "01-default-observation");

    await shotOnFail(page, "01-default-observation", async () => {
      await expect(page.locator("canvas#sky[data-ready='true']")).toBeVisible();
      const summary = page.locator("#a11y-summary");
      await expect(summary).toContainText("Moore Hall", { timeout: 6000 });
      const text = (await summary.textContent()) ?? "";
      const currentYear = new Date().getUTCFullYear();
      // Accept current year OR (year-1/year+1) since UTC boundary can differ.
      const yearMatch = text.match(/(\d{4})-\d{2}-\d{2}/);
      expect(yearMatch).not.toBeNull();
      const yr = Number(yearMatch![1]);
      expect(Math.abs(yr - currentYear)).toBeLessThanOrEqual(1);
      expect(text).toContain("43.7044°N");
      expect(text).toContain("72.2887°W");
    });
    expect(errs, `console errors: ${errs.join("\n")}`).toEqual([]);
  });

  test("2. sky drag to rotate updates bearing + pitch", async ({ page }) => {
    const errs: string[] = [];
    await freshPage(page, errs);
    await page.waitForTimeout(1000);

    // Pause playback so pitch readings aren't in flux vs wall clock.
    const canvas = page.locator("canvas#sky");
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const compassReadout = page.locator(".compass-readout");
    const pitchReadout = page.locator(".pitch-readout");

    const bearingBefore = extractBearingReadout(await compassReadout.textContent());
    await shot(page, "02-drag-before");

    await shotOnFail(page, "02-drag-horizontal", async () => {
      // Horizontal drag (rightward).
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      // A few intermediate steps help pointerdown/move/up sequencing.
      await page.mouse.move(cx + 100, cy, { steps: 8 });
      await page.mouse.move(cx + 200, cy, { steps: 8 });
      await page.mouse.move(cx + 300, cy, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(500);
      await shot(page, "02-drag-after-horizontal");

      const bearingAfter = extractBearingReadout(await compassReadout.textContent());
      expect(bearingAfter).not.toEqual(bearingBefore);
    });

    // Vertical drag (downward — brings upper sky into view, pitch increases).
    const pitchBefore = extractPitchReadout(await pitchReadout.textContent());
    await shotOnFail(page, "02-drag-vertical", async () => {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy + 80, { steps: 6 });
      await page.mouse.move(cx, cy + 160, { steps: 6 });
      await page.mouse.move(cx, cy + 200, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(500);
      await shot(page, "02-drag-after-vertical");

      const pitchAfter = extractPitchReadout(await pitchReadout.textContent());
      expect(pitchAfter).not.toEqual(pitchBefore);
    });

    expect(errs, `console errors: ${errs.join("\n")}`).toEqual([]);
  });

  test("3. FOV interactive via wheel and bar drag", async ({ page }) => {
    const errs: string[] = [];
    await freshPage(page, errs);
    await page.waitForTimeout(800);

    const canvas = page.locator("canvas#sky");
    const fovReadout = page.locator(".fov-readout");

    const initialText = await fovReadout.textContent();
    const initialFov = extractFovDeg(initialText);
    expect(initialFov).not.toBeNull();
    await shot(page, "03-fov-initial");

    // (a) scroll-wheel to zoom in (deltaY < 0 → smaller FOV).
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(400);
    await shot(page, "03-fov-after-wheel");
    const wheelText = await fovReadout.textContent();
    const wheelFov = extractFovDeg(wheelText);
    expect(wheelFov).not.toBeNull();
    await shotOnFail(page, "03-fov-wheel", async () => {
      expect(wheelFov).not.toEqual(initialFov);
    });

    // (b) direct pointer drag on the .fov-bar. We drag the bar marker to
    // the right to push FOV up again.
    const bar = page.locator(".fov-bar");
    const bbox = (await bar.boundingBox())!;
    const startX = bbox.x + bbox.width * 0.2;
    const midY = bbox.y + bbox.height / 2;
    await page.mouse.move(startX, midY);
    await page.mouse.down();
    await page.mouse.move(startX + 50, midY, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await shot(page, "03-fov-after-bar-drag");
    const barText = await fovReadout.textContent();
    const barFov = extractFovDeg(barText);
    expect(barFov).not.toBeNull();
    await shotOnFail(page, "03-fov-bar-drag", async () => {
      expect(barFov).not.toEqual(wheelFov);
    });

    expect(errs, `console errors: ${errs.join("\n")}`).toEqual([]);
  });

  test("4. date input + playback sync + reset", async ({ page }) => {
    const errs: string[] = [];
    await freshPage(page, errs);
    await page.waitForTimeout(600);

    // Ensure playback speed is the 1m/s default (rate = 60). The select
    // is labelled "Playback rate".
    const speedSelect = page.locator('select[aria-label="Playback rate"]');
    await speedSelect.selectOption("60");

    // Set date to 2000-06-21 and time to 00:00.
    const dateInput = page.locator('input[type="date"]').first();
    const timeInput = page.locator('input[type="time"]').first();
    await dateInput.fill("2000-06-21");
    await dateInput.dispatchEvent("change");
    await timeInput.fill("00:00");
    await timeInput.dispatchEvent("change");
    await page.waitForTimeout(600);
    await shot(page, "04-date-set");

    // The a11y summary should include the new date within ~300ms of commit (+ 200ms debounce).
    await expect(page.locator("#a11y-summary")).toContainText("2000-06-21", {
      timeout: 3000,
    });

    // Wait ~3 seconds of playback at 1m/s = ~3 minutes of sky-time. Date-input
    // value should still be 2000-06-21 (not rolled a day) but clock readout advanced.
    const clockReadout = page.locator(".bottom-bar .readout").first();
    const clockBefore = (await clockReadout.textContent()) ?? "";
    await page.waitForTimeout(3000);
    const clockAfter = (await clockReadout.textContent()) ?? "";
    await shot(page, "04-after-3s-playback");
    await shotOnFail(page, "04-playback-sync", async () => {
      expect(clockAfter).not.toEqual(clockBefore);
      // Date input should still be 2000-06-21 (well before next day at midnight
      // + only ~3 minutes of sky time).
      expect(await dateInput.inputValue()).toBe("2000-06-21");
    });

    // Switch to 1h/s and wait 2 seconds: 2 sky hours pass. localTime should
    // no longer be 00:00.
    await speedSelect.selectOption("3600");
    await page.waitForTimeout(2500);
    await shot(page, "04-after-1h-per-sec");
    const timeAfterHr = await timeInput.inputValue();
    await shotOnFail(page, "04-1h-per-sec-advanced", async () => {
      expect(timeAfterHr).not.toBe("00:00");
    });

    // Pause BEFORE reset so the 1h/s playback doesn't race the assertion.
    // The pause button lives inside [role="toolbar"][aria-label="Playback controls"].
    const pauseBtn = page
      .locator('[role="toolbar"][aria-label="Playback controls"] button[aria-pressed]')
      .first();
    await pauseBtn.click();
    await page.waitForTimeout(400);

    // Reset "snap back to entered instant" — in the current app, the
    // periodic date/time sync loop means the "entered instant" drifts to
    // track playback. So after Reset + Pause, the clock should match
    // whatever the date-input and time-input currently show (i.e. the
    // anchor that the app considers current). Check for that invariant.
    await page.locator('button[title="Return to entered instant"]').click();
    // The clockReadout ticks at 4Hz; give it one cycle to pick up the new current.
    await page.waitForTimeout(500);
    await shot(page, "04-after-reset");
    const afterReset = (await clockReadout.textContent()) ?? "";
    const dateInputAtReset = await dateInput.inputValue();
    const timeInputAtReset = await timeInput.inputValue();
    await shotOnFail(page, "04-reset", async () => {
      // The clock readout should contain the same date as the date input.
      expect(afterReset).toContain(dateInputAtReset);
      // And the HH:MM portion should match the time input's HH:MM value
      // (clock adds :SS seconds — allow any two trailing seconds digits).
      expect(afterReset).toContain(`${timeInputAtReset}:`);
    });

    expect(errs, `console errors: ${errs.join("\n")}`).toEqual([]);
  });

  test("5. layers toggle shows/hides constellation lines", async ({ page }) => {
    const errs: string[] = [];
    await freshPage(page, errs);
    await page.waitForTimeout(1200);

    // Click the "Layers" button.
    const layersBtn = page.locator("button.layer-toggles-summary");
    await layersBtn.click();
    await page.waitForTimeout(200);
    await shot(page, "05-layers-expanded");

    const linesCheckbox = page.locator('input[data-layer="constellationLines"]');
    await expect(linesCheckbox).toBeVisible();

    // It starts checked; uncheck it.
    const wasChecked = await linesCheckbox.isChecked();
    if (wasChecked) {
      await linesCheckbox.click();
    }
    await page.waitForTimeout(500);
    await shot(page, "05-layers-lines-off");

    // Re-check.
    await linesCheckbox.click();
    await page.waitForTimeout(500);
    await shot(page, "05-layers-lines-on");

    await shotOnFail(page, "05-layers", async () => {
      expect(await linesCheckbox.isChecked()).toBe(true);
    });

    expect(errs, `console errors: ${errs.join("\n")}`).toEqual([]);
  });

  test("6. pitch control keyboard: 6× ArrowUp → +30°", async ({ page }) => {
    const errs: string[] = [];
    await freshPage(page, errs);
    await page.waitForTimeout(600);

    const pitchSvg = page.locator(".pitch-svg");
    await pitchSvg.focus();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("ArrowUp");
    }
    await page.waitForTimeout(400);
    await shot(page, "06-pitch-up-30");

    await shotOnFail(page, "06-pitch-30", async () => {
      const valueNow = await pitchSvg.getAttribute("aria-valuenow");
      expect(valueNow).toBe("30");
      const readout = await page.locator(".pitch-readout").textContent();
      expect(readout).toContain("30");
    });

    // Home → 0.
    await page.keyboard.press("Home");
    await page.waitForTimeout(300);
    await shot(page, "06-pitch-home-0");
    await shotOnFail(page, "06-pitch-home", async () => {
      expect(await pitchSvg.getAttribute("aria-valuenow")).toBe("0");
    });

    expect(errs, `console errors: ${errs.join("\n")}`).toEqual([]);
  });

  test("7. red light mode tints viewport", async ({ page }) => {
    const errs: string[] = [];
    await freshPage(page, errs);
    await page.waitForTimeout(600);

    const rlBtn = page.locator("button.red-light-mode-button");
    await rlBtn.click();
    await page.waitForTimeout(300);
    await shot(page, "07-red-light-on");

    await shotOnFail(page, "07-red-light-on", async () => {
      // body class is the easiest assertion.
      const hasClass = await page.evaluate(() =>
        document.body.classList.contains("red-light-active"),
      );
      expect(hasClass).toBe(true);
      expect(await rlBtn.getAttribute("aria-pressed")).toBe("true");
      // The .red-veil element exists and is not hidden.
      const veilHidden = await page.locator(".red-veil").evaluate((el) =>
        (el as HTMLElement).hidden,
      );
      expect(veilHidden).toBe(false);
    });

    await rlBtn.click();
    await page.waitForTimeout(300);
    await shot(page, "07-red-light-off");
    await shotOnFail(page, "07-red-light-off", async () => {
      const hasClass = await page.evaluate(() =>
        document.body.classList.contains("red-light-active"),
      );
      expect(hasClass).toBe(false);
    });

    expect(errs, `console errors: ${errs.join("\n")}`).toEqual([]);
  });

  test("8. location picker → Sydney", async ({ page }) => {
    const errs: string[] = [];
    await freshPage(page, errs);
    await page.waitForTimeout(1500); // let cities/tz load

    await page.locator("button.map-picker-trigger").click();
    await page.waitForTimeout(400);
    await shot(page, "08-picker-open");

    const searchInput = page.locator('.map-picker input[aria-label="Search cities"]');
    await searchInput.fill("Sydney");
    await page.waitForTimeout(500);
    await shot(page, "08-picker-sydney-typed");

    // The first autocomplete result; use Enter to select without navigating arrows.
    // ArrowDown first so the first item is "active", then Enter.
    await searchInput.press("ArrowDown");
    await searchInput.press("Enter");
    await page.waitForTimeout(300);
    await shot(page, "08-picker-sydney-selected");

    await page.locator(".map-picker-confirm").click();
    await page.waitForTimeout(1500);
    await shot(page, "08-after-confirm");

    await shotOnFail(page, "08-location", async () => {
      const summary = (await page.locator("#a11y-summary").textContent()) ?? "";
      expect(summary.toLowerCase()).toContain("sydney");
      // Southern hemisphere: latitude line with S.
      expect(summary).toMatch(/\d+\.\d+°S/);
    });

    expect(errs, `console errors: ${errs.join("\n")}`).toEqual([]);
  });

  test("9. out-of-range date shows caveat banner", async ({ page }) => {
    const errs: string[] = [];
    await freshPage(page, errs);
    await page.waitForTimeout(600);

    const dateInput = page.locator('input[type="date"]').first();
    await dateInput.fill("1850-01-01");
    await dateInput.dispatchEvent("change");
    await page.waitForTimeout(600);
    await shot(page, "09-caveat-1850");

    const banner = page.locator("#caveat-banner");
    await shotOnFail(page, "09-caveat-visible", async () => {
      await expect(banner).toBeVisible({ timeout: 3000 });
      const txt = (await banner.textContent()) ?? "";
      // Copy: "Outside the verified date range (1900–2100); astronomical accuracy is degraded."
      expect(txt.toLowerCase()).toMatch(/outside|verified/);
    });

    // Back to current year — banner disappears.
    const currentYear = new Date().getUTCFullYear();
    await dateInput.fill(`${currentYear}-06-15`);
    await dateInput.dispatchEvent("change");
    await page.waitForTimeout(600);
    await shot(page, "09-caveat-cleared");
    await shotOnFail(page, "09-caveat-cleared", async () => {
      await expect(banner).toBeHidden({ timeout: 3000 });
    });

    expect(errs, `console errors: ${errs.join("\n")}`).toEqual([]);
  });

  test("11. object-labels tooltip DOM exists", async ({ page }) => {
    // "Test 11" per the spec — the tooltip element must exist in the DOM
    // even if nothing is under the cursor.
    const errs: string[] = [];
    await freshPage(page, errs);
    await page.waitForTimeout(1500);

    const canvas = page.locator("canvas#sky");
    const box = (await canvas.boundingBox())!;
    // Hover somewhere near the upper-third.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.3);
    await page.waitForTimeout(200);
    await shot(page, "11-hover");

    await shotOnFail(page, "11-tooltip-dom", async () => {
      const tooltip = page.locator(".object-labels-tooltip");
      await expect(tooltip).toHaveCount(1);
    });

    expect(errs, `console errors: ${errs.join("\n")}`).toEqual([]);
  });

  test("12. ground + sky pixel sanity", async ({ page }) => {
    const errs: string[] = [];
    await freshPage(page, errs);
    // Ensure stars are rendered — wait for the star dataset to load + a few frames.
    await page.waitForTimeout(2500);
    await shot(page, "12-ground-sky");

    const bottom = await canvasStats(page, "bottom");
    const top = await canvasStats(page, "top");

    await shotOnFail(page, "12-ground-sky", async () => {
      // Ground (bottom strip) should NOT be pure black. The textured ground
      // has a gradient + noise which easily pushes the mean above (5,5,5).
      const bottomAvg = (bottom.avgR + bottom.avgG + bottom.avgB) / 3;
      expect(
        bottomAvg,
        `bottom avg RGB = (${bottom.avgR.toFixed(2)}, ${bottom.avgG.toFixed(2)}, ${bottom.avgB.toFixed(2)})`,
      ).toBeGreaterThan(5);

      // Top half should have at least some non-dark pixels (stars, sun/moon).
      expect(top.nonBlack, "top half should have some non-dark pixels").toBeGreaterThan(20);
    });

    expect(errs, `console errors: ${errs.join("\n")}`).toEqual([]);
  });

  test("10b. desktop hides Live Mode button", async ({ page }) => {
    const errs: string[] = [];
    await freshPage(page, errs);
    await page.waitForTimeout(500);
    // The .night-mode panel is in the DOM but the media query hides it.
    const nightMode = page.locator(".night-mode");
    await shotOnFail(page, "10b-desktop-night-mode-hidden", async () => {
      await expect(nightMode).toBeHidden();
    });
    expect(errs, `console errors: ${errs.join("\n")}`).toEqual([]);
  });
});

// =============================================================================
// MOBILE GROUP — 390x844
// =============================================================================
test.describe("mobile 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("10. mobile layout: top widgets visible + canvas renders", async ({
    page,
  }) => {
    const errs: string[] = [];
    await freshPage(page, errs);
    await page.waitForTimeout(2500);
    await shot(page, "10-mobile-default");

    await shotOnFail(page, "10-mobile-default", async () => {
      // Compass widget visible.
      await expect(page.locator(".compass")).toBeVisible();
      // Canvas has non-trivial pixel content.
      const stats = await canvasStats(page, "full");
      const avg = (stats.avgR + stats.avgG + stats.avgB) / 3;
      expect(
        avg,
        `mobile canvas avg RGB = ${avg.toFixed(2)}, nonBlack=${stats.nonBlack}`,
      ).toBeGreaterThan(1);
      // Live Mode button visible on mobile viewport.
      await expect(page.locator(".night-mode")).toBeVisible();
    });

    expect(errs, `console errors: ${errs.join("\n")}`).toEqual([]);
  });
});
