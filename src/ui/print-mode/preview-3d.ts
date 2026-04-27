// 3D preview for Print Mode.
//
// Renders an SVG-based first-person view of the room from the
// observer's eye position. Visible elements:
//   - Wireframe of the room (ceiling + floor + walls).
//   - Per-tile rectangle outlines on every enabled surface, labelled
//     with their (row, col) — these are the paper sheets the user
//     will tape up.
//   - Star holes as small filled circles at each Hole's projected
//     position, sized by the size class.
//   - "You are here" crosshair at the observer's eye position (which
//     is always the camera origin, so it stays at screen centre).
//
// Camera: starts looking straight up at the ceiling (pitch +90°,
// yaw 0°). Mouse-drag rotates yaw (horizontal) + pitch (vertical).
// Scroll-wheel dollies the camera along the floor plane (a small
// nice-to-have; not required by the spec).
//
// Pure SVG implementation: every frame we project all geometry into
// screen-space and emit `<line>`, `<circle>`, and `<text>` nodes.
// Re-renders on drag pointer-move. With ~1000 elements this is
// comfortably fast.
//
// Tile + hole computation: replicates the projection+binning loop
// from pdf-builder.ts (~50 lines). The two implementations must
// stay in sync — when pdf-builder changes its hole-emission rules
// they must be mirrored here. See `buildSceneFromJob`.

import { equatorialToHorizontal, precessStarToEpoch } from "../../astro/transforms";
import {
  antipodalize,
  bodyToWorldVec,
  deriveSurfaces,
  projectBodyOntoSurface,
} from "../../print/projection";
import { computeTileGrid, tileKey } from "../../print/tile-grid";
import { classifyMagnitude, HOLE_DIAMETERS_MM } from "../../print/types";
import type {
  Hole,
  PrintJob,
  Surface,
  Tile,
  TileBounds,
} from "../../print/types";
import type { PreflightBody } from "../../print/preflight";
import type { SkyDatasets } from "../../render/types";
import { sunPosition, moonPosition } from "../../astro/sun-moon";
import { planetPosition } from "../../astro/planets";
import { parseStarCatalogue, type Star } from "../../astro/stars";
import { parseConstellations, type Constellation } from "../../astro/constellations";
import { getPrintJob } from "../../print/print-job-store";
import type { RegisterRefresh } from "./print-mode";

const SVG_NS = "http://www.w3.org/2000/svg";
const DEG2RAD = Math.PI / 180;

// ---------------------------------------------------------------------------
// Dataset cache (shared with the compute panel pattern, but module-local).
// ---------------------------------------------------------------------------

interface DatasetCache {
  stars: Star[];
  constellations: Constellation[];
}

let datasetCache: DatasetCache | null = null;
let datasetPromise: Promise<DatasetCache> | null = null;

async function loadDatasets(): Promise<DatasetCache> {
  if (datasetCache) return datasetCache;
  if (datasetPromise) return datasetPromise;
  datasetPromise = (async () => {
    const [starsBuf, consJson] = await Promise.all([
      fetch("./data/stars.bin").then((r) => r.arrayBuffer()),
      fetch("./data/constellations.json").then((r) => r.json()),
    ]);
    const cache: DatasetCache = {
      stars: parseStarCatalogue(starsBuf),
      constellations: parseConstellations(consJson),
    };
    datasetCache = cache;
    return cache;
  })();
  return datasetPromise;
}

// ---------------------------------------------------------------------------
// Body computation (sun + moon + planets) — mirrors compute-progress.ts.
// ---------------------------------------------------------------------------

function bodiesForObservation(
  utcMs: number,
  latRad: number,
  lonRad: number,
): PreflightBody[] {
  const out: PreflightBody[] = [];
  const sun = sunPosition(utcMs);
  const sunH = equatorialToHorizontal(sun.raRad, sun.decRad, latRad, lonRad, utcMs);
  out.push({
    altDeg: sunH.altDeg,
    azDeg: sunH.azDeg,
    apparentMag: -26.74,
    bodyKind: "sun",
    label: "Sun",
  });
  const moon = moonPosition(utcMs);
  const moonH = equatorialToHorizontal(moon.raRad, moon.decRad, latRad, lonRad, utcMs);
  out.push({
    altDeg: moonH.altDeg,
    azDeg: moonH.azDeg,
    apparentMag: -12.6,
    bodyKind: "moon",
    label: "Moon",
  });
  const planets = ["mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"] as const;
  for (const id of planets) {
    const p = planetPosition(id, utcMs);
    const h = equatorialToHorizontal(p.raRad, p.decRad, latRad, lonRad, utcMs);
    const cap = id.charAt(0).toUpperCase() + id.slice(1);
    out.push({
      altDeg: h.altDeg,
      azDeg: h.azDeg,
      apparentMag: p.apparentMag,
      bodyKind: "planet",
      label: cap,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scene assembly — mirrors pdf-builder.ts § 1-6 but stops at Tile[] (no PDF).
// ---------------------------------------------------------------------------

interface Scene {
  surfaces: Surface[]; // enabled only
  tiles: Tile[];
}

function buildSceneFromJob(
  job: PrintJob,
  datasets: SkyDatasets,
  bodies: ReadonlyArray<PreflightBody>,
): Scene {
  const allSurfaces = deriveSurfaces(
    job.room,
    job.outputOptions.blockHorizonOnWalls,
  );
  const enabled = allSurfaces.filter((s) => s.enabled);

  const obs = job.observation;
  const utcMs = Date.parse(obs.utcInstant);
  const utcSafe = Number.isFinite(utcMs) ? utcMs : 0;
  const latRad = (obs.location.lat * Math.PI) / 180;
  const lonRad = (obs.location.lon * Math.PI) / 180;

  interface ProjBody {
    altDeg: number;
    azDeg: number;
    mag: number;
    bodyKind: Hole["bodyKind"];
    label: string;
  }
  const projBodies: ProjBody[] = [];
  for (const star of datasets.stars) {
    const epoch = precessStarToEpoch(
      star.raJ2000Rad,
      star.decJ2000Rad,
      star.pmRaMasPerYr,
      star.pmDecMasPerYr,
      utcSafe,
    );
    const { altDeg, azDeg } = equatorialToHorizontal(
      epoch.ra,
      epoch.dec,
      latRad,
      lonRad,
      utcSafe,
    );
    if (classifyMagnitude(star.vmag) === null) continue;
    projBodies.push({
      altDeg,
      azDeg,
      mag: star.vmag,
      bodyKind: "star",
      label: `HR-${star.id}`,
    });
  }
  for (const b of bodies) {
    if (classifyMagnitude(b.apparentMag) === null) continue;
    const bodyKind: Hole["bodyKind"] =
      b.bodyKind === "sun" ? "sun" : b.bodyKind === "moon" ? "moon" : "planet";
    projBodies.push({
      altDeg: b.altDeg,
      azDeg: b.azDeg,
      mag: b.apparentMag,
      bodyKind,
      label: b.label,
    });
  }

  const observerPos = {
    x: job.room.observerPositionMm.xMm,
    y: job.room.observerPositionMm.yMm,
    z: job.room.observerPositionMm.eyeHeightMm,
  };

  const tiles: Tile[] = [];
  let pageNumber = 2;
  for (const surface of enabled) {
    const grid = computeTileGrid(surface, job.outputOptions.paper);
    const holes: Hole[] = [];
    for (const body of projBodies) {
      const cls = classifyMagnitude(body.mag);
      if (cls === null) continue;
      if (
        surface.projectionMode === "aboveHorizon" ||
        surface.projectionMode === "continuous"
      ) {
        const v = bodyToWorldVec(body.altDeg, body.azDeg);
        const hit = projectBodyOntoSurface(v, surface, observerPos);
        if (hit) {
          holes.push({
            surfaceUMm: hit.uMm,
            surfaceVMm: hit.vMm,
            sizeClass: cls,
            label: body.label,
            bodyKind: body.bodyKind,
            apparentMag: body.mag,
          });
        }
      }
      if (
        surface.projectionMode === "antipodal" ||
        surface.projectionMode === "continuous"
      ) {
        const ap = antipodalize(body.altDeg, body.azDeg);
        const v = bodyToWorldVec(ap.altDeg, ap.azDeg);
        const hit = projectBodyOntoSurface(v, surface, observerPos);
        if (hit) {
          holes.push({
            surfaceUMm: hit.uMm,
            surfaceVMm: hit.vMm,
            sizeClass: cls,
            label: body.label,
            bodyKind: body.bodyKind,
            apparentMag: body.mag,
          });
        }
      }
    }

    // Bin holes into tiles using the same row/col floor-division as
    // assignHolesToTiles. We DON'T need the edge-tolerance multi-tile
    // duplication here — the preview only needs to know "how many
    // sheets do I print, what's on each one" — so primary tile only.
    const { rows, cols, cellWidthMm, cellHeightMm } = grid;
    const holesByTile = new Map<string, Hole[]>();
    for (const h of holes) {
      if (h.surfaceUMm < 0 || h.surfaceUMm > surface.widthMm) continue;
      if (h.surfaceVMm < 0 || h.surfaceVMm > surface.heightMm) continue;
      const c = Math.min(Math.max(Math.floor(h.surfaceUMm / cellWidthMm), 0), cols - 1);
      const r = Math.min(Math.max(Math.floor(h.surfaceVMm / cellHeightMm), 0), rows - 1);
      const key = tileKey(r, c);
      let list = holesByTile.get(key);
      if (!list) {
        list = [];
        holesByTile.set(key, list);
      }
      list.push(h);
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const key = tileKey(r, c);
        const tHoles = holesByTile.get(key) ?? [];
        // Same blank-skip behaviour as pdf-builder so the preview
        // shows what will actually print.
        if (tHoles.length === 0) continue;
        const bounds: TileBounds = {
          uMinMm: c * cellWidthMm,
          vMinMm: r * cellHeightMm,
          uMaxMm: (c + 1) * cellWidthMm,
          vMaxMm: (r + 1) * cellHeightMm,
        };
        tiles.push({
          surfaceId: surface.id,
          row: r,
          col: c,
          pageNumber,
          tileBoundsMm: bounds,
          holes: tHoles,
          featureCutouts: [],
          constellationSegments: [],
        });
        pageNumber += 1;
      }
    }
  }

  return { surfaces: enabled, tiles };
}

// ---------------------------------------------------------------------------
// Camera + projection.
// ---------------------------------------------------------------------------

interface Camera {
  /** Pivot point (room-local 3D, mm) — always the observer's eye. */
  posX: number;
  posY: number;
  posZ: number;
  /** Yaw in radians; 0 = facing +y (North). Positive = rotates east. */
  yaw: number;
  /** Pitch in radians; 0 = horizon, +π/2 = looking straight up. */
  pitch: number;
  /** Vertical FOV in radians. */
  fovY: number;
}

function makeInitialCamera(job: PrintJob): Camera {
  return {
    posX: job.room.observerPositionMm.xMm,
    posY: job.room.observerPositionMm.yMm,
    posZ: job.room.observerPositionMm.eyeHeightMm,
    yaw: 0,
    pitch: Math.PI / 2 - 0.001, // looking straight up (avoid singularity)
    fovY: 60 * DEG2RAD,
  };
}

/**
 * Project a world-space point into normalised device coordinates
 * `(ndcX, ndcY)` ∈ [-1, 1] × [-1, 1] when visible, plus a `depth`
 * (positive = in front of camera). Returns null if the point is at
 * or behind the camera plane.
 */
function projectPoint(
  cam: Camera,
  wx: number,
  wy: number,
  wz: number,
  aspect: number,
): { x: number; y: number; depth: number } | null {
  // Translate into camera-local coords.
  const dx = wx - cam.posX;
  const dy = wy - cam.posY;
  const dz = wz - cam.posZ;

  // Camera basis. Forward initial (yaw=0, pitch=0) = +y. Yaw rotates
  // about +z; pitch tilts forward up about the camera's right axis.
  // Right axis = forward × up (recomputed below).
  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  // Forward vector after yaw + pitch.
  const fx = cp * sy;
  const fy = cp * cy;
  const fz = sp;
  // Right = (cos(yaw), -sin(yaw), 0) — perpendicular to +z and to forward's xy projection.
  const rx = cy;
  const ry = -sy;
  const rz = 0;
  // Up = forward × right (right-handed: but we want classical "up",
  // so compute as right × forward then negate? Use right × forward).
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;

  const camX = dx * rx + dy * ry + dz * rz;
  const camY = dx * ux + dy * uy + dz * uz;
  const camZ = dx * fx + dy * fy + dz * fz;

  if (camZ <= 1) return null; // behind / too close

  const f = 1 / Math.tan(cam.fovY / 2);
  const ndcX = (camX * f) / aspect / camZ;
  const ndcY = (camY * f) / camZ;
  return { x: ndcX, y: ndcY, depth: camZ };
}

function ndcToScreen(
  ndcX: number,
  ndcY: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (1 - (ndcY * 0.5 + 0.5)) * height,
  };
}

// ---------------------------------------------------------------------------
// Surface helpers — convert (uMm, vMm) on a Surface to room-world 3D.
// ---------------------------------------------------------------------------

function surfaceUVToWorld(
  surface: Surface,
  uMm: number,
  vMm: number,
): { x: number; y: number; z: number } {
  const o = surface.originPose.originMm;
  const u = surface.originPose.uAxisMm;
  const v = surface.originPose.vAxisMm;
  return {
    x: o.x + u.x * uMm + v.x * vMm,
    y: o.y + u.y * uMm + v.y * vMm,
    z: o.z + u.z * uMm + v.z * vMm,
  };
}

function surfaceShortLabel(surface: Surface): string {
  if (surface.id === "ceiling") return "C";
  if (surface.id === "floor") return "F";
  if (surface.kind === "wall") {
    // First char of the directional label, e.g. "North wall" → "N".
    const first = surface.label.charAt(0).toUpperCase();
    return first || "W";
  }
  return surface.id;
}

// ---------------------------------------------------------------------------
// Mount.
// ---------------------------------------------------------------------------

export function mount3dPreview(host: HTMLElement, register: RegisterRefresh): void {
  const panel = document.createElement("section");
  panel.className = "print-mode-panel print-mode-preview-3d-panel";

  const heading = document.createElement("h2");
  heading.className = "print-mode-panel-heading";
  heading.textContent = "3D preview";
  panel.append(heading);

  const helper = document.createElement("p");
  helper.className = "print-mode-helper";
  helper.textContent =
    "View your room from the observer's eye. Drag to rotate; scroll to dolly forward/back. Each amber rectangle is one paper sheet you'll tape up. (Stars hide while you drag for smooth motion; release to see them again.)";
  panel.append(helper);

  // ---- Toolbar ----
  const toolbar = document.createElement("div");
  toolbar.className = "print-mode-row print-mode-preview-3d-toolbar";

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "print-mode-secondary print-mode-preview-3d-reset";
  resetBtn.textContent = "Reset view";
  toolbar.append(resetBtn);

  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "print-mode-secondary print-mode-preview-3d-refresh";
  refreshBtn.textContent = "Refresh stars";
  refreshBtn.title =
    "Recompute the star projection for the current observation + room";
  toolbar.append(refreshBtn);

  const status = document.createElement("span");
  status.className = "print-mode-status print-mode-preview-3d-status";
  status.setAttribute("aria-live", "polite");
  toolbar.append(status);

  panel.append(toolbar);

  // ---- SVG canvas ----
  const SVG_W = 560;
  const SVG_H = 420;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "print-mode-preview-3d-svg");
  svg.setAttribute("width", String(SVG_W));
  svg.setAttribute("height", String(SVG_H));
  svg.setAttribute("viewBox", `0 0 ${SVG_W} ${SVG_H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "3D preview of room with star stencils");
  svg.style.touchAction = "none";
  panel.append(svg);

  host.append(panel);

  // ---- State ----
  let camera: Camera = makeInitialCamera(getPrintJob());
  let scene: Scene | null = null;
  let sceneJobSnapshot = "";
  // Drag state.
  let dragPointer: number | null = null;
  let lastDragX = 0;
  let lastDragY = 0;
  // requestAnimationFrame coalescing — pointermove fires at 1 kHz on
  // some trackpads; we cap to display refresh and drop quality
  // (no holes, no labels) while a drag is active so each frame stays
  // under a few hundred DOM nodes instead of ~1500.
  let pendingRAF: number | null = null;
  function scheduleRender(): void {
    if (pendingRAF !== null) return;
    pendingRAF = requestAnimationFrame(() => {
      pendingRAF = null;
      render();
    });
  }

  function setStatus(msg: string): void {
    status.textContent = msg;
  }

  function clearStatus(): void {
    status.textContent = "";
  }

  function resetCamera(): void {
    camera = makeInitialCamera(getPrintJob());
    render();
  }

  resetBtn.addEventListener("click", () => {
    resetCamera();
  });

  // ---- Compute / refresh scene ----
  async function rebuildScene(): Promise<void> {
    setStatus("Loading datasets…");
    try {
      const datasets = await loadDatasets();
      const job = getPrintJob();
      const utcMs = Date.parse(job.observation.utcInstant);
      const latRad = (job.observation.location.lat * Math.PI) / 180;
      const lonRad = (job.observation.location.lon * Math.PI) / 180;
      const utcSafe = Number.isFinite(utcMs) ? utcMs : Date.now();
      const bodies = bodiesForObservation(utcSafe, latRad, lonRad);
      const skyDatasets: SkyDatasets = {
        stars: datasets.stars,
        constellations: datasets.constellations,
      };
      scene = buildSceneFromJob(job, skyDatasets, bodies);
      sceneJobSnapshot = JSON.stringify(job);
      clearStatus();
      render();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("preview-3d: rebuild failed", err);
      setStatus("Could not load datasets — check console.");
    }
  }

  refreshBtn.addEventListener("click", () => {
    void rebuildScene();
  });

  // ---- Drag rotation ----
  svg.addEventListener("pointerdown", (ev) => {
    if (dragPointer !== null) return;
    dragPointer = ev.pointerId;
    lastDragX = ev.clientX;
    lastDragY = ev.clientY;
    svg.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  svg.addEventListener("pointermove", (ev) => {
    if (dragPointer !== ev.pointerId) return;
    const dx = ev.clientX - lastDragX;
    const dy = ev.clientY - lastDragY;
    lastDragX = ev.clientX;
    lastDragY = ev.clientY;
    // Yaw: dragging right rotates the view to the right. Pitch: drag-up
    // tilts the view up (so you see less of the ceiling).
    const yawSpeed = 0.005;
    const pitchSpeed = 0.005;
    camera.yaw += dx * yawSpeed;
    camera.pitch -= dy * pitchSpeed;
    // Clamp pitch to avoid flipping.
    const PITCH_LIMIT = Math.PI / 2 - 0.01;
    if (camera.pitch > PITCH_LIMIT) camera.pitch = PITCH_LIMIT;
    if (camera.pitch < -PITCH_LIMIT) camera.pitch = -PITCH_LIMIT;
    scheduleRender();
  });
  const endDrag = (ev: PointerEvent): void => {
    if (dragPointer !== ev.pointerId) return;
    dragPointer = null;
    try {
      svg.releasePointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    // Re-render at full quality (with holes + labels) on release.
    render();
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);

  // ---- Scroll-wheel dolly ----
  svg.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      const job = getPrintJob();
      // Move the camera along the floor-plane projection of its forward
      // vector. Up is +z; we strip the z component.
      const cy = Math.cos(camera.yaw);
      const sy = Math.sin(camera.yaw);
      // Forward XY (yaw direction) — same as in projectPoint, with pitch=0.
      const fx = sy;
      const fy = cy;
      // Direction-into-room dolly speed: 5% of room diagonal per
      // wheel notch.
      const halfDiag = Math.hypot(
        ...job.room.vertices.reduce<[number, number]>(
          ([x, y], v) => [Math.max(x, Math.abs(v.xMm)), Math.max(y, Math.abs(v.yMm))],
          [0, 0],
        ),
      );
      const step = -ev.deltaY * 0.0008 * halfDiag;
      camera.posX += fx * step;
      camera.posY += fy * step;
      // Clamp inside the floor-plan bounding box.
      let xMin = Infinity;
      let xMax = -Infinity;
      let yMin = Infinity;
      let yMax = -Infinity;
      for (const v of job.room.vertices) {
        if (v.xMm < xMin) xMin = v.xMm;
        if (v.xMm > xMax) xMax = v.xMm;
        if (v.yMm < yMin) yMin = v.yMm;
        if (v.yMm > yMax) yMax = v.yMm;
      }
      camera.posX = Math.min(Math.max(camera.posX, xMin + 50), xMax - 50);
      camera.posY = Math.min(Math.max(camera.posY, yMin + 50), yMax - 50);
      scheduleRender();
    },
    { passive: false },
  );

  // ---- Render ----
  function render(): void {
    // While the user is actively dragging we draw a "fast preview":
    // wireframe + tile rectangles only. Holes (~1000 dots, depth-scaled
    // radius) and per-tile labels are skipped because they dominate the
    // per-frame cost. Full quality returns on pointerup.
    const isDragging = dragPointer !== null;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // Background fill.
    const bg = document.createElementNS(SVG_NS, "rect");
    bg.setAttribute("x", "0");
    bg.setAttribute("y", "0");
    bg.setAttribute("width", String(SVG_W));
    bg.setAttribute("height", String(SVG_H));
    bg.setAttribute("fill", "var(--bg-night)");
    svg.append(bg);

    const aspect = SVG_W / SVG_H;
    const job = getPrintJob();
    const allSurfaces = deriveSurfaces(
      job.room,
      job.outputOptions.blockHorizonOnWalls,
    );

    // Project a polyline of world points; emit only the segments where
    // BOTH endpoints project successfully (no clipping for now —
    // segments crossing the view-plane just disappear). This keeps the
    // implementation simple; for a wireframe room the artefact is rare
    // when you're inside the box.
    function projectAndDraw(
      group: SVGGElement,
      vertices: Array<{ x: number; y: number; z: number }>,
      stroke: string,
      strokeWidth: number,
      closed: boolean,
    ): void {
      const projected = vertices.map((v) =>
        projectPoint(camera, v.x, v.y, v.z, aspect),
      );
      const n = vertices.length;
      const limit = closed ? n : n - 1;
      for (let i = 0; i < limit; i++) {
        const a = projected[i];
        const b = projected[(i + 1) % n];
        if (!a || !b) continue;
        const sa = ndcToScreen(a.x, a.y, SVG_W, SVG_H);
        const sb = ndcToScreen(b.x, b.y, SVG_W, SVG_H);
        const ln = document.createElementNS(SVG_NS, "line");
        ln.setAttribute("x1", sa.x.toFixed(1));
        ln.setAttribute("y1", sa.y.toFixed(1));
        ln.setAttribute("x2", sb.x.toFixed(1));
        ln.setAttribute("y2", sb.y.toFixed(1));
        ln.setAttribute("stroke", stroke);
        ln.setAttribute("stroke-width", String(strokeWidth));
        group.append(ln);
      }
    }

    // ---- Room wireframe ----
    const roomGroup = document.createElementNS(SVG_NS, "g");
    roomGroup.setAttribute("class", "print-mode-preview-3d-room");
    svg.append(roomGroup);

    const ch = job.room.ceilingHeightMm;
    const floorPolyTop: Array<{ x: number; y: number; z: number }> = job.room.vertices.map(
      (v) => ({ x: v.xMm, y: v.yMm, z: ch }),
    );
    const floorPolyBottom: Array<{ x: number; y: number; z: number }> = job.room.vertices.map(
      (v) => ({ x: v.xMm, y: v.yMm, z: 0 }),
    );
    projectAndDraw(roomGroup, floorPolyTop, "rgba(220,228,240,0.55)", 1, true);
    projectAndDraw(roomGroup, floorPolyBottom, "rgba(220,228,240,0.30)", 1, true);
    // Vertical wall edges.
    for (let i = 0; i < job.room.vertices.length; i++) {
      const a = floorPolyBottom[i];
      const b = floorPolyTop[i];
      if (!a || !b) continue;
      projectAndDraw(roomGroup, [a, b], "rgba(220,228,240,0.40)", 1, false);
    }

    // ---- Tile borders + labels (per enabled surface) ----
    const tileGroup = document.createElementNS(SVG_NS, "g");
    tileGroup.setAttribute("class", "print-mode-preview-3d-tiles");
    svg.append(tileGroup);

    if (scene) {
      // Group tiles by surface so we can resolve uv→world per-surface
      // without re-finding the surface every iteration.
      const surfaceById = new Map<string, Surface>();
      for (const s of allSurfaces) surfaceById.set(s.id, s);
      for (const tile of scene.tiles) {
        const surface = surfaceById.get(tile.surfaceId);
        if (!surface) continue;
        const b = tile.tileBoundsMm;
        const corners3d = [
          surfaceUVToWorld(surface, b.uMinMm, b.vMinMm),
          surfaceUVToWorld(surface, b.uMaxMm, b.vMinMm),
          surfaceUVToWorld(surface, b.uMaxMm, b.vMaxMm),
          surfaceUVToWorld(surface, b.uMinMm, b.vMaxMm),
        ];
        projectAndDraw(tileGroup, corners3d, "rgba(240,192,64,0.85)", 1, true);

        // Tile label at centre — skipped during drag (text nodes are
        // cheap individually but we have ~150 of them per frame).
        if (isDragging) continue;
        const cx = (b.uMinMm + b.uMaxMm) / 2;
        const cv = (b.vMinMm + b.vMaxMm) / 2;
        const centre = surfaceUVToWorld(surface, cx, cv);
        const proj = projectPoint(camera, centre.x, centre.y, centre.z, aspect);
        if (proj) {
          const sp = ndcToScreen(proj.x, proj.y, SVG_W, SVG_H);
          const label = document.createElementNS(SVG_NS, "text");
          label.setAttribute("x", sp.x.toFixed(1));
          label.setAttribute("y", sp.y.toFixed(1));
          label.setAttribute("text-anchor", "middle");
          label.setAttribute("dominant-baseline", "middle");
          label.setAttribute("font-size", "9");
          label.setAttribute("fill", "rgba(240,192,64,0.95)");
          label.setAttribute("font-family", "var(--font-mono)");
          label.setAttribute("pointer-events", "none");
          label.textContent = `${surfaceShortLabel(surface)} ${tile.row},${tile.col}`;
          tileGroup.append(label);
        }
      }
    }

    // ---- Star holes (per surface) ----
    const holeGroup = document.createElementNS(SVG_NS, "g");
    holeGroup.setAttribute("class", "print-mode-preview-3d-holes");
    svg.append(holeGroup);

    if (scene && !isDragging) {
      const surfaceById = new Map<string, Surface>();
      for (const s of allSurfaces) surfaceById.set(s.id, s);
      // Use a small set to dedupe holes appearing in multiple tiles
      // (we kept the primary tile only above, but be defensive).
      const seen = new Set<string>();
      for (const tile of scene.tiles) {
        const surface = surfaceById.get(tile.surfaceId);
        if (!surface) continue;
        for (const hole of tile.holes) {
          const key = `${surface.id}|${hole.surfaceUMm.toFixed(2)}|${hole.surfaceVMm.toFixed(2)}|${hole.label}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const w = surfaceUVToWorld(surface, hole.surfaceUMm, hole.surfaceVMm);
          const proj = projectPoint(camera, w.x, w.y, w.z, aspect);
          if (!proj) continue;
          const sp = ndcToScreen(proj.x, proj.y, SVG_W, SVG_H);
          // Radius scales with hole size class (visual cue, not 1:1
          // physical) AND inversely with depth so distant holes are
          // smaller. Cap at sane bounds.
          const baseDiam = HOLE_DIAMETERS_MM[hole.sizeClass];
          // Project a 1-mm vector at the hole's screen position to get
          // a depth-correct mm→px scale.
          const f = 1 / Math.tan(camera.fovY / 2);
          const pxPerMm = (f * (SVG_H / 2)) / proj.depth;
          const r = Math.max(0.6, Math.min(8, baseDiam * pxPerMm * 0.5));
          const dot = document.createElementNS(SVG_NS, "circle");
          dot.setAttribute("cx", sp.x.toFixed(1));
          dot.setAttribute("cy", sp.y.toFixed(1));
          dot.setAttribute("r", r.toFixed(2));
          dot.setAttribute("fill", "#ffffff");
          dot.setAttribute("class", "print-mode-preview-3d-hole");
          holeGroup.append(dot);
        }
      }
    }

    // ---- Observer "you are here" crosshair at screen centre ----
    const crossGroup = document.createElementNS(SVG_NS, "g");
    crossGroup.setAttribute("class", "print-mode-preview-3d-crosshair");
    const cx = SVG_W / 2;
    const cy = SVG_H / 2;
    const armLen = 8;
    const cross1 = document.createElementNS(SVG_NS, "line");
    cross1.setAttribute("x1", String(cx - armLen));
    cross1.setAttribute("y1", String(cy));
    cross1.setAttribute("x2", String(cx + armLen));
    cross1.setAttribute("y2", String(cy));
    cross1.setAttribute("stroke", "var(--accent)");
    cross1.setAttribute("stroke-width", "1.5");
    const cross2 = document.createElementNS(SVG_NS, "line");
    cross2.setAttribute("x1", String(cx));
    cross2.setAttribute("y1", String(cy - armLen));
    cross2.setAttribute("x2", String(cx));
    cross2.setAttribute("y2", String(cy + armLen));
    cross2.setAttribute("stroke", "var(--accent)");
    cross2.setAttribute("stroke-width", "1.5");
    crossGroup.append(cross1, cross2);
    svg.append(crossGroup);
  }

  // ---- Refresh on store change ----
  const refresh = (): void => {
    // If the camera's pivot is still the previous observer's eye,
    // sync to the new one so the preview tracks edits to the room.
    const job = getPrintJob();
    camera.posX = job.room.observerPositionMm.xMm;
    camera.posY = job.room.observerPositionMm.yMm;
    camera.posZ = job.room.observerPositionMm.eyeHeightMm;

    const snap = JSON.stringify(job);
    if (snap !== sceneJobSnapshot) {
      // Job changed — invalidate scene; only rebuild on demand.
      // (We keep the previous scene visible so the panel doesn't go
      // blank during edits; the user clicks Refresh stars to recompute.)
      if (scene !== null) {
        setStatus("Room or observation changed — click Refresh stars.");
      }
    }
    render();
  };
  register(refresh);

  // First paint without stars (waiting for user to click Refresh).
  render();
  setStatus("Click Refresh stars to compute the preview.");
}
