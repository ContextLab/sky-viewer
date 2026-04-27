// T043 — Wall elevation panel for Print Mode (US2).
//
// Mounts an SVG-based wall elevation editor for ONE wall (identified by
// `wallId`). The wall is shown as a flat rectangle (height = ceiling
// height, width = segment length). The user click-drags rectangles to
// place windows, doors, or closet openings; each placed feature has a
// per-feature paint/no-paint toggle and a free-text label.
//
// Defaults per FR-005:
//   - window: paint = false
//   - door:   paint = false
//   - closet: paint = false
//
// Each created feature:
//   - id: stable random identifier
//   - type: 'window' | 'door' | 'closet'
//   - surfaceId: the wallId argument verbatim (e.g. "wall-2")
//   - outline: rectangle in wall-local (u, v) coords, mm
//   - label: a sensible default ("Window 1", "Door 2", …)
//
// The panel re-renders whenever the print-job-store updates so external
// edits to the feature list (e.g. delete from the feature-panel) reflect
// here too. We subscribe at mount; callers responsible for unmounting
// the host element when the wall selection changes.

import { getPrintJob, setPrintJob, subscribe } from "../../print/print-job-store";
import { deriveSurfaces } from "../../print/projection";
import type { RoomFeature, Surface } from "../../print/types";

const SVG_NS = "http://www.w3.org/2000/svg";

type AddType = "window" | "door" | "closet";

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function makeId(): string {
  return `feat-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xfffff).toString(36)}`;
}

function nextLabelFor(
  type: AddType,
  features: ReadonlyArray<RoomFeature>,
): string {
  const base =
    type === "window" ? "Window" : type === "door" ? "Door" : "Closet";
  // Build the pattern via plain string concatenation rather than a
  // template literal so the bundled output never contains a `$` byte
  // immediately followed by a backtick — that sequence is interpreted
  // as a back-reference by String.prototype.replace, which broke the
  // build's HTML inliner before tools/inline-html.mjs was hardened.
  const pattern = "^" + base + "\\s+(\\d+)\\s*$";
  const re = new RegExp(pattern);
  let max = 0;
  for (const f of features) {
    if (f.type !== type) continue;
    const m = f.label.match(re);
    if (m && m[1]) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return base + " " + (max + 1);
}

/**
 * Mount the wall elevation editor for `wallId` into `host`. Returns an
 * unsubscribe function the caller can invoke to detach the store
 * listener (the DOM is removed by clearing `host.replaceChildren()`).
 */
export function mountWallElevation(
  host: HTMLElement,
  wallId: string,
): () => void {
  // Container.
  const panel = document.createElement("section");
  panel.className = "print-mode-panel print-mode-wall-elevation";

  const heading = document.createElement("h2");
  heading.className = "print-mode-panel-heading";
  panel.append(heading);

  const helper = document.createElement("p");
  helper.className = "print-mode-helper";
  helper.textContent =
    "Drag inside the wall elevation to place a feature. Use the buttons to choose what kind of feature to add next.";
  panel.append(helper);

  // ---- Add-type selector row ----
  const addRow = document.createElement("div");
  addRow.className = "print-mode-row";

  let nextAddType: AddType = "window";

  function makeAddButton(type: AddType, label: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "print-mode-secondary";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      nextAddType = type;
      reflectActiveType();
    });
    return btn;
  }

  const winBtn = makeAddButton("window", "Add window");
  const doorBtn = makeAddButton("door", "Add door");
  const closetBtn = makeAddButton("closet", "Add closet");
  addRow.append(winBtn, doorBtn, closetBtn);
  panel.append(addRow);

  function reflectActiveType(): void {
    for (const [btn, t] of [
      [winBtn, "window"],
      [doorBtn, "door"],
      [closetBtn, "closet"],
    ] as Array<[HTMLButtonElement, AddType]>) {
      btn.setAttribute("aria-pressed", String(t === nextAddType));
    }
  }
  reflectActiveType();

  // ---- SVG elevation canvas ----
  const svgWrap = document.createElement("div");
  svgWrap.className = "print-mode-svg-wrap";
  const SVG_WIDTH = 360;
  const SVG_HEIGHT = 200;
  const SVG_PAD = 16;
  const root = svgEl("svg", {
    class: "print-mode-svg print-mode-wall-svg",
    width: SVG_WIDTH,
    height: SVG_HEIGHT,
    viewBox: `0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`,
    role: "application",
    "aria-label": "Wall elevation editor",
  }) as SVGSVGElement;
  root.append(
    svgEl("rect", {
      x: 0,
      y: 0,
      width: SVG_WIDTH,
      height: SVG_HEIGHT,
      fill: "rgba(255,255,255,0.03)",
      stroke: "rgba(255,255,255,0.10)",
      "stroke-width": 1,
    }),
  );
  const wallRect = svgEl("rect", {
    fill: "rgba(245, 215, 110, 0.06)",
    stroke: "var(--accent)",
    "stroke-width": 1.5,
    class: "print-mode-wall-rect",
  }) as SVGRectElement;
  root.append(wallRect);
  const featuresGroup = svgEl("g", {
    class: "print-mode-wall-features",
  }) as SVGGElement;
  root.append(featuresGroup);
  const dragRect = svgEl("rect", {
    fill: "rgba(245, 215, 110, 0.30)",
    stroke: "var(--accent)",
    "stroke-width": 1,
    "stroke-dasharray": "4 3",
    visibility: "hidden",
    "pointer-events": "none",
    class: "print-mode-wall-drag-rect",
  }) as SVGRectElement;
  root.append(dragRect);
  svgWrap.append(root);
  panel.append(svgWrap);

  // ---- Numeric editor for the currently selected feature (Issue #4) ----
  // When the user clicks a feature row in the wall-elevation list (or
  // the rectangle in the SVG), we expose 4 numeric inputs:
  //   - Sill height (mm above floor) = bottom edge = vMin
  //   - Height (mm) = vMax - vMin
  //   - Width (mm) = uMax - uMin
  //   - Horizontal position (mm from wall left) = uMin
  // Editing any of these patches the feature's outline. Non-rectangular
  // outlines disable the editor with a tooltip.
  const numericPanel = document.createElement("div");
  numericPanel.className = "print-mode-feature-numeric";
  numericPanel.hidden = true;
  const numericTitle = document.createElement("h3");
  numericTitle.className = "print-mode-feature-numeric-title";
  numericTitle.textContent = "Edit selected feature";
  numericPanel.append(numericTitle);
  const numericGrid = document.createElement("div");
  numericGrid.className = "print-mode-feature-numeric-grid";

  function makeNumField(
    labelText: string,
    suffix: string,
    aria: string,
  ): { wrap: HTMLLabelElement; input: HTMLInputElement } {
    const wrap = document.createElement("label");
    wrap.className = "print-mode-field";
    const span = document.createElement("span");
    span.textContent = labelText;
    const input = document.createElement("input");
    input.type = "number";
    input.className = "print-mode-input";
    input.step = "10";
    input.min = "0";
    input.setAttribute("aria-label", aria);
    const sfx = document.createElement("span");
    sfx.className = "print-mode-suffix";
    sfx.textContent = suffix;
    wrap.append(span, input, sfx);
    return { wrap, input };
  }

  const sillField = makeNumField("Sill height", "mm", "Sill height in millimetres above the floor");
  const heightField = makeNumField("Height", "mm", "Feature height in millimetres");
  const widthField = makeNumField("Width", "mm", "Feature width in millimetres");
  const xField = makeNumField("Horizontal position", "mm", "Horizontal position in millimetres from the wall's left edge");
  numericGrid.append(sillField.wrap, heightField.wrap, widthField.wrap, xField.wrap);
  numericPanel.append(numericGrid);
  const numericNote = document.createElement("p");
  numericNote.className = "print-mode-helper";
  panel.append(numericPanel);
  numericPanel.append(numericNote);

  let selectedFeatureId: string | null = null;

  function getSelectedFeature(): RoomFeature | null {
    if (!selectedFeatureId) return null;
    const job = getPrintJob();
    return job.room.features.find((f) => f.id === selectedFeatureId) ?? null;
  }

  /**
   * If the outline is exactly 4 corners and forms an axis-aligned
   * rectangle, return its bbox; otherwise null (numeric editor is then
   * disabled with a tooltip explanation).
   */
  function rectBboxOf(
    outline: ReadonlyArray<{ uMm: number; vMm: number }>,
  ): { uMin: number; uMax: number; vMin: number; vMax: number } | null {
    if (outline.length !== 4) return null;
    const us = outline.map((p) => p.uMm).sort((a, b) => a - b);
    const vs = outline.map((p) => p.vMm).sort((a, b) => a - b);
    if (us[0] === undefined || us[3] === undefined || vs[0] === undefined || vs[3] === undefined) return null;
    const uMin = us[0];
    const uMax = us[3];
    const vMin = vs[0];
    const vMax = vs[3];
    // Each point's u must be uMin or uMax, each v must be vMin or vMax.
    let mins = 0;
    let maxs = 0;
    for (const p of outline) {
      if (p.uMm !== uMin && p.uMm !== uMax) return null;
      if (p.vMm !== vMin && p.vMm !== vMax) return null;
      if (p.uMm === uMin) mins++;
      if (p.uMm === uMax) maxs++;
    }
    // Two corners on each side ⇒ rectangle.
    if (mins !== 2 || maxs !== 2) return null;
    if (uMax <= uMin || vMax <= vMin) return null;
    return { uMin, uMax, vMin, vMax };
  }

  function applyNumericEdit(): void {
    const f = getSelectedFeature();
    if (!f) return;
    const sill = Number(sillField.input.value);
    const heightMm = Number(heightField.input.value);
    const widthMm = Number(widthField.input.value);
    const xLeft = Number(xField.input.value);
    if (![sill, heightMm, widthMm, xLeft].every((v) => Number.isFinite(v))) return;
    const uMin = Math.max(0, Math.min(wallWidthMm - 50, xLeft));
    const widthClamped = Math.max(50, Math.min(wallWidthMm - uMin, widthMm));
    const uMax = uMin + widthClamped;
    const vMin = Math.max(0, Math.min(wallHeightMm - 50, sill));
    const heightClamped = Math.max(50, Math.min(wallHeightMm - vMin, heightMm));
    const vMax = vMin + heightClamped;
    const nextOutline = [
      { uMm: uMin, vMm: vMin },
      { uMm: uMax, vMm: vMin },
      { uMm: uMax, vMm: vMax },
      { uMm: uMin, vMm: vMax },
    ];
    updateFeature(f.id, { outline: nextOutline });
  }
  for (const fld of [sillField, heightField, widthField, xField]) {
    fld.input.addEventListener("change", applyNumericEdit);
  }

  function refreshNumericPanel(): void {
    const f = getSelectedFeature();
    if (!f) {
      numericPanel.hidden = true;
      return;
    }
    numericPanel.hidden = false;
    numericTitle.textContent = `Edit ${f.label}`;
    const bbox = rectBboxOf(f.outline);
    if (!bbox) {
      // Non-rectangular outline — disable with explanation.
      for (const fld of [sillField, heightField, widthField, xField]) {
        fld.input.disabled = true;
        fld.input.title = "Numeric editor only supports rectangular outlines.";
      }
      numericNote.textContent =
        "This feature's outline is not a rectangle; use drag-edit only.";
      return;
    }
    for (const fld of [sillField, heightField, widthField, xField]) {
      fld.input.disabled = false;
      fld.input.title = "";
    }
    sillField.input.value = String(Math.round(bbox.vMin));
    heightField.input.value = String(Math.round(bbox.vMax - bbox.vMin));
    widthField.input.value = String(Math.round(bbox.uMax - bbox.uMin));
    xField.input.value = String(Math.round(bbox.uMin));
    numericNote.textContent =
      "Sill = bottom edge above floor. Width/height in mm. Drag the rectangle in the elevation to fine-tune.";
  }

  // ---- List of features on this wall ----
  const list = document.createElement("ul");
  list.className = "print-mode-feature-list print-mode-wall-feature-list";
  list.setAttribute("aria-label", "Features on this wall");
  panel.append(list);

  host.replaceChildren();
  host.append(panel);

  // ---- Geometry helpers ----
  let wallWidthMm = 1;
  let wallHeightMm = 1;
  let scale = 1; // svg pixels per mm
  let offsetX = SVG_PAD;
  let offsetY = SVG_PAD;

  function recomputeViewport(width: number, height: number): void {
    wallWidthMm = Math.max(1, width);
    wallHeightMm = Math.max(1, height);
    const usableW = SVG_WIDTH - SVG_PAD * 2;
    const usableH = SVG_HEIGHT - SVG_PAD * 2;
    scale = Math.min(usableW / wallWidthMm, usableH / wallHeightMm);
    const drawnW = wallWidthMm * scale;
    const drawnH = wallHeightMm * scale;
    offsetX = (SVG_WIDTH - drawnW) / 2;
    offsetY = (SVG_HEIGHT - drawnH) / 2;
    wallRect.setAttribute("x", String(offsetX));
    wallRect.setAttribute("y", String(offsetY));
    wallRect.setAttribute("width", String(drawnW));
    wallRect.setAttribute("height", String(drawnH));
  }

  function uvToSvg(uMm: number, vMm: number): { x: number; y: number } {
    // v=0 sits at the floor (svg-bottom); v=ceilingHeight at the top.
    const x = offsetX + uMm * scale;
    const y = offsetY + (wallHeightMm - vMm) * scale;
    return { x, y };
  }

  function svgToUv(svgX: number, svgY: number): { uMm: number; vMm: number } {
    const uMm = (svgX - offsetX) / scale;
    const vMm = wallHeightMm - (svgY - offsetY) / scale;
    return { uMm, vMm };
  }

  function clientToSvgPoint(
    clientX: number,
    clientY: number,
  ): { x: number; y: number } {
    const rect = root.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * SVG_WIDTH;
    const y = ((clientY - rect.top) / rect.height) * SVG_HEIGHT;
    return { x, y };
  }

  // ---- Drag-to-add ----
  let activePointer: number | null = null;
  let dragStart: { uMm: number; vMm: number } | null = null;

  function clamp(value: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, value));
  }

  root.addEventListener("pointerdown", (ev) => {
    if (activePointer !== null) return;
    const sp = clientToSvgPoint(ev.clientX, ev.clientY);
    if (
      sp.x < offsetX ||
      sp.x > offsetX + wallWidthMm * scale ||
      sp.y < offsetY ||
      sp.y > offsetY + wallHeightMm * scale
    ) {
      return;
    }
    activePointer = ev.pointerId;
    const uv = svgToUv(sp.x, sp.y);
    dragStart = { uMm: uv.uMm, vMm: uv.vMm };
    root.setPointerCapture(ev.pointerId);
    dragRect.setAttribute("visibility", "visible");
    dragRect.setAttribute("x", String(sp.x));
    dragRect.setAttribute("y", String(sp.y));
    dragRect.setAttribute("width", "0");
    dragRect.setAttribute("height", "0");
    ev.preventDefault();
  });

  root.addEventListener("pointermove", (ev) => {
    if (activePointer !== ev.pointerId || !dragStart) return;
    const sp = clientToSvgPoint(ev.clientX, ev.clientY);
    const startSp = uvToSvg(dragStart.uMm, dragStart.vMm);
    const x0 = Math.min(startSp.x, sp.x);
    const y0 = Math.min(startSp.y, sp.y);
    const w = Math.abs(sp.x - startSp.x);
    const h = Math.abs(sp.y - startSp.y);
    dragRect.setAttribute("x", String(x0));
    dragRect.setAttribute("y", String(y0));
    dragRect.setAttribute("width", String(w));
    dragRect.setAttribute("height", String(h));
  });

  function endDrag(ev: PointerEvent, commit: boolean): void {
    if (activePointer !== ev.pointerId) return;
    activePointer = null;
    dragRect.setAttribute("visibility", "hidden");
    if (!commit || !dragStart) {
      dragStart = null;
      return;
    }
    const sp = clientToSvgPoint(ev.clientX, ev.clientY);
    const endUv = svgToUv(sp.x, sp.y);
    const a = dragStart;
    dragStart = null;
    const uMin = clamp(Math.min(a.uMm, endUv.uMm), 0, wallWidthMm);
    const uMax = clamp(Math.max(a.uMm, endUv.uMm), 0, wallWidthMm);
    const vMin = clamp(Math.min(a.vMm, endUv.vMm), 0, wallHeightMm);
    const vMax = clamp(Math.max(a.vMm, endUv.vMm), 0, wallHeightMm);
    // Reject zero-area drags (taps).
    if (uMax - uMin < 50 || vMax - vMin < 50) return;
    const job = getPrintJob();
    const features = job.room.features;
    const newFeature: RoomFeature = {
      id: makeId(),
      type: nextAddType,
      label: nextLabelFor(nextAddType, features),
      surfaceId: wallId,
      outline: [
        { uMm: uMin, vMm: vMin },
        { uMm: uMax, vMm: vMin },
        { uMm: uMax, vMm: vMax },
        { uMm: uMin, vMm: vMax },
      ],
      paint: false, // FR-005 default for window/door/closet
    };
    setPrintJob({ room: { features: [...features, newFeature] } });
  }

  root.addEventListener("pointerup", (ev) => endDrag(ev, true));
  root.addEventListener("pointercancel", (ev) => endDrag(ev, false));

  // ---- Feature row + per-feature DOM ----
  function updateFeature(id: string, patch: Partial<RoomFeature>): void {
    const job = getPrintJob();
    const next = job.room.features.map((f) => (f.id === id ? { ...f, ...patch } : f));
    setPrintJob({ room: { features: next } });
  }

  function deleteFeature(id: string): void {
    const job = getPrintJob();
    setPrintJob({
      room: { features: job.room.features.filter((f) => f.id !== id) },
    });
  }

  function renderFeatureRow(f: RoomFeature): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "print-mode-feature-row";
    if (selectedFeatureId === f.id) li.classList.add("print-mode-feature-row-selected");
    li.dataset.featureId = f.id;
    // Selection toggle: explicit "Edit" / "Done" button so clicks on the
    // label/paint/delete controls don't accidentally toggle selection.
    function selectThis(): void {
      selectedFeatureId = selectedFeatureId === f.id ? null : f.id;
      render();
    }

    const typeLabel = document.createElement("span");
    typeLabel.className = "print-mode-feature-type";
    typeLabel.textContent =
      f.type === "window" ? "Window" : f.type === "door" ? "Door" : "Closet";
    typeLabel.style.cursor = "pointer";
    typeLabel.addEventListener("click", selectThis);
    li.append(typeLabel);

    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.className = "print-mode-input print-mode-feature-label";
    labelInput.value = f.label;
    labelInput.setAttribute("aria-label", `Feature label for ${f.type}`);
    labelInput.addEventListener("change", () => {
      updateFeature(f.id, { label: labelInput.value });
    });
    li.append(labelInput);

    const paintLabel = document.createElement("label");
    paintLabel.className = "print-mode-feature-paint";
    const paintInput = document.createElement("input");
    paintInput.type = "checkbox";
    paintInput.checked = f.paint;
    paintInput.addEventListener("change", () => {
      updateFeature(f.id, { paint: paintInput.checked });
    });
    const paintSpan = document.createElement("span");
    paintSpan.textContent = "Paint";
    paintSpan.title = "Off = no-paint (cut line). On = stars project onto it.";
    paintLabel.append(paintInput, paintSpan);
    li.append(paintLabel);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "print-mode-secondary print-mode-feature-edit";
    editBtn.textContent = selectedFeatureId === f.id ? "Done" : "Edit";
    editBtn.setAttribute("aria-label", `Edit ${f.label}`);
    editBtn.addEventListener("click", selectThis);
    li.append(editBtn);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "print-mode-secondary print-mode-feature-delete";
    delBtn.textContent = "Delete";
    delBtn.setAttribute("aria-label", `Delete ${f.label}`);
    delBtn.addEventListener("click", () => deleteFeature(f.id));
    li.append(delBtn);

    return li;
  }

  // ---- Render ----
  function findWall(): Surface | null {
    const job = getPrintJob();
    const surfaces = deriveSurfaces(job.room, job.outputOptions.blockHorizonOnWalls);
    return surfaces.find((s) => s.id === wallId) ?? null;
  }

  function render(): void {
    const job = getPrintJob();
    const wall = findWall();
    if (!wall) {
      heading.textContent = "Wall elevation";
      list.replaceChildren();
      const empty = document.createElement("li");
      empty.className = "print-mode-feature-empty";
      empty.textContent = "Wall not found.";
      list.append(empty);
      return;
    }
    heading.textContent = `${wall.label} — elevation`;
    recomputeViewport(wall.widthMm, wall.heightMm);

    // Features on this wall.
    const wallFeatures = job.room.features.filter((f) => f.surfaceId === wallId);
    featuresGroup.replaceChildren();
    for (const f of wallFeatures) {
      let uMin = Infinity;
      let uMax = -Infinity;
      let vMin = Infinity;
      let vMax = -Infinity;
      for (const p of f.outline) {
        if (p.uMm < uMin) uMin = p.uMm;
        if (p.uMm > uMax) uMax = p.uMm;
        if (p.vMm < vMin) vMin = p.vMm;
        if (p.vMm > vMax) vMax = p.vMm;
      }
      if (!Number.isFinite(uMin)) continue;
      const tl = uvToSvg(uMin, vMax);
      const widthPx = (uMax - uMin) * scale;
      const heightPx = (vMax - vMin) * scale;
      const stroke = f.paint ? "rgba(120, 200, 120, 0.9)" : "rgba(245, 215, 110, 0.9)";
      const fill = f.paint ? "rgba(120, 200, 120, 0.18)" : "rgba(245, 215, 110, 0.18)";
      const isSelected = selectedFeatureId === f.id;
      const rectEl = svgEl("rect", {
        x: tl.x,
        y: tl.y,
        width: widthPx,
        height: heightPx,
        fill,
        stroke: isSelected ? "var(--accent)" : stroke,
        "stroke-width": isSelected ? 2.4 : 1.2,
        "stroke-dasharray": f.paint ? "" : "4 2",
        class: "print-mode-wall-feature-rect",
      }) as SVGRectElement;
      rectEl.dataset.featureId = f.id;
      rectEl.style.cursor = "pointer";
      rectEl.addEventListener("click", (ev) => {
        ev.stopPropagation();
        selectedFeatureId = selectedFeatureId === f.id ? null : f.id;
        render();
      });
      featuresGroup.append(rectEl);
      const labelEl = svgEl("text", {
        x: tl.x + widthPx / 2,
        y: tl.y + heightPx / 2,
        "text-anchor": "middle",
        "dominant-baseline": "middle",
        "font-size": 10,
        fill: "var(--fg)",
        "font-family": "var(--font-mono)",
      });
      labelEl.textContent = f.label;
      featuresGroup.append(labelEl);
    }

    // Side list.
    list.replaceChildren();
    if (wallFeatures.length === 0) {
      const empty = document.createElement("li");
      empty.className = "print-mode-feature-empty";
      empty.textContent = "No features on this wall yet.";
      list.append(empty);
    } else {
      for (const f of wallFeatures) list.append(renderFeatureRow(f));
    }

    // If the previously-selected feature is no longer on this wall (or
    // was deleted), clear the selection.
    if (selectedFeatureId && !wallFeatures.some((f) => f.id === selectedFeatureId)) {
      selectedFeatureId = null;
    }
    refreshNumericPanel();
  }

  render();
  const unsub = subscribe(() => render());
  return unsub;
}
