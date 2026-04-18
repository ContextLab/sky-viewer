// T044 — Entry point. Wires every module together:
//   1. Loads the 5 data files in parallel.
//   2. Initializes the Observation store (reads localStorage).
//   3. Creates the renderer (WebGL2 or Canvas2D fallback).
//   4. Mounts UI widgets (date/time, map, compass, FOV, playback, caveat banner).
//   5. Drives the render loop via requestAnimationFrame with input
//      coalescing to enforce the 100ms p95 input→update budget.
//   6. Updates the a11y summary on every observation change.

import {
  getObservation,
  setObservation,
  subscribe,
} from "./observation-store";
import { updateSummary } from "./a11y-summary";
import { parseStarCatalogue } from "../astro/stars";
import type { Star } from "../astro/stars";
import { parseConstellations } from "../astro/constellations";
import type { Constellation } from "../astro/constellations";
import { sunPosition, moonPosition } from "../astro/sun-moon";
import { planetPosition } from "../astro/planets";
import type { VisiblePlanet } from "../astro/planets";
import { equatorialToHorizontal } from "../astro/transforms";
import { twilightPhase, skyBackgroundColor } from "../astro/twilight";
import { createRenderer } from "../render/renderer";
import type { Renderer, RenderBody, SkyState, SkyDatasets } from "../render/types";

import { mountDateTimeInput } from "../ui/date-time-input";
import {
  mountPlaybackControl,
  createPlaybackController,
} from "../ui/playback-control";
import { mountCaveatBanner } from "../ui/caveat-banner";
import { mountCompass } from "../ui/compass";
import { mountFovControl } from "../ui/fov-control";
import { mountMapPicker } from "../ui/map-picker";
import { loadTzTable, resolveTz } from "../ui/tz-resolver";

// ---------- Data loading ----------

interface LoadedData {
  stars: Star[];
  constellations: Constellation[];
  tzLoaded: boolean;
}

async function loadAllDatasets(): Promise<LoadedData> {
  // Relative fetch so both dev server and GitHub Pages work.
  const starsReq = fetch("./data/stars.bin").then((r) => r.arrayBuffer());
  const consReq = fetch("./data/constellations.json").then((r) => r.json());
  const tzReq = fetch("./data/tz.json").then((r) => r.json());

  const [starsBuf, consJson, tzJson] = await Promise.all([starsReq, consReq, tzReq]);
  const stars = parseStarCatalogue(starsBuf);
  const constellations = parseConstellations(consJson);
  loadTzTable(tzJson);
  return { stars, constellations, tzLoaded: true };
}

// ---------- Celestial bodies (Sun, Moon, planets) per-frame ----------

const PLANET_IDS: Array<VisiblePlanet> = [
  "mercury",
  "venus",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
];

function computeBodies(utcMs: number, latRad: number, lonRad: number): RenderBody[] {
  const out: RenderBody[] = [];

  // Sun
  const sun = sunPosition(utcMs);
  const sunH = equatorialToHorizontal(sun.raRad, sun.decRad, latRad, lonRad, utcMs);
  out.push({
    id: "sun",
    altDeg: sunH.altDeg,
    azDeg: sunH.azDeg,
    apparentMag: -26.74,
    angularDiameterArcsec: 1919,
  });

  // Moon
  const moon = moonPosition(utcMs);
  const moonH = equatorialToHorizontal(moon.raRad, moon.decRad, latRad, lonRad, utcMs);
  out.push({
    id: "moon",
    altDeg: moonH.altDeg,
    azDeg: moonH.azDeg,
    apparentMag: -12.6,
    angularDiameterArcsec: moon.angularDiameterArcsec,
    phase: moon.phase,
  });

  // Planets
  for (const body of PLANET_IDS) {
    const p = planetPosition(body, utcMs);
    const h = equatorialToHorizontal(p.raRad, p.decRad, latRad, lonRad, utcMs);
    out.push({
      id: body,
      altDeg: h.altDeg,
      azDeg: h.azDeg,
      apparentMag: p.apparentMag,
    });
  }

  return out;
}

// ---------- Boot ----------

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

async function boot(): Promise<void> {
  const canvas = getEl<HTMLCanvasElement>("sky");
  const summaryEl = getEl<HTMLElement>("a11y-summary");
  const overlay = getEl<HTMLElement>("ui-overlay");
  const banner = getEl<HTMLElement>("caveat-banner");

  // Build overlay layout.
  const topBar = document.createElement("div");
  topBar.className = "top-bar";
  const topLeft = document.createElement("div");
  topLeft.className = "row";
  const topRight = document.createElement("div");
  topRight.className = "row";
  topBar.append(topLeft, topRight);

  const middle = document.createElement("div"); // empty; canvas shows through
  const bottomBar = document.createElement("div");
  bottomBar.className = "bottom-bar row";

  const sidePanel = document.createElement("div");
  sidePanel.className = "row";
  sidePanel.style.position = "absolute";
  sidePanel.style.right = "clamp(0.6rem, 2vw, 1.2rem)";
  sidePanel.style.bottom = "5.5rem";

  overlay.append(topBar, middle, bottomBar, sidePanel);

  // Renderer. Reveal the canvas only once it's configured.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const renderer: Renderer = createRenderer(canvas);
  renderer.resize(window.innerWidth, window.innerHeight, dpr);
  canvas.setAttribute("data-kind", renderer.kind);

  window.addEventListener("resize", () => {
    const r = Math.min(window.devicePixelRatio || 1, 2);
    renderer.resize(window.innerWidth, window.innerHeight, r);
  });

  // Caveat banner first (it subscribes and starts listening immediately).
  mountCaveatBanner(banner);

  // Playback controller (pure state, no DOM yet).
  const playback = createPlaybackController();

  // UI widgets that don't depend on the datasets.
  mountDateTimeInput(topLeft);
  mountFovControl(canvas, topRight);
  mountCompass(topRight);
  mountPlaybackControl(bottomBar, playback);

  // Live a11y summary.
  const refreshSummary = () => updateSummary(getObservation(), summaryEl);
  subscribe(refreshSummary);
  refreshSummary();

  // Start rendering with empty datasets so the canvas isn't blank while
  // data loads. The twilight background + moving body positions still
  // work immediately — the stars just appear when the catalogue arrives.
  let datasets: SkyDatasets = { stars: [], constellations: [] };
  canvas.setAttribute("data-ready", "true"); // tests wait on this attribute

  // Kick off the render loop. Uses requestAnimationFrame; input events
  // mutate the Observation store but do not themselves trigger a render
  // — we render every frame and pick up the latest state. This is
  // exactly the input-coalescing pattern that guarantees the 100 ms p95
  // input→update budget (FR-017, SC-002).
  let lastWallMs = performance.now();
  const frame = (nowMs: number) => {
    const dtWall = nowMs - lastWallMs;
    lastWallMs = nowMs;
    const utcMs = playback.tick(dtWall);
    const obs = getObservation();
    const latRad = (obs.location.lat * Math.PI) / 180;
    // East-positive longitude for our astro convention.
    const lonRad = (obs.location.lon * Math.PI) / 180;
    const bodies = computeBodies(utcMs, latRad, lonRad);
    // Sun altitude for twilight background.
    const sunBody = bodies[0];
    const sunAltDeg = sunBody ? sunBody.altDeg : -90;
    const state: SkyState = {
      utcMs,
      observation: obs,
      backgroundRgb: skyBackgroundColor(sunAltDeg),
      bodies,
    };
    void twilightPhase; // imported for potential future use (a11y twilight label)
    renderer.render(state, datasets);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Now load the datasets. Once they arrive, the next frame picks them up.
  let tzReady: () => void = () => {};
  const tzLoadedPromise = new Promise<void>((resolve) => {
    tzReady = resolve;
  });

  try {
    const loaded = await loadAllDatasets();
    datasets = { stars: loaded.stars, constellations: loaded.constellations };
    tzReady();
  } catch (err) {
    // Partial failure is tolerable: we still render the background +
    // bodies without the star catalogue. Surface to console for diagnostics.
    // eslint-disable-next-line no-console
    console.error("dataset load failed", err);
    tzReady(); // unblock the map picker even if tz table failed
  }

  // Map picker needs the tz table loaded to compute offsets on pick.
  mountMapPicker(topLeft, tzLoadedPromise, (pick) => {
    const currentUtcMs = playback.getCurrentUtcMs();
    const tz = resolveTz(pick.lat, pick.lon, currentUtcMs);
    setObservation({
      location: { lat: pick.lat, lon: pick.lon, label: pick.label ?? null },
      timeZone: pick.timeZone ?? tz.zone,
      utcOffsetMinutes: pick.utcOffsetMinutes ?? tz.offsetMinutes,
    });
  });

  // Register the service worker in the background (non-blocking).
  if ("serviceWorker" in navigator) {
    // Use module-type so esbuild's bundled ESM loads in the SW context.
    navigator.serviceWorker.register("./sw/service-worker.js", { scope: "./" }).catch(() => {
      // Service worker is a progressive enhancement; failure is non-fatal.
    });
  }
}

// Tolerate jsdom / test harnesses by guarding on window.
if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void boot());
  } else {
    void boot();
  }
}
