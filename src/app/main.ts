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
import { DEFAULT_OBSERVATION } from "./types";
import {
  buildCurrentTimeDefaultAtMooreHall,
  buildGeolocatedDefault,
  composeGeolocatedObservation,
} from "./default-observation";
import { nearestCity } from "../ui/nearest-city";
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
import { mountPitchControl } from "../ui/pitch-control";
import { mountSkyGestures } from "../ui/sky-gestures";
import { mountFovControl } from "../ui/fov-control";
import { mountMapPicker } from "../ui/map-picker";
import { loadTzTable, resolveTz } from "../ui/tz-resolver";
import { mountLayerToggles } from "../ui/layer-toggles";
import { mountObjectLabels, type LabelableObjects } from "../ui/object-labels";
import { STAR_NAMES } from "../astro/star-names";
import { precessStarToEpoch } from "../astro/stars";
import {
  projectAltAzDegToNdc,
  ndcToCssPixels,
  isAboveHorizon,
} from "../render/projection";

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

// ---------- Label projection for the DOM overlay ----------
//
// The renderer projects the same objects on the GPU (and in Canvas2D) but
// doesn't expose the screen-space results. For the hover/tap overlay we
// re-project a small curated subset (the ~named bright stars, all planets,
// constellation centroids) each frame in app code. The volumes involved are
// tiny (< 120 items) so the extra CPU cost is negligible compared to the
// per-frame astro already done above.

const BODY_DISPLAY_NAMES: Record<string, string> = {
  sun: "Sun",
  moon: "Moon",
  mercury: "Mercury",
  venus: "Venus",
  mars: "Mars",
  jupiter: "Jupiter",
  saturn: "Saturn",
  uranus: "Uranus",
  neptune: "Neptune",
};

function computeLabels(
  state: SkyState,
  datasets: SkyDatasets,
  widthCss: number,
  heightCss: number
): LabelableObjects {
  const obs = state.observation;
  const bearingRad = (obs.bearingDeg * Math.PI) / 180;
  const pitchRad = (obs.pitchDeg * Math.PI) / 180;
  const fovRad = (obs.fovDeg * Math.PI) / 180;
  const aspect = widthCss > 0 && heightCss > 0 ? widthCss / heightCss : 1;
  const latRad = (obs.location.lat * Math.PI) / 180;
  const lonRad = (obs.location.lon * Math.PI) / 180;

  const stars: LabelableObjects["stars"] = [];
  const planets: LabelableObjects["planets"] = [];
  const constellationCentroids: LabelableObjects["constellationCentroids"] = [];

  // Planets (and Sun/Moon as "planets" for picking purposes).
  for (const body of state.bodies) {
    if (!isAboveHorizon(body.altDeg)) continue;
    const ndc = projectAltAzDegToNdc(
      body.altDeg,
      body.azDeg,
      bearingRad,
      pitchRad,
      fovRad,
      aspect
    );
    if (!ndc) continue;
    if (Math.abs(ndc.x) > 1.1 || Math.abs(ndc.y) > 1.1) continue;
    const { px, py } = ndcToCssPixels(ndc.x, ndc.y, widthCss, heightCss);
    const name = BODY_DISPLAY_NAMES[body.id] ?? body.id;
    planets.push({ body: body.id, screenX: px, screenY: py, name });
  }

  // Named bright stars. We walk the whole catalogue only for entries that
  // have an STAR_NAMES mapping — typically ~80 items — so the loop is cheap.
  for (const star of datasets.stars) {
    const name = STAR_NAMES[star.id];
    if (!name) continue;
    const app = precessStarToEpoch(
      star.raJ2000Rad,
      star.decJ2000Rad,
      star.pmRaMasPerYr,
      star.pmDecMasPerYr,
      state.utcMs
    );
    const h = equatorialToHorizontal(app.ra, app.dec, latRad, lonRad, state.utcMs);
    if (!isAboveHorizon(h.altDeg)) continue;
    const ndc = projectAltAzDegToNdc(h.altDeg, h.azDeg, bearingRad, pitchRad, fovRad, aspect);
    if (!ndc) continue;
    if (Math.abs(ndc.x) > 1.1 || Math.abs(ndc.y) > 1.1) continue;
    const { px, py } = ndcToCssPixels(ndc.x, ndc.y, widthCss, heightCss);
    stars.push({
      starId: star.id,
      screenX: px,
      screenY: py,
      name,
      magnitude: star.vmag,
    });
  }

  // Constellation centroids: project each endpoint that's on-screen, then
  // centroid-average the pixel coords. This is an approximation (true
  // centroid on the sphere would be more complex) but matches the "rough
  // middle of the visible figure" the UI wants.
  if (datasets.constellations.length > 0 && datasets.stars.length > 0) {
    // Build a one-shot HR -> Star index so the constellation lines don't
    // walk the whole catalogue per segment. O(N) build, done once per frame.
    const starById = new Map<number, Star>();
    for (const s of datasets.stars) starById.set(s.id, s);

    for (const cons of datasets.constellations) {
      let sx = 0;
      let sy = 0;
      let n = 0;
      const endpoints = new Set<number>();
      for (const [a, b] of cons.lines) {
        endpoints.add(a);
        endpoints.add(b);
      }
      for (const hr of endpoints) {
        const star = starById.get(hr);
        if (!star) continue;
        const app = precessStarToEpoch(
          star.raJ2000Rad,
          star.decJ2000Rad,
          star.pmRaMasPerYr,
          star.pmDecMasPerYr,
          state.utcMs
        );
        const h = equatorialToHorizontal(app.ra, app.dec, latRad, lonRad, state.utcMs);
        if (!isAboveHorizon(h.altDeg)) continue;
        const ndc = projectAltAzDegToNdc(h.altDeg, h.azDeg, bearingRad, pitchRad, fovRad, aspect);
        if (!ndc) continue;
        if (Math.abs(ndc.x) > 1.1 || Math.abs(ndc.y) > 1.1) continue;
        const px = ndcToCssPixels(ndc.x, ndc.y, widthCss, heightCss);
        sx += px.px;
        sy += px.py;
        n++;
      }
      // Require at least 3 on-screen endpoints for a meaningful centroid.
      if (n >= 3) {
        constellationCentroids.push({
          abbr: cons.name,
          fullName: cons.fullName,
          screenX: sx / n,
          screenY: sy / n,
        });
      }
    }
  }

  return { stars, planets, constellationCentroids };
}

// ---------- Boot ----------

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

// Interface matches what src/ui/map-picker.ts loads from data/cities.json.
interface CityRecord {
  name: string;
  asciiName: string;
  country: string;
  lat: number;
  lon: number;
  population: number;
}

async function fetchCitiesForLabel(): Promise<CityRecord[] | null> {
  try {
    const r = await fetch("./data/cities.json");
    if (!r.ok) return null;
    return (await r.json()) as CityRecord[];
  } catch {
    return null;
  }
}

// Is the current store state still the 1969 Moore Hall easter-egg default?
function isBaselineDefault(): boolean {
  const obs = getObservation();
  return obs.utcInstant === DEFAULT_OBSERVATION.utcInstant;
}

async function upgradeDefaultObservation(): Promise<void> {
  if (!isBaselineDefault()) return; // user had a persisted observation

  const geo = await buildGeolocatedDefault();
  // Re-check baseline in case the user mutated state while we were waiting
  // on the permission prompt (map picker, manual date edit, etc.).
  if (!isBaselineDefault()) return;

  if (!geo) {
    setObservation(buildCurrentTimeDefaultAtMooreHall());
    return;
  }

  // Resolve tz for the geolocated position. If the tz table failed to load
  // we fall through to Moore-Hall-now rather than inventing an offset.
  let timeZone: string;
  let utcOffsetMinutes: number;
  try {
    const tz = resolveTz(geo.lat, geo.lon, geo.utcMs);
    timeZone = tz.zone;
    utcOffsetMinutes = tz.offsetMinutes;
  } catch {
    setObservation(buildCurrentTimeDefaultAtMooreHall());
    return;
  }

  // Nearest-city label is best-effort; absence is fine.
  let label: string | null = "Current location";
  const cities = await fetchCitiesForLabel();
  if (cities && cities.length > 0) {
    const near = nearestCity(geo.lat, geo.lon, cities);
    if (near) label = `Near ${near.name}`;
  }

  if (!isBaselineDefault()) return;
  setObservation(
    composeGeolocatedObservation(geo, timeZone, utcOffsetMinutes, label)
  );
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
  mountPitchControl(topRight);
  mountSkyGestures(canvas);
  mountPlaybackControl(bottomBar, playback);
  mountLayerToggles(sidePanel);

  // DOM overlay labels. `currentLabels` is updated each frame below; the
  // overlay reads it via the getter so we don't have to call setters from
  // the render loop or couple the two modules to a shared module-level
  // binding.
  let currentLabels: LabelableObjects = {
    stars: [],
    planets: [],
    constellationCentroids: [],
  };
  mountObjectLabels(canvas, () => currentLabels);

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
    // Recompute label screen positions for the DOM overlay. This is a cheap
    // re-project of a curated subset (~80 named stars + planets +
    // constellation centroids) and runs on the CPU — keeping it in-frame
    // ensures labels stay pinned to their objects during pan/zoom.
    currentLabels = computeLabels(state, datasets, window.innerWidth, window.innerHeight);
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

  // Default-observation upgrade: if the store ended up with the baseline
  // DEFAULT_OBSERVATION (no persisted state), try to use the user's current
  // location + wall time. On denial / timeout, fall back to Moore Hall at
  // the current wall time (not the 1969 easter-egg instant).
  void upgradeDefaultObservation();
  // ----

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
