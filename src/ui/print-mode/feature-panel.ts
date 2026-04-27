// T033 / T044 — Feature panel for Print Mode.
//
// US1 affordance: "Add feature - Light fixture" places a 300x300 mm
// fixture at the ceiling centre.
// US2 extension (T044): the side-panel lists EVERY feature across every
// surface, grouped by surface label. Each row still has paint/no-paint
// toggle + label + delete; defaults per type apply at creation
// (FR-005 / R5).

import { getPrintJob, setPrintJob } from "../../print/print-job-store";
import { deriveSurfaces } from "../../print/projection";
import type { RoomFeature, Surface } from "../../print/types";
import type { RegisterRefresh } from "./print-mode";

const TYPE_LABELS: Record<RoomFeature["type"], string> = {
  lightFixture: "Light fixture",
  recessedLight: "Recessed light",
  window: "Window",
  door: "Door",
  closet: "Closet",
  other: "Feature",
};

let nextLightFixtureNumber = 1;

function nextLightLabel(existing: RoomFeature[]): string {
  let max = 0;
  for (const f of existing) {
    if (f.type !== "lightFixture") continue;
    const m = f.label.match(/^Light fixture\s+(\d+)$/);
    if (m && m[1]) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  if (max + 1 > nextLightFixtureNumber) nextLightFixtureNumber = max + 1;
  return `Light fixture ${nextLightFixtureNumber++}`;
}

function makeId(): string {
  return `feat-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xfffff).toString(36)}`;
}

export function mountFeaturePanel(host: HTMLElement, register: RegisterRefresh): void {
  const panel = document.createElement("section");
  panel.className = "print-mode-panel print-mode-feature-panel";

  const heading = document.createElement("h2");
  heading.className = "print-mode-panel-heading";
  heading.textContent = "Features";
  panel.append(heading);

  const helper = document.createElement("p");
  helper.className = "print-mode-helper";
  helper.textContent =
    "Mark room features so they render as cut lines (no-paint) or get stencilled normally (paint). Use the wall elevation editor to place windows, doors, and closets.";
  panel.append(helper);

  // ---- Add buttons ----
  const addRow = document.createElement("div");
  addRow.className = "print-mode-row print-mode-add-feature-row";

  const addLightBtn = document.createElement("button");
  addLightBtn.type = "button";
  addLightBtn.className = "print-mode-secondary";
  addLightBtn.textContent = "Add light fixture";
  addLightBtn.title = "Place a 300 x 300 mm light fixture at the ceiling centre";
  addRow.append(addLightBtn);

  // Issue #2 — explicit Add Window / Add Door / Add Closet buttons.
  // Clicking one arms the room editor: the next click on a wall segment
  // opens that wall's elevation panel and drops a default-sized feature
  // of the chosen type. Communication happens via a CustomEvent on the
  // panel host so the room-editor (mounted in the same column) can
  // observe it without a shared module-level singleton.
  const addWindowBtn = document.createElement("button");
  addWindowBtn.type = "button";
  addWindowBtn.className = "print-mode-secondary";
  addWindowBtn.textContent = "Add window";
  addWindowBtn.title = "Then click a wall to place a 600 x 900 mm window";

  const addDoorBtn = document.createElement("button");
  addDoorBtn.type = "button";
  addDoorBtn.className = "print-mode-secondary";
  addDoorBtn.textContent = "Add door";
  addDoorBtn.title = "Then click a wall to place a 900 x 2030 mm door";

  const addClosetBtn = document.createElement("button");
  addClosetBtn.type = "button";
  addClosetBtn.className = "print-mode-secondary";
  addClosetBtn.textContent = "Add closet";
  addClosetBtn.title = "Then click a wall to place a 1200 x 2030 mm closet opening";

  addRow.append(addWindowBtn, addDoorBtn, addClosetBtn);
  panel.append(addRow);

  // Status line for "Click a wall to place the [type]." (Issue #2).
  const placeStatus = document.createElement("p");
  placeStatus.className = "print-mode-helper print-mode-place-status";
  placeStatus.setAttribute("aria-live", "polite");
  placeStatus.hidden = true;
  panel.append(placeStatus);

  type PendingType = "window" | "door" | "closet";
  let pendingType: PendingType | null = null;
  function setPending(next: PendingType | null): void {
    pendingType = next;
    if (next === null) {
      placeStatus.textContent = "";
      placeStatus.hidden = true;
    } else {
      placeStatus.textContent = `Click a wall to place the ${next}.`;
      placeStatus.hidden = false;
    }
    for (const [btn, t] of [
      [addWindowBtn, "window"],
      [addDoorBtn, "door"],
      [addClosetBtn, "closet"],
    ] as Array<[HTMLButtonElement, PendingType]>) {
      btn.setAttribute("aria-pressed", String(t === next));
    }
    // Broadcast to the room editor.
    document.dispatchEvent(
      new CustomEvent("print-mode:pending-feature", { detail: { type: next } }),
    );
  }
  addWindowBtn.addEventListener("click", () => {
    setPending(pendingType === "window" ? null : "window");
  });
  addDoorBtn.addEventListener("click", () => {
    setPending(pendingType === "door" ? null : "door");
  });
  addClosetBtn.addEventListener("click", () => {
    setPending(pendingType === "closet" ? null : "closet");
  });
  // Listen for the room-editor confirming a placement so we can clear
  // our local pending state + button highlight.
  document.addEventListener("print-mode:feature-placed", () => {
    setPending(null);
  });

  addLightBtn.addEventListener("click", () => {
    const job = getPrintJob();
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
    if (!Number.isFinite(xMin)) return;
    const widthMm = xMax - xMin;
    const heightMm = yMax - yMin;
    const cu = widthMm / 2;
    const cv = heightMm / 2;
    const half = 150;
    const outline = [
      { uMm: cu - half, vMm: cv - half },
      { uMm: cu + half, vMm: cv - half },
      { uMm: cu + half, vMm: cv + half },
      { uMm: cu - half, vMm: cv + half },
    ];
    const newFeature: RoomFeature = {
      id: makeId(),
      type: "lightFixture",
      label: nextLightLabel(job.room.features),
      surfaceId: "ceiling",
      outline,
      paint: false,
    };
    setPrintJob({ room: { features: [...job.room.features, newFeature] } });
  });

  const list = document.createElement("ul");
  list.className = "print-mode-feature-list";
  list.setAttribute("aria-label", "Existing room features");
  panel.append(list);

  host.append(panel);

  function updateFeature(id: string, patch: Partial<RoomFeature>): void {
    const job = getPrintJob();
    const next = job.room.features.map((f) =>
      f.id === id ? { ...f, ...patch } : f,
    );
    setPrintJob({ room: { features: next } });
  }

  function deleteFeature(id: string): void {
    const job = getPrintJob();
    setPrintJob({
      room: {
        features: job.room.features.filter((f) => f.id !== id),
      },
    });
  }

  function renderFeature(f: RoomFeature): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "print-mode-feature-row";
    li.dataset.featureId = f.id;

    const typeLabel = document.createElement("span");
    typeLabel.className = "print-mode-feature-type";
    typeLabel.textContent = TYPE_LABELS[f.type];
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

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "print-mode-secondary print-mode-feature-delete";
    delBtn.textContent = "Delete";
    delBtn.setAttribute("aria-label", `Delete ${f.label}`);
    delBtn.addEventListener("click", () => deleteFeature(f.id));
    li.append(delBtn);

    return li;
  }

  function renderSurfaceHeader(label: string): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "print-mode-feature-surface-header";
    const h = document.createElement("strong");
    h.textContent = label;
    li.append(h);
    return li;
  }

  const refresh = (): void => {
    const job = getPrintJob();
    list.replaceChildren();
    if (job.room.features.length === 0) {
      const empty = document.createElement("li");
      empty.className = "print-mode-feature-empty";
      empty.textContent = "No features yet.";
      list.append(empty);
      return;
    }

    const surfaces: Surface[] = deriveSurfaces(
      job.room,
      job.outputOptions.blockHorizonOnWalls,
    );
    const surfaceLabel = new Map<string, string>();
    for (const s of surfaces) surfaceLabel.set(s.id, s.label);

    function rankOf(surfaceId: string): number {
      if (surfaceId === "ceiling") return 0;
      if (surfaceId.startsWith("wall-")) {
        const n = Number(surfaceId.slice(5));
        return 1 + (Number.isFinite(n) ? n : 0);
      }
      if (surfaceId === "floor") return 1_000_000;
      return 999_999;
    }

    const grouped = new Map<string, RoomFeature[]>();
    for (const f of job.room.features) {
      let arr = grouped.get(f.surfaceId);
      if (!arr) {
        arr = [];
        grouped.set(f.surfaceId, arr);
      }
      arr.push(f);
    }
    const ids = [...grouped.keys()].sort((a, b) => rankOf(a) - rankOf(b));
    for (const sid of ids) {
      const label = surfaceLabel.get(sid) ?? sid;
      list.append(renderSurfaceHeader(label));
      for (const f of grouped.get(sid)!) list.append(renderFeature(f));
    }
  };
  register(refresh);
}
