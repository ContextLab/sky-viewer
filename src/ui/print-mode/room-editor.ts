// T032 — SVG floor-plan room editor for Print Mode.
//
// US1 subset:
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
// All edits commit through `setPrintJob`. The editor re-paints on every
// store change via the registered refresh callback.

import { getPrintJob, setPrintJob } from "../../print/print-job-store";
import type { RegisterRefresh } from "./print-mode";

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

  const vertexGroup = svgEl("g", { class: "print-mode-vertices" }) as SVGGElement;
  root.append(vertexGroup);

  const observerHandle = svgEl("g", {
    class: "print-mode-observer",
    role: "button",
    "aria-label": "Observer position",
    tabindex: 0,
  }) as SVGGElement;
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
    "Drag vertices to resize. Double-click a segment to add a vertex; right-click a vertex to remove it. Drag the dot to move the observer.";
  panel.append(svgWrap, hint);

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
  type DragMode = { kind: "vertex"; index: number } | { kind: "observer" };
  let drag: DragMode | null = null;
  let activePointer: number | null = null;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressIndex = -1;

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
    }

    // Vertices.
    vertexGroup.replaceChildren();
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i];
      if (!v) continue;
      const p = mmToSvg(v.xMm, v.yMm);
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
