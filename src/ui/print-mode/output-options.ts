// T034 / T045 / T050 — Output options panel for Print Mode.
//
//  - Paper-size selector with all 6 presets + a Custom option that
//    reveals two numeric inputs (W×H) and a units toggle (mm/in).
//  - Display-units toggle (imperial/metric) — drives how the rest of
//    Print Mode renders dimension labels.
//  - Surface-enable section: ceiling checkbox + per-wall checkboxes +
//    floor checkbox. Wall checkboxes are reactively re-rendered when
//    `room.vertices` change (T045).
//  - "Block horizon on walls" toggle (default ON per FR-008a).
//  - "Include constellation lines" toggle (default OFF per R8 / T050).

import { getPrintJob, setPrintJob } from "../../print/print-job-store";
import { deriveSurfaces } from "../../print/projection";
import type { PaperSize, Surface } from "../../print/types";
import type { RegisterRefresh } from "./print-mode";

const MM_PER_INCH = 25.4;

const PRESETS: Array<{ key: "letter" | "legal" | "tabloid" | "a3" | "a4" | "a5"; label: string }> = [
  { key: "letter", label: "Letter (8.5 x 11 in)" },
  { key: "legal", label: "Legal (8.5 x 14 in)" },
  { key: "tabloid", label: "Tabloid (11 x 17 in)" },
  { key: "a3", label: "A3 (297 x 420 mm)" },
  { key: "a4", label: "A4 (210 x 297 mm)" },
  { key: "a5", label: "A5 (148 x 210 mm)" },
];

export function mountOutputOptions(host: HTMLElement, register: RegisterRefresh): void {
  const panel = document.createElement("section");
  panel.className = "print-mode-panel print-mode-output-options";

  const heading = document.createElement("h2");
  heading.className = "print-mode-panel-heading";
  heading.textContent = "Output";
  panel.append(heading);

  // ---- Paper size selector ----
  const paperField = document.createElement("div");
  paperField.className = "print-mode-field";
  const paperSpan = document.createElement("span");
  paperSpan.textContent = "Paper size";
  paperField.append(paperSpan);

  const paperSelect = document.createElement("select");
  paperSelect.className = "print-mode-input";
  paperSelect.setAttribute("aria-label", "Paper size");
  for (const p of PRESETS) {
    const opt = document.createElement("option");
    opt.value = `preset:${p.key}`;
    opt.textContent = p.label;
    paperSelect.append(opt);
  }
  const customOpt = document.createElement("option");
  customOpt.value = "custom";
  customOpt.textContent = "Custom";
  paperSelect.append(customOpt);
  paperField.append(paperSelect);

  // Custom W*H + units toggle.
  const customRow = document.createElement("div");
  customRow.className = "print-mode-row print-mode-custom-row";

  const widthInput = document.createElement("input");
  widthInput.type = "number";
  widthInput.className = "print-mode-input print-mode-paper-dim";
  widthInput.min = "100";
  widthInput.max = "600";
  widthInput.step = "1";
  widthInput.setAttribute("aria-label", "Custom paper width (mm)");

  const sep = document.createElement("span");
  sep.textContent = "x";

  const heightInput = document.createElement("input");
  heightInput.type = "number";
  heightInput.className = "print-mode-input print-mode-paper-dim";
  heightInput.min = "150";
  heightInput.max = "900";
  heightInput.step = "1";
  heightInput.setAttribute("aria-label", "Custom paper height (mm)");

  const customUnits = document.createElement("select");
  customUnits.className = "print-mode-input";
  customUnits.setAttribute("aria-label", "Custom paper units");
  const optMm = document.createElement("option");
  optMm.value = "mm";
  optMm.textContent = "mm";
  const optIn = document.createElement("option");
  optIn.value = "in";
  optIn.textContent = "in";
  customUnits.append(optMm, optIn);

  customRow.append(widthInput, sep, heightInput, customUnits);
  paperField.append(customRow);
  panel.append(paperField);

  function commitPaper(): void {
    const job = getPrintJob();
    if (paperSelect.value === "custom") {
      const w = Number(widthInput.value);
      const h = Number(heightInput.value);
      if (!Number.isFinite(w) || !Number.isFinite(h)) return;
      const widthMm = customUnits.value === "in" ? w * MM_PER_INCH : w;
      const heightMm = customUnits.value === "in" ? h * MM_PER_INCH : h;
      const next: PaperSize = { kind: "custom", widthMm, heightMm };
      setPrintJob({ outputOptions: { ...job.outputOptions, paper: next } });
    } else if (paperSelect.value.startsWith("preset:")) {
      const preset = paperSelect.value.slice("preset:".length) as
        | "letter"
        | "legal"
        | "tabloid"
        | "a3"
        | "a4"
        | "a5";
      const next: PaperSize = { kind: "preset", preset };
      setPrintJob({ outputOptions: { ...job.outputOptions, paper: next } });
    }
  }

  paperSelect.addEventListener("change", commitPaper);
  widthInput.addEventListener("change", commitPaper);
  heightInput.addEventListener("change", commitPaper);
  customUnits.addEventListener("change", commitPaper);

  // ---- Display units ----
  const unitsField = document.createElement("div");
  unitsField.className = "print-mode-field";
  const unitsSpan = document.createElement("span");
  unitsSpan.textContent = "Display units";
  unitsField.append(unitsSpan);

  const unitsRow = document.createElement("div");
  unitsRow.className = "print-mode-row print-mode-units-row";
  const impLabel = document.createElement("label");
  const impInput = document.createElement("input");
  impInput.type = "radio";
  impInput.name = "print-mode-units";
  impInput.value = "imperial";
  const impSpan = document.createElement("span");
  impSpan.textContent = "ft / in";
  impLabel.append(impInput, impSpan);

  const metLabel = document.createElement("label");
  const metInput = document.createElement("input");
  metInput.type = "radio";
  metInput.name = "print-mode-units";
  metInput.value = "metric";
  const metSpan = document.createElement("span");
  metSpan.textContent = "m / mm";
  metLabel.append(metInput, metSpan);

  unitsRow.append(impLabel, metLabel);
  unitsField.append(unitsRow);
  panel.append(unitsField);

  function commitUnits(): void {
    const job = getPrintJob();
    const value: "imperial" | "metric" = impInput.checked ? "imperial" : "metric";
    setPrintJob({ outputOptions: { ...job.outputOptions, displayUnits: value } });
  }
  impInput.addEventListener("change", commitUnits);
  metInput.addEventListener("change", commitUnits);

  // ---- Surface enable (T045) ----
  const surfacesField = document.createElement("fieldset");
  surfacesField.className = "print-mode-field print-mode-surfaces";
  const legend = document.createElement("legend");
  legend.textContent = "Surfaces";
  surfacesField.append(legend);

  // Ceiling checkbox is stable.
  const ceilingLabel = document.createElement("label");
  ceilingLabel.className = "print-mode-checkbox-row";
  const ceilingInput = document.createElement("input");
  ceilingInput.type = "checkbox";
  const ceilingSpan = document.createElement("span");
  ceilingSpan.textContent = "Ceiling";
  ceilingLabel.append(ceilingInput, ceilingSpan);
  surfacesField.append(ceilingLabel);
  ceilingInput.addEventListener("change", () => {
    const job = getPrintJob();
    setPrintJob({
      room: {
        surfaceEnable: { ...job.room.surfaceEnable, ceiling: ceilingInput.checked },
      },
    });
  });

  // Wall checkboxes: dynamic — rebuilt whenever the floor plan changes.
  const wallsHost = document.createElement("div");
  wallsHost.className = "print-mode-walls-host";
  surfacesField.append(wallsHost);

  // Floor checkbox.
  const floorLabel = document.createElement("label");
  floorLabel.className = "print-mode-checkbox-row";
  const floorInput = document.createElement("input");
  floorInput.type = "checkbox";
  const floorSpan = document.createElement("span");
  floorSpan.textContent = "Floor (antipodal sky)";
  floorLabel.append(floorInput, floorSpan);
  surfacesField.append(floorLabel);
  floorInput.addEventListener("change", () => {
    const job = getPrintJob();
    setPrintJob({
      room: {
        surfaceEnable: { ...job.room.surfaceEnable, floor: floorInput.checked },
      },
    });
  });

  panel.append(surfacesField);

  // ---- Block horizon + Include constellation lines (T045 / T050) ----
  const advField = document.createElement("fieldset");
  advField.className = "print-mode-field print-mode-advanced";
  const advLegend = document.createElement("legend");
  advLegend.textContent = "Advanced";
  advField.append(advLegend);

  const blockLabel = document.createElement("label");
  blockLabel.className = "print-mode-checkbox-row";
  const blockInput = document.createElement("input");
  blockInput.type = "checkbox";
  const blockSpan = document.createElement("span");
  blockSpan.textContent = "Block horizon on walls";
  blockLabel.append(blockInput, blockSpan);
  blockLabel.title =
    "On = walls clip at the horizon line. Off = walls run continuous floor-to-ceiling, with antipodal stars filling the lower band.";
  advField.append(blockLabel);
  blockInput.addEventListener("change", () => {
    const job = getPrintJob();
    setPrintJob({
      outputOptions: {
        ...job.outputOptions,
        blockHorizonOnWalls: blockInput.checked,
      },
    });
  });

  const consLabel = document.createElement("label");
  consLabel.className = "print-mode-checkbox-row";
  const consInput = document.createElement("input");
  consInput.type = "checkbox";
  const consSpan = document.createElement("span");
  consSpan.textContent = "Include constellation lines";
  consLabel.append(consInput, consSpan);
  consLabel.title =
    "Render constellation lines as faint dashed strokes on tile pages. Off by default.";
  advField.append(consLabel);
  consInput.addEventListener("change", () => {
    const job = getPrintJob();
    setPrintJob({
      outputOptions: {
        ...job.outputOptions,
        includeConstellationLines: consInput.checked,
      },
    });
  });

  panel.append(advField);

  host.append(panel);

  // ---- Wall-checkbox renderer (rebuilt every refresh) ----
  function renderWallCheckboxes(walls: Surface[], enableMap: Record<string, boolean>): void {
    wallsHost.replaceChildren();
    if (walls.length === 0) return;
    for (const wall of walls) {
      const lbl = document.createElement("label");
      lbl.className = "print-mode-checkbox-row";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = enableMap[wall.id] === true;
      input.dataset.wallId = wall.id;
      const span = document.createElement("span");
      span.textContent = wall.label;
      lbl.append(input, span);
      input.addEventListener("change", () => {
        const job = getPrintJob();
        setPrintJob({
          room: {
            surfaceEnable: {
              ...job.room.surfaceEnable,
              walls: { ...job.room.surfaceEnable.walls, [wall.id]: input.checked },
            },
          },
        });
      });
      wallsHost.append(lbl);
    }
  }

  // ---- Refresh ----
  const refresh = (): void => {
    const job = getPrintJob();
    const paper = job.outputOptions.paper;
    if (paper.kind === "preset") {
      paperSelect.value = `preset:${paper.preset}`;
      customRow.style.display = "none";
    } else {
      paperSelect.value = "custom";
      customRow.style.display = "";
      const wDisplay = customUnits.value === "in" ? paper.widthMm / MM_PER_INCH : paper.widthMm;
      const hDisplay = customUnits.value === "in" ? paper.heightMm / MM_PER_INCH : paper.heightMm;
      if (Math.abs(Number(widthInput.value) - wDisplay) > 0.01) {
        widthInput.value = wDisplay.toFixed(0);
      }
      if (Math.abs(Number(heightInput.value) - hDisplay) > 0.01) {
        heightInput.value = hDisplay.toFixed(0);
      }
    }
    impInput.checked = job.outputOptions.displayUnits === "imperial";
    metInput.checked = job.outputOptions.displayUnits === "metric";
    ceilingInput.checked = job.room.surfaceEnable.ceiling;
    floorInput.checked = job.room.surfaceEnable.floor;
    blockInput.checked = job.outputOptions.blockHorizonOnWalls;
    consInput.checked = job.outputOptions.includeConstellationLines;

    const surfaces = deriveSurfaces(job.room, job.outputOptions.blockHorizonOnWalls);
    const walls = surfaces.filter((s) => s.kind === "wall");
    renderWallCheckboxes(walls, job.room.surfaceEnable.walls);
  };
  register(refresh);
}
