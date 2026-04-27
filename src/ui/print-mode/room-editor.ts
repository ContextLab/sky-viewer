// T032 / T054 — SVG floor-plan room editor for Print Mode.
//
// US1 subset (T032):
//   - "Use template → Rectangle 12×12 ft" button.
//   - Draggable polygon vertices (mouse + touch via pointer events).
//   - Double-click on a segment inserts a new vertex at the click point.
//   - Right-click (or long-press) on a vertex deletes it (only if ≥4
//     remain after deletion).
//   - Draggable observer-position handle (defaulting to centroid).
//   - Numeric ceiling-height input (1500..6000 mm).
//   - Numeric observer eye-height input (1000..2200 mm).
//   - Display-units-aware labels (ft vs m).
//
// US3 extension (T054):
//   - Segment-translation drag: dragging the middle of a segment
//     translates BOTH endpoint vertices along the segment's outward
//     normal so the wall slides parallel to itself.
//   - Ceiling-feature edit handles: when a ceiling feature is shown in
//     the floor plan, dragging its body translates it; corner handles
//     resize. Edit happens via patches to the feature's outline.
//
// All edits commit through `setPrintJob`. The editor re-paints on every
// store change via the registered refresh callback.

import { getPrintJob, setPrintJob } from "../../print/print-job-store";
import { deriveSurfaces } from "../../print/projection";
import { mountWallElevation } from "./wall-elevation";
import type { RegisterRefresh } from "./print-mode";
import type { RoomFeature } from "../../print/types";

type PendingFeatureType = "window" | "door" | "closet";

// Default sizes per FR-005 / common construction sizes (Issue #2).
const PENDING_FEATURE_DEFAULTS: Record<
  PendingFeatureType,
  { widthMm: number; heightMm: number; sillMm: number }
> = {
  window: { widthMm: 600, heightMm: 900, sillMm: 900 },
  door: { widthMm: 900, heightMm: 2030, sillMm: 0 },
  closet: { widthMm: 1200, heightMm: 2030, sillMm: 0 },
};

const SVG_NS = "http://www.w3.org/2000/svg";
const MM_PER_FT = 304.8;
const FT_12_MM = 12 * MM_PER_FT; // 3657.6

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function mmToDisplay(mm: number, units: "imperial" | "metric"): string {
  if (units === "imperial") {
    return `${(mm / MM_PER_FT).toFixed(2)} ft`;
  }
  return `${(mm / 1000).toFixed(2)} m`;
}

interface Vertex {
  xMm: number;
  yMm: number;
}

export function mountRoomEditor(host: HTMLElement, register: RegisterRefresh): void {
  const panel = document.createElement("section");
  panel.className = "print-mode-panel print-mode-room-editor";

  const heading = document.createElement("h2");
  heading.className = "print-mode-panel-heading";
  heading.textContent = "Room";
  panel.append(heading);

  // ---- Template + dimension controls ----
  const controls = document.createElement("div");
  controls.className = "print-mode-row";

  const templateBtn = document.createElement("button");
  templateBtn.type = "button";
  templateBtn.className = "print-mode-secondary";
  templateBtn.textContent = "Use template → Rectangle 12 × 12 ft";
  templateBtn.title = "Reset the floor plan to a 12 × 12 ft rectangle";
  controls.append(templateBtn);

  panel.append(controls);

  templateBtn.addEventListener("click", () => {
    const half = FT_12_MM / 2;
    setPrintJob({
      room: {
        vertices: [
          { xMm: -half, yMm: -half },
          { xMm: half, yMm: -half },
          { xMm: half, yMm: half },
          { xMm: -half, yMm: half },
        ],
        observerPositionMm: {
          xMm: 0,
          yMm: 0,
          eyeHeightMm: getPrintJob().room.observerPositionMm.eyeHeightMm,
        },
      },
    });
  });

  // ---- Numeric inputs (ceiling height, eye height) ----
  const dimsRow = document.createElement("div");
  dimsRow.className = "print-mode-row print-mode-dims-row";

  const ceilingField = document.createElement("label");
  ceilingField.className = "print-mode-field";
  const ceilingSpan = document.createElement("span");
  ceilingSpan.textContent = "Ceiling height";
  const ceilingInput = document.createElement("input");
  ceilingInput.type = "number";
  ceilingInput.className = "print-mode-input";
  ceilingInput.min = "1500";
  ceilingInput.max = "6000";
  ceilingInput.step = "10";
  ceilingInput.setAttribute("aria-label", "Ceiling height in millimetres");
  const ceilingDisplay = document.createElement("span");
  ceilingDisplay.className = "print-mode-readout-inline";
  ceilingField.append(ceilingSpan, ceilingInput, ceilingDisplay);

  const eyeField = document.createElement("label");
  eyeField.className = "print-mode-field";
  const eyeSpan = document.createElement("span");
  eyeSpan.textContent = "Observer eye-height";
  const eyeInput = document.createElement("input");
  eyeInput.type = "number";
  eyeInput.className = "print-mode-input";
  eyeInput.min = "1000";
  eyeInput.max = "2200";
  eyeInput.step = "10";
  eyeInput.setAttribute("aria-label", "Observer eye height in millimetres");
  const eyeDisplay = document.createElement("span");
  eyeDisplay.className = "print-mode-readout-inline";
  eyeField.append(eyeSpan, eyeInput, eyeDisplay);

  dimsRow.append(ceilingField, eyeField);
  panel.append(dimsRow);

  ceilingInput.addEventListener("change", () => {
    const v = Number(ceilingInput.value);
    if (!Number.isFinite(v)) return;
    setPrintJob({ room: { ceilingHeightMm: v } });
  });
  eyeInput.addEventListener("change", () => {
    const v = Number(eyeInput.value);
    if (!Number.isFinite(v)) return;
    const job = getPrintJob();
    setPrintJob({
      room: {
        observerPositionMm: {
          xMm: job.room.observerPositionMm.xMm,
          yMm: job.room.observerPositionMm.yMm,
          eyeHeightMm: v,
        },
      },
    });
  });

  // ---- SVG floor plan ----
  const svgWrap = document.createElement("div");
  svgWrap.className = "print-mode-svg-wrap";

  const SVG_SIZE = 360;
  const root = svgEl("svg", {
    class: "print-mode-svg",
    width: SVG_SIZE,
    height: SVG_SIZE,
    viewBox: `0 0 ${SVG_SIZE} ${SVG_SIZE}`,
    role: "application",
    "aria-label": "Room floor plan editor",
  }) as SVGSVGElement;
  // Background grid + outline groups.
  const bg = svgEl("rect", {
    x: 0,
    y: 0,
    width: SVG_SIZE,
    height: SVG_SIZE,
    fill: "rgba(255,255,255,0.03)",
    stroke: "rgba(255,255,255,0.10)",
    "stroke-width": 1,
  });
  root.append(bg);

  const polygonEl = svgEl("polygon", {
    class: "print-mode-polygon",
    fill: "rgba(245, 215, 110, 0.08)",
    stroke: "var(--accent)",
    "stroke-width": 1.5,
  }) as SVGPolygonElement;
  root.append(polygonEl);

  const segmentsGroup = svgEl("g", { class: "print-mode-segments" }) as SVGGElement;
  root.append(segmentsGroup);

  const segmentMidGroup = svgEl("g", { class: "print-mode-segment-mids" }) as SVGGElement;
  root.append(segmentMidGroup);

  const featuresGroup = svgEl("g", { class: "print-mode-floor-features" }) as SVGGElement;
  root.append(featuresGroup);

  const vertexGroup = svgEl("g", { class: "print-mode-vertices" }) as SVGGElement;
  root.append(vertexGroup);

  const observerHandle = svgEl("g", {
    class: "print-mode-observer",
    role: "button",
    "aria-label": "Observer position",
    tabindex: 0,
  }) as SVGGElement;
  // T058: invisible 22-px-radius hit area for tap targets ≥ 44 x 44 px.
  observerHandle.append(
    svgEl("circle", {
      cx: 0,
      cy: 0,
      r: 26,
      fill: "transparent",
      class: "print-mode-observer-hit",
    }),
  );
  observerHandle.append(
    svgEl("circle", {
      cx: 0,
      cy: 0,
      r: 8,
      fill: "var(--accent)",
      stroke: "#111",
      "stroke-width": 1.5,
    }),
  );
  observerHandle.append(
    svgEl("circle", {
      cx: 0,
      cy: 0,
      r: 3,
      fill: "#111",
    }),
  );
  root.append(observerHandle);

  svgWrap.append(root);

  const hint = document.createElement("p");
  hint.className = "print-mode-helper";
  hint.textContent =
    "Drag vertices to resize (Shift snaps to 90 deg, Cmd/Ctrl-click to multi-select). Double-click a segment to add a vertex; right-click a vertex to remove it. Click a wall to edit its elevation. Drag the dot to move the observer.";
  panel.append(svgWrap, hint);

  // Wall-elevation host - populated when a wall segment is clicked.
  const elevationHost = document.createElement("div");
  elevationHost.className = "print-mode-wall-elevation-host";
  panel.append(elevationHost);
  let elevationUnsub: (() => void) | null = null;

  function openWallElevation(wallId: string): void {
    if (elevationUnsub) {
      elevationUnsub();
      elevationUnsub = null;
    }
    elevationUnsub = mountWallElevation(elevationHost, wallId);
  }

  // Issue #2 — Listen for the feature-panel's "Add window/door/closet"
  // arming events so we know to drop a default-sized feature on the
  // next wall click instead of just opening the elevation panel.
  let pendingFeatureType: PendingFeatureType | null = null;
  const onPending = (ev: Event): void => {
    const ce = ev as CustomEvent<{ type: PendingFeatureType | null }>;
    pendingFeatureType = ce.detail.type;
  };
  document.addEventListener("print-mode:pending-feature", onPending);

  /**
   * Place a default-sized feature of `type` centred on `wallId`. Enables
   * the wall (so the projection includes it). Returns the new feature id.
   */
  function placePendingFeatureOnWall(
    type: PendingFeatureType,
    wallId: string,
  ): string | null {
    const job = getPrintJob();
    const surfaces = deriveSurfaces(job.room, job.outputOptions.blockHorizonOnWalls);
    const wall = surfaces.find((s) => s.id === wallId && s.kind === "wall");
    if (!wall) return null;
    const def = PENDING_FEATURE_DEFAULTS[type];
    // Clamp to the wall's actual extents.
    const widthMm = Math.min(def.widthMm, Math.max(50, wall.widthMm - 50));
    const heightMm = Math.min(def.heightMm, Math.max(50, wall.heightMm - 50));
    const sillMm = Math.min(def.sillMm, Math.max(0, wall.heightMm - heightMm));
    const uMin = Math.max(0, (wall.widthMm - widthMm) / 2);
    const uMax = uMin + widthMm;
    const vMin = sillMm;
    const vMax = sillMm + heightMm;
    const labelBase = type === "window" ? "Window" : type === "door" ? "Door" : "Closet";
    const re = new RegExp("^" + labelBase + "\\s+(\\d+)\\s*$");
    let max = 0;
    for (const f of job.room.features) {
      if (f.type !== type) continue;
      const m = f.label.match(re);
      if (m && m[1]) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
    const id = `feat-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xfffff).toString(36)}`;
    const newFeature: RoomFeature = {
      id,
      type,
      label: labelBase + " " + (max + 1),
      surfaceId: wallId,
      outline: [
        { uMm: uMin, vMm: vMin },
        { uMm: uMax, vMm: vMin },
        { uMm: uMax, vMm: vMax },
        { uMm: uMin, vMm: vMax },
      ],
      paint: false,
    };
    // Also enable the wall so the user immediately sees it accounted for.
    const wallsEnabled = { ...(job.room.surfaceEnable.walls ?? {}) };
    wallsEnabled[wallId] = true;
    setPrintJob({
      room: {
        features: [...job.room.features, newFeature],
        surfaceEnable: {
          ceiling: job.room.surfaceEnable.ceiling,
          floor: job.room.surfaceEnable.floor,
          walls: wallsEnabled,
        },
      },
    });
    return id;
  }

  host.append(panel);

  // ---- View-transform helpers ----
  // Map room mm coords to SVG coords, fitting bbox into SVG_SIZE-padding.
  const PAD = 30;
  let viewport = {
    xMin: -FT_12_MM / 2,
    xMax: FT_12_MM / 2,
    yMin: -FT_12_MM / 2,
    yMax: FT_12_MM / 2,
    scale: 1,
  };

  function recomputeViewport(vertices: ReadonlyArray<Vertex>): void {
    if (vertices.length === 0) return;
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const v of vertices) {
      if (v.xMm < xMin) xMin = v.xMm;
      if (v.xMm > xMax) xMax = v.xMm;
      if (v.yMm < yMin) yMin = v.yMm;
      if (v.yMm > yMax) yMax = v.yMm;
    }
    const w = Math.max(1, xMax - xMin);
    const h = Math.max(1, yMax - yMin);
    const usable = SVG_SIZE - PAD * 2;
    const scale = Math.min(usable / w, usable / h);
    viewport = { xMin, xMax, yMin, yMax, scale };
  }

  function mmToSvg(xMm: number, yMm: number): { x: number; y: number } {
    const w = viewport.xMax - viewport.xMin;
    const h = viewport.yMax - viewport.yMin;
    const cx = SVG_SIZE / 2;
    const cy = SVG_SIZE / 2;
    // Centre the floor plan in the SVG. y flips: room +y = North = up in SVG.
    const x = cx + (xMm - (viewport.xMin + w / 2)) * viewport.scale;
    const y = cy - (yMm - (viewport.yMin + h / 2)) * viewport.scale;
    return { x, y };
  }

  function svgToMm(svgX: number, svgY: number): { xMm: number; yMm: number } {
    const w = viewport.xMax - viewport.xMin;
    const h = viewport.yMax - viewport.yMin;
    const cx = SVG_SIZE / 2;
    const cy = SVG_SIZE / 2;
    const xMm = (svgX - cx) / viewport.scale + (viewport.xMin + w / 2);
    const yMm = -(svgY - cy) / viewport.scale + (viewport.yMin + h / 2);
    return { xMm, yMm };
  }

  function clientToSvgPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = root.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * SVG_SIZE;
    const y = ((clientY - rect.top) / rect.height) * SVG_SIZE;
    return { x, y };
  }

  // ---- Drag state ----
  type DragMode =
    | { kind: "vertex"; index: number }
    | { kind: "observer" }
    | {
        kind: "segment";
        index: number;
        startA: Vertex;
        startB: Vertex;
        startMm: { xMm: number; yMm: number };
      }
    | {
        kind: "feature-body";
        featureId: string;
        startMm: { xMm: number; yMm: number };
        startOutline: ReadonlyArray<{ uMm: number; vMm: number }>;
        bbox: { uMin: number; uMax: number; vMin: number; vMax: number };
      }
    | {
        kind: "feature-handle";
        featureId: string;
        handle: "nw" | "ne" | "se" | "sw" | "n" | "e" | "s" | "w";
        startMm: { xMm: number; yMm: number };
        startOutline: ReadonlyArray<{ uMm: number; vMm: number }>;
        bbox: { uMin: number; uMax: number; vMin: number; vMax: number };
      };
  let drag: DragMode | null = null;
  let activePointer: number | null = null;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressIndex = -1;
  let selectedFeatureId: string | null = null;

  function deleteVertex(index: number): void {
    const job = getPrintJob();
    if (job.room.vertices.length <= 4) return;
    const next = job.room.vertices.slice();
    next.splice(index, 1);
    setPrintJob({ room: { vertices: next } });
  }

  function insertVertexAt(segmentIndex: number, ptMm: { xMm: number; yMm: number }): void {
    const job = getPrintJob();
    const next = job.room.vertices.slice();
    next.splice(segmentIndex + 1, 0, { xMm: ptMm.xMm, yMm: ptMm.yMm });
    setPrintJob({ room: { vertices: next } });
  }

  /**
   * Translate the two endpoints of segment `i` (between vertices i and
   * (i+1)%N) along the segment's outward normal so the wall slides
   * parallel to itself. The normal points away from the polygon
   * centroid (so dragging "outward" enlarges the room).
   */
  function translateSegment(
    segmentIndex: number,
    startA: Vertex,
    startB: Vertex,
    deltaMm: { dxMm: number; dyMm: number },
  ): void {
    const job = getPrintJob();
    const verts = job.room.vertices;
    if (verts.length < 3) return;
    const a = startA;
    const b = startB;
    // Segment direction unit vector.
    const sdx = b.xMm - a.xMm;
    const sdy = b.yMm - a.yMm;
    const sLen = Math.hypot(sdx, sdy);
    if (sLen < 1e-6) return;
    // Outward-pointing normal — pick the perpendicular direction
    // pointing away from the polygon centroid.
    let cx = 0;
    let cy = 0;
    for (const v of verts) {
      cx += v.xMm;
      cy += v.yMm;
    }
    cx /= verts.length;
    cy /= verts.length;
    const midX = (a.xMm + b.xMm) / 2;
    const midY = (a.yMm + b.yMm) / 2;
    let nx = -sdy / sLen;
    let ny = sdx / sLen;
    // Flip if pointing toward the centroid.
    if ((midX - cx) * nx + (midY - cy) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    // Project the cursor displacement onto the outward normal — so the
    // wall slides cleanly parallel to itself regardless of cursor jitter
    // along the segment direction.
    const proj = deltaMm.dxMm * nx + deltaMm.dyMm * ny;
    const offsX = nx * proj;
    const offsY = ny * proj;
    const next = verts.slice();
    const idxA = segmentIndex;
    const idxB = (segmentIndex + 1) % verts.length;
    next[idxA] = { xMm: a.xMm + offsX, yMm: a.yMm + offsY };
    next[idxB] = { xMm: b.xMm + offsX, yMm: b.yMm + offsY };
    setPrintJob({ room: { vertices: next } });
  }

  function bboxOfOutline(
    outline: ReadonlyArray<{ uMm: number; vMm: number }>,
  ): { uMin: number; uMax: number; vMin: number; vMax: number } {
    let uMin = Infinity;
    let uMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const p of outline) {
      if (p.uMm < uMin) uMin = p.uMm;
      if (p.uMm > uMax) uMax = p.uMm;
      if (p.vMm < vMin) vMin = p.vMm;
      if (p.vMm > vMax) vMax = p.vMm;
    }
    return { uMin, uMax, vMin, vMax };
  }

  /**
   * Convert ceiling-surface (u, v) coords to floor-plan (x, y) coords.
   * The ceiling-surface origin sits at the floor-polygon bbox min; the
   * u-axis is +x and the v-axis is +y in room coordinates. (See
   * src/print/projection.ts § deriveSurfaces — ceiling/floor cases.)
   */
  function uvToRoomMm(uMm: number, vMm: number, xMin: number, yMin: number): { xMm: number; yMm: number } {
    return { xMm: xMin + uMm, yMm: yMin + vMm };
  }

  function updateFeatureOutline(
    featureId: string,
    nextOutline: Array<{ uMm: number; vMm: number }>,
  ): void {
    const job = getPrintJob();
    const next = job.room.features.map((f) =>
      f.id === featureId ? { ...f, outline: nextOutline } : f,
    );
    setPrintJob({ room: { features: next } });
  }

  function applyFeatureBodyDrag(
    featureId: string,
    startOutline: ReadonlyArray<{ uMm: number; vMm: number }>,
    duMm: number,
    dvMm: number,
  ): void {
    const next = startOutline.map((p) => ({ uMm: p.uMm + duMm, vMm: p.vMm + dvMm }));
    updateFeatureOutline(featureId, next);
  }

  function applyFeatureHandleDrag(
    featureId: string,
    handle: "nw" | "ne" | "se" | "sw" | "n" | "e" | "s" | "w",
    startBbox: { uMin: number; uMax: number; vMin: number; vMax: number },
    duMm: number,
    dvMm: number,
  ): void {
    let { uMin, uMax, vMin, vMax } = startBbox;
    const MIN = 50; // 5 cm minimum dimension
    if (handle.includes("w")) uMin = Math.min(uMin + duMm, uMax - MIN);
    if (handle.includes("e")) uMax = Math.max(uMax + duMm, uMin + MIN);
    if (handle.includes("n")) vMax = Math.max(vMax + dvMm, vMin + MIN);
    if (handle.includes("s")) vMin = Math.min(vMin + dvMm, vMax - MIN);
    const nextOutline = [
      { uMm: uMin, vMm: vMin },
      { uMm: uMax, vMm: vMin },
      { uMm: uMax, vMm: vMax },
      { uMm: uMin, vMm: vMax },
    ];
    updateFeatureOutline(featureId, nextOutline);
  }

  // ---- Render: ceiling feature with edit handles ----
  function renderCeilingFeature(f: RoomFeature, xMinMm: number, yMinMm: number): void {
    const bbox = bboxOfOutline(f.outline);
    const tl = uvToRoomMm(bbox.uMin, bbox.vMin, xMinMm, yMinMm);
    const br = uvToRoomMm(bbox.uMax, bbox.vMax, xMinMm, yMinMm);
    const ptl = mmToSvg(tl.xMm, tl.yMm);
    const pbr = mmToSvg(br.xMm, br.yMm);
    // SVG y-flip: the smaller v -> larger SVG y. Compute the SVG bbox.
    const svgX = Math.min(ptl.x, pbr.x);
    const svgY = Math.min(ptl.y, pbr.y);
    const svgW = Math.abs(pbr.x - ptl.x);
    const svgH = Math.abs(pbr.y - ptl.y);
    const isSelected = selectedFeatureId === f.id;
    const stroke = f.paint ? "rgba(120, 200, 120, 0.9)" : "rgba(245, 215, 110, 0.9)";
    const fill = f.paint ? "rgba(120, 200, 120, 0.18)" : "rgba(245, 215, 110, 0.18)";
    const body = svgEl("rect", {
      x: svgX,
      y: svgY,
      width: svgW,
      height: svgH,
      fill,
      stroke,
      "stroke-width": isSelected ? 2 : 1.2,
      "stroke-dasharray": f.paint ? "" : "4 2",
      class: "print-mode-feature-body",
      role: "button",
      "aria-label": `${f.label} (${f.paint ? "paint" : "no-paint"})`,
      tabindex: 0,
    }) as SVGRectElement;
    body.style.cursor = "move";
    body.dataset.featureId = f.id;
    body.addEventListener("pointerdown", (ev) => {
      if (activePointer !== null) return;
      ev.stopPropagation();
      ev.preventDefault();
      activePointer = ev.pointerId;
      selectedFeatureId = f.id;
      const sp = clientToSvgPoint(ev.clientX, ev.clientY);
      const mm = svgToMm(sp.x, sp.y);
      drag = {
        kind: "feature-body",
        featureId: f.id,
        startMm: mm,
        startOutline: f.outline.slice(),
        bbox,
      };
      body.setPointerCapture(ev.pointerId);
      // Force re-render to draw resize handles.
      render();
    });
    body.addEventListener("click", (ev) => {
      ev.stopPropagation();
      selectedFeatureId = selectedFeatureId === f.id ? null : f.id;
      render();
    });
    featuresGroup.append(body);

    const labelEl = svgEl("text", {
      x: svgX + svgW / 2,
      y: svgY + svgH / 2,
      "text-anchor": "middle",
      "dominant-baseline": "middle",
      "font-size": 10,
      fill: "var(--fg)",
      "font-family": "var(--font-mono)",
      "pointer-events": "none",
    });
    labelEl.textContent = f.label;
    featuresGroup.append(labelEl);

    if (!isSelected) return;

    // 8 resize handles: 4 corners + 4 edge midpoints. The handle's
    // direction maps to which edges the bbox should grow toward.
    const handles: Array<{
      x: number;
      y: number;
      dir: "nw" | "ne" | "se" | "sw" | "n" | "e" | "s" | "w";
      cursor: string;
    }> = [
      { x: svgX, y: svgY, dir: "nw", cursor: "nwse-resize" },
      { x: svgX + svgW, y: svgY, dir: "ne", cursor: "nesw-resize" },
      { x: svgX + svgW, y: svgY + svgH, dir: "se", cursor: "nwse-resize" },
      { x: svgX, y: svgY + svgH, dir: "sw", cursor: "nesw-resize" },
      { x: svgX + svgW / 2, y: svgY, dir: "n", cursor: "ns-resize" },
      { x: svgX + svgW, y: svgY + svgH / 2, dir: "e", cursor: "ew-resize" },
      { x: svgX + svgW / 2, y: svgY + svgH, dir: "s", cursor: "ns-resize" },
      { x: svgX, y: svgY + svgH / 2, dir: "w", cursor: "ew-resize" },
    ];
    for (const h of handles) {
      // For the floor-plan SVG, the v-axis flips between room +y and
      // svg-down. North-of-bbox in SVG space is the smallest y; the
      // u/v "n" handle (vMax) maps to that. The mapping is set
      // correctly because we computed svgX/svgY from min/max already.
      const handleEl = svgEl("rect", {
        x: h.x - 5,
        y: h.y - 5,
        width: 10,
        height: 10,
        fill: "var(--accent)",
        stroke: "#111",
        "stroke-width": 1,
        class: `print-mode-feature-handle print-mode-feature-handle-${h.dir}`,
      }) as SVGRectElement;
      handleEl.style.cursor = h.cursor;
      handleEl.dataset.featureId = f.id;
      handleEl.dataset.handleDir = h.dir;
      handleEl.addEventListener("pointerdown", (ev) => {
        if (activePointer !== null) return;
        ev.stopPropagation();
        ev.preventDefault();
        activePointer = ev.pointerId;
        const sp = clientToSvgPoint(ev.clientX, ev.clientY);
        const mm = svgToMm(sp.x, sp.y);
        // The "n" handle in svg-space corresponds to vMax (top of room
        // SVG = larger v). We mirror the n/s direction when computing
        // the actual u/v delta so the handle "grows" in the expected
        // direction. The mapping is encoded in applyFeatureHandleDrag.
        drag = {
          kind: "feature-handle",
          featureId: f.id,
          handle: h.dir,
          startMm: mm,
          startOutline: f.outline.slice(),
          bbox,
        };
        handleEl.setPointerCapture(ev.pointerId);
      });
      featuresGroup.append(handleEl);
    }
  }

  // ---- Render ----
  function render(): void {
    const job = getPrintJob();
    const verts = job.room.vertices;
    if (verts.length === 0) return;
    recomputeViewport(verts);

    // Polygon.
    const pts = verts
      .map((v) => {
        const p = mmToSvg(v.xMm, v.yMm);
        return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      })
      .join(" ");
    polygonEl.setAttribute("points", pts);

    // Segments (transparent thick clickable surfaces for dbl-click insert).
    segmentsGroup.replaceChildren();
    segmentMidGroup.replaceChildren();
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      if (!a || !b) continue;
      const pa = mmToSvg(a.xMm, a.yMm);
      const pb = mmToSvg(b.xMm, b.yMm);
      const seg = svgEl("line", {
        x1: pa.x,
        y1: pa.y,
        x2: pb.x,
        y2: pb.y,
        stroke: "transparent",
        "stroke-width": 14,
        class: "print-mode-segment-hit",
      }) as SVGLineElement;
      seg.style.cursor = "copy";
      seg.dataset.segmentIndex = String(i);
      seg.addEventListener("dblclick", (ev) => {
        ev.preventDefault();
        const sp = clientToSvgPoint(ev.clientX, ev.clientY);
        const mm = svgToMm(sp.x, sp.y);
        insertVertexAt(i, mm);
      });
      seg.addEventListener("click", (ev) => {
        ev.preventDefault();
        const wallId = `wall-${i}`;
        if (pendingFeatureType !== null) {
          const placed = placePendingFeatureOnWall(pendingFeatureType, wallId);
          // Tell the feature-panel to clear its armed state + button highlight.
          document.dispatchEvent(
            new CustomEvent("print-mode:feature-placed", {
              detail: { type: pendingFeatureType, wallId, featureId: placed },
            }),
          );
          pendingFeatureType = null;
        }
        openWallElevation(wallId);
      });
      segmentsGroup.append(seg);

      // Segment-length label centred between vertices.
      const midX = (pa.x + pb.x) / 2;
      const midY = (pa.y + pb.y) / 2;
      const segLenMm = Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm);
      const lenLabel = svgEl("text", {
        x: midX,
        y: midY - 4,
        "text-anchor": "middle",
        "font-size": 9,
        fill: "var(--fg-muted)",
        "font-family": "var(--font-mono)",
      });
      lenLabel.textContent = mmToDisplay(segLenMm, job.outputOptions.displayUnits);
      segmentsGroup.append(lenLabel);

      // T054: segment-translation drag handle (a small visible dot at
      // the midpoint that, when dragged, slides the wall parallel to
      // itself along its outward normal). Tap target is ≥ 12 px so it
      // remains usable on touch devices (SC-010 covered separately by
      // T058 mobile pass).
      const midHandle = svgEl("circle", {
        cx: midX,
        cy: midY,
        r: 7,
        fill: "rgba(245, 215, 110, 0.85)",
        stroke: "#111",
        "stroke-width": 1.5,
        class: "print-mode-segment-mid-handle",
        role: "button",
        "aria-label": `Drag wall ${i + 1} of ${verts.length}`,
        tabindex: 0,
      }) as SVGCircleElement;
      midHandle.style.cursor = "move";
      midHandle.dataset.segmentIndex = String(i);
      midHandle.addEventListener("pointerdown", (ev) => {
        if (activePointer !== null) return;
        ev.stopPropagation();
        ev.preventDefault();
        activePointer = ev.pointerId;
        const sp = clientToSvgPoint(ev.clientX, ev.clientY);
        const mm = svgToMm(sp.x, sp.y);
        drag = {
          kind: "segment",
          index: i,
          startA: { xMm: a.xMm, yMm: a.yMm },
          startB: { xMm: b.xMm, yMm: b.yMm },
          startMm: { xMm: mm.xMm, yMm: mm.yMm },
        };
        midHandle.setPointerCapture(ev.pointerId);
      });
      segmentMidGroup.append(midHandle);
    }

    // T054: ceiling-feature edit handles. Render the bounding box of
    // each ceiling feature on the floor plan with body-drag + 8 resize
    // handles when selected. Wall features are edited in the wall
    // elevation panel; floor features are uncommon in MVP.
    featuresGroup.replaceChildren();
    let xMin = Infinity;
    let yMin = Infinity;
    for (const v of verts) {
      if (v.xMm < xMin) xMin = v.xMm;
      if (v.yMm < yMin) yMin = v.yMm;
    }
    if (Number.isFinite(xMin) && Number.isFinite(yMin)) {
      for (const f of job.room.features) {
        if (f.surfaceId !== "ceiling") continue;
        renderCeilingFeature(f, xMin, yMin);
      }
    }

    // Vertices.
    vertexGroup.replaceChildren();
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i];
      if (!v) continue;
      const p = mmToSvg(v.xMm, v.yMm);
      // T058: invisible 26-px-radius hit area for ≥ 44 x 44 px tap target
      // (some viewport scales bring 22-px-radius below 44 px CSS; 26 is
      // a safe margin).
      const hitArea = svgEl("circle", {
        cx: p.x,
        cy: p.y,
        r: 26,
        fill: "transparent",
        class: "print-mode-vertex-hit",
        "pointer-events": "all",
      }) as SVGCircleElement;
      hitArea.dataset.vertexIndex = String(i);
      vertexGroup.append(hitArea);

      const handle = svgEl("circle", {
        cx: p.x,
        cy: p.y,
        r: 6,
        fill: "var(--accent)",
        stroke: "#111",
        "stroke-width": 1.5,
        class: "print-mode-vertex-handle",
        role: "button",
        "aria-label": `Vertex ${i + 1} of ${verts.length}`,
        tabindex: 0,
      }) as SVGCircleElement;
      handle.style.cursor = "grab";
      handle.dataset.vertexIndex = String(i);
      // Forward pointerdown from the larger invisible hit area onto
      // the visible handle's logic by listening on both.
      hitArea.style.cursor = "grab";
      hitArea.addEventListener("pointerdown", (ev) => {
        if (activePointer !== null) return;
        activePointer = ev.pointerId;
        drag = { kind: "vertex", index: i };
        hitArea.setPointerCapture(ev.pointerId);
        ev.preventDefault();
      });
      hitArea.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        deleteVertex(i);
      });

      handle.addEventListener("pointerdown", (ev) => {
        if (activePointer !== null) return;
        activePointer = ev.pointerId;
        drag = { kind: "vertex", index: i };
        handle.setPointerCapture(ev.pointerId);
        ev.preventDefault();
        // Long-press to delete on touch devices.
        if (ev.pointerType === "touch") {
          longPressIndex = i;
          longPressTimer = setTimeout(() => {
            longPressTimer = null;
            if (drag && drag.kind === "vertex" && drag.index === longPressIndex) {
              deleteVertex(longPressIndex);
              drag = null;
              activePointer = null;
              try {
                handle.releasePointerCapture(ev.pointerId);
              } catch {
                /* ignore */
              }
            }
          }, 600);
        }
      });
      handle.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        deleteVertex(i);
      });
      vertexGroup.append(handle);
    }

    // Observer handle.
    const obs = job.room.observerPositionMm;
    const op = mmToSvg(obs.xMm, obs.yMm);
    observerHandle.setAttribute("transform", `translate(${op.x.toFixed(1)} ${op.y.toFixed(1)})`);
    observerHandle.style.cursor = "grab";
  }

  // ---- Pointer move / up wired at the SVG root so capture works ----
  root.addEventListener("pointermove", (ev) => {
    if (drag === null || activePointer !== ev.pointerId) return;
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    const sp = clientToSvgPoint(ev.clientX, ev.clientY);
    const mm = svgToMm(sp.x, sp.y);
    const job = getPrintJob();
    if (drag.kind === "vertex") {
      const next = job.room.vertices.slice();
      const idx = drag.index;
      if (idx >= 0 && idx < next.length) {
        next[idx] = { xMm: mm.xMm, yMm: mm.yMm };
        setPrintJob({ room: { vertices: next } });
      }
    } else if (drag.kind === "observer") {
      setPrintJob({
        room: {
          observerPositionMm: {
            xMm: mm.xMm,
            yMm: mm.yMm,
            eyeHeightMm: job.room.observerPositionMm.eyeHeightMm,
          },
        },
      });
    } else if (drag.kind === "segment") {
      const dxMm = mm.xMm - drag.startMm.xMm;
      const dyMm = mm.yMm - drag.startMm.yMm;
      translateSegment(drag.index, drag.startA, drag.startB, { dxMm, dyMm });
    } else if (drag.kind === "feature-body") {
      const dxMm = mm.xMm - drag.startMm.xMm;
      const dyMm = mm.yMm - drag.startMm.yMm;
      // Ceiling-feature uv axes match room x/y (deriveSurfaces).
      applyFeatureBodyDrag(drag.featureId, drag.startOutline, dxMm, dyMm);
    } else if (drag.kind === "feature-handle") {
      const dxMm = mm.xMm - drag.startMm.xMm;
      const dyMm = mm.yMm - drag.startMm.yMm;
      // Ceiling u = +x, v = +y in room mm; resize directly.
      applyFeatureHandleDrag(drag.featureId, drag.handle, drag.bbox, dxMm, dyMm);
    }
  });
  const endPointer = (ev: PointerEvent): void => {
    if (activePointer !== ev.pointerId) return;
    activePointer = null;
    drag = null;
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };
  root.addEventListener("pointerup", endPointer);
  root.addEventListener("pointercancel", endPointer);

  // Observer-handle drag.
  observerHandle.addEventListener("pointerdown", (ev) => {
    if (activePointer !== null) return;
    activePointer = ev.pointerId;
    drag = { kind: "observer" };
    observerHandle.setPointerCapture(ev.pointerId);
    ev.preventDefault();
    ev.stopPropagation();
  });

  // ---- Refresh ----
  const refresh = (): void => {
    const job = getPrintJob();
    if (Number(ceilingInput.value) !== job.room.ceilingHeightMm) {
      ceilingInput.value = String(job.room.ceilingHeightMm);
    }
    if (Number(eyeInput.value) !== job.room.observerPositionMm.eyeHeightMm) {
      eyeInput.value = String(job.room.observerPositionMm.eyeHeightMm);
    }
    ceilingDisplay.textContent = mmToDisplay(
      job.room.ceilingHeightMm,
      job.outputOptions.displayUnits,
    );
    eyeDisplay.textContent = mmToDisplay(
      job.room.observerPositionMm.eyeHeightMm,
      job.outputOptions.displayUnits,
    );
    render();
  };
  register(refresh);
}
