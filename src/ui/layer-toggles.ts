// Layer visibility toggle panel. Collapsed by default to "Layers" button;
// expanding reveals a vertical checkbox group, one per field of
// `LayerVisibility`. Checkbox state is bound to the Observation store:
// toggling a box calls setObservation({ layers: { ... } }) and subscribes
// so external state changes reflect back into the UI.
//
// Accessibility:
//   - Toggle button uses aria-expanded + aria-controls.
//   - The checkbox group is marked role="group" with aria-label.
//   - Each checkbox has an explicit <label> wrap + descriptive text.

import { getObservation, setObservation, subscribe } from "../app/observation-store";
import type { LayerVisibility } from "../app/types";

interface ToggleSpec {
  key: keyof LayerVisibility;
  label: string;
}

const TOGGLES: readonly ToggleSpec[] = [
  { key: "constellationLines", label: "Constellation lines" },
  { key: "constellationLabels", label: "Constellation names" },
  { key: "planetLabels", label: "Planet names" },
  { key: "brightStarLabels", label: "Bright star names" },
] as const;

export function mountLayerToggles(parent: HTMLElement): void {
  const panel = document.createElement("div");
  panel.className = "panel layer-toggles";
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", "Layer visibility");

  const summaryId = `layer-toggles-group-${Math.random().toString(36).slice(2, 8)}`;

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "layer-toggles-summary";
  toggleBtn.textContent = "Layers";
  toggleBtn.setAttribute("aria-expanded", "false");
  toggleBtn.setAttribute("aria-controls", summaryId);
  panel.append(toggleBtn);

  const group = document.createElement("div");
  group.className = "layer-toggles-group";
  group.id = summaryId;
  group.hidden = true;
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Layer visibility toggles");

  // One checkbox per layer.
  const checkboxes = new Map<keyof LayerVisibility, HTMLInputElement>();
  for (const spec of TOGGLES) {
    const row = document.createElement("label");
    row.className = "layer-toggles-row";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "layer-toggles-checkbox";
    cb.setAttribute("data-layer", spec.key);
    cb.setAttribute("aria-label", spec.label);

    const span = document.createElement("span");
    span.className = "layer-toggles-label";
    span.textContent = spec.label;

    row.append(cb, span);
    group.append(row);
    checkboxes.set(spec.key, cb);

    cb.addEventListener("change", () => {
      // The observation store merges per-field under `layers`, so a partial
      // sub-object flipping exactly one flag is the intended shape.
      const patch: Partial<LayerVisibility> = { [spec.key]: cb.checked };
      setObservation({ layers: patch as LayerVisibility });
    });
  }

  panel.append(group);
  parent.append(panel);

  // Expand/collapse.
  toggleBtn.addEventListener("click", () => {
    const nowExpanded = group.hidden; // was hidden → expanding
    group.hidden = !nowExpanded;
    toggleBtn.setAttribute("aria-expanded", nowExpanded ? "true" : "false");
  });

  // Sync checkbox state from store.
  const applyLayers = (layers: LayerVisibility): void => {
    for (const [key, cb] of checkboxes) {
      const v = layers[key];
      if (cb.checked !== v) cb.checked = v;
    }
  };
  subscribe((obs) => applyLayers(obs.layers));
  applyLayers(getObservation().layers);
}
