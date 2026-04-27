// T034 — Output options panel for Print Mode (US1 subset).
//
//  - Paper-size selector with all 6 presets + a Custom option that
//    reveals two numeric inputs (W×H) and a units toggle (mm/in).
//  - Display-units toggle (imperial/metric) — drives how the rest of
//    Print Mode renders dimension labels.
//  - Surface-enable section: ceiling checkbox (default ON); walls and
//    floor checkboxes are visible but DISABLED with the "Multi-surface
//    — see US2" hint.
//  - "Block horizon on walls" + "Include constellation lines" are shown
//    but disabled in US1 (US2 enables them).

import { getPrintJob, setPrintJob } from "../../print/print-job-store";
import type { PaperSize } from "../../print/types";
import type { RegisterRefresh } from "./print-mode";

const MM_PER_INCH = 25.4;

const PRESETS: Array<{ key: "letter" | "legal" | "tabloid" | "a3" | "a4" | "a5"; label: string }> = [
  { key: "letter", label: "Letter (8.5 × 11 in)" },
  { key: "legal", label: "Legal (8.5 × 14 in)" },
  { key: "tabloid", label: "Tabloid (11 × 17 in)" },
  { key: "a3", label: "A3 (297 × 420 mm)" },
  { key: "a4", label: "A4 (210 × 297 mm)" },
  { key: "a5", label: "A5 (148 × 210 mm)" },
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
  customOpt.textContent = "Custom…";
  paperSelect.append(customOpt);
  paperField.append(paperSelect);

  // Custom W×H + units toggle.
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
  sep.textContent = "×";

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

  // ---- Surface enable ----
  const surfacesField = document.createElement("fieldset");
  surfacesField.className = "print-mode-field print-mode-surfaces";
  const legend = document.createElement("legend");
  legend.textContent = "Surfaces";
  surfacesField.append(legend);

  // Ceiling.
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

  // Walls (disabled in US1).
  const wallsLabel = document.createElement("label");
  wallsLabel.className = "print-mode-checkbox-row print-mode-disabled";
  const wallsInput = document.createElement("input");
  wallsInput.type = "checkbox";
  wallsInput.disabled = true;
  const wallsSpan = document.createElement("span");
  wallsSpan.textContent = "Walls — Multi-surface (US2)";
  wallsLabel.append(wallsInput, wallsSpan);
  surfacesField.append(wallsLabel);

  // Floor (disabled in US1).
  const floorLabel = document.createElement("label");
  floorLabel.className = "print-mode-checkbox-row print-mode-disabled";
  const floorInput = document.createElement("input");
  floorInput.type = "checkbox";
  floorInput.disabled = true;
  const floorSpan = document.createElement("span");
  floorSpan.textContent = "Floor — Multi-surface (US2)";
  floorLabel.append(floorInput, floorSpan);
  surfacesField.append(floorLabel);

  panel.append(surfacesField);

  // ---- Block horizon + constellation lines (US2 deferral note) ----
  const advField = document.createElement("fieldset");
  advField.className = "print-mode-field print-mode-advanced";
  const advLegend = document.createElement("legend");
  advLegend.textContent = "Advanced";
  advField.append(advLegend);

  const blockLabel = document.createElement("label");
  blockLabel.className = "print-mode-checkbox-row print-mode-disabled";
  const blockInput = document.createElement("input");
  blockInput.type = "checkbox";
  blockInput.disabled = true;
  const blockSpan = document.createElement("span");
  blockSpan.textContent = "Block horizon on walls — see US2";
  blockLabel.append(blockInput, blockSpan);
  advField.append(blockLabel);

  const consLabel = document.createElement("label");
  consLabel.className = "print-mode-checkbox-row print-mode-disabled";
  const consInput = document.createElement("input");
  consInput.type = "checkbox";
  consInput.disabled = true;
  const consSpan = document.createElement("span");
  consSpan.textContent = "Include constellation lines — see US2";
  consLabel.append(consInput, consSpan);
  advField.append(consLabel);

  panel.append(advField);

  host.append(panel);

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
  };
  register(refresh);
}
