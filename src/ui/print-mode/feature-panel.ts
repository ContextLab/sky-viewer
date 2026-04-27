// T033 — Feature panel for Print Mode.
//
// US1 subset (ceiling features only):
//   - "Add feature → Light fixture" button. Adds a 300×300 mm
//     rectangle centred on the ceiling. (US1 ships without a "place
//     mode" click-to-drop affordance — the rectangle drops into the
//     centre of the ceiling immediately, then the user adjusts via the
//     side-panel rows.)
//   - Side-panel listing existing features:
//       row = type label + paint/no-paint toggle + free-text label +
//             delete button.
//   - Light fixture default: paint=false (no-paint per FR-005).
//   - Walls/floor/door/window features defer to US2.

import { getPrintJob, setPrintJob } from "../../print/print-job-store";
import type { RoomFeature } from "../../print/types";
import type { RegisterRefresh } from "./print-mode";

let nextLightFixtureNumber = 1;

function nextLightLabel(existing: RoomFeature[]): string {
  // Find the highest "Light fixture N" suffix already used.
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
  // Cheap unique-enough id; no crypto dependency. The store keys by id.
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
    "Mark room features so they render as cut lines (no-paint) or get stencilled normally (paint). Walls + doors + windows arrive in US2.";
  panel.append(helper);

  // ---- Add buttons ----
  const addRow = document.createElement("div");
  addRow.className = "print-mode-row";

  const addLightBtn = document.createElement("button");
  addLightBtn.type = "button";
  addLightBtn.className = "print-mode-secondary";
  addLightBtn.textContent = "Add feature → Light fixture";
  addLightBtn.title = "Place a 300 × 300 mm light fixture at the ceiling centre";
  addRow.append(addLightBtn);
  panel.append(addRow);

  addLightBtn.addEventListener("click", () => {
    const job = getPrintJob();
    // Compute ceiling-bbox in surface-local coords.
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
    // Surface-local origin: ceiling has originMm = (xMin, yMin, ceilingHeight),
    // u-axis = +x, v-axis = +y. Ceiling-centre in surface-local coords is
    // ((xMax - xMin)/2, (yMax - yMin)/2). The fixture is 300 × 300 mm centred
    // on that point.
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

  // ---- List of features ----
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
    typeLabel.textContent =
      f.type === "lightFixture"
        ? "Light fixture"
        : f.type === "recessedLight"
          ? "Recessed light"
          : f.type === "window"
            ? "Window"
            : f.type === "door"
              ? "Door"
              : f.type === "closet"
                ? "Closet"
                : "Other";
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
    for (const f of job.room.features) list.append(renderFeature(f));
  };
  register(refresh);
}
