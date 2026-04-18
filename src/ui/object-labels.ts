// Object labels + hover/tap tooltip overlay. Sits as a `pointer-events: none`
// DOM layer on top of the canvas. Two responsibilities:
//
//   1. Always-on labels: per-frame it reads the latest projected positions of
//      planets, constellation centroids, and the top ~20 brightest visible
//      named stars, then places absolutely-positioned text nodes at
//      (screenX, screenY). Which layers show is gated by Observation.layers.
//
//   2. Hover tooltip (pointer-over-canvas): on pointermove over the canvas we
//      do a proximity pick (~14 CSS px) against the same projected positions
//      and show a small floating tooltip next to the cursor. On touch taps
//      (pointerdown+pointerup with no drag) the tooltip sticks for ~2.5 s.
//
// The canvas itself still gets all gestures because this overlay has
// `pointer-events: none` — we listen to pointer events on the canvas.

import { getObservation, subscribe } from "../app/observation-store";
import type { BodyId } from "../render/types";

export interface LabelableStar {
  starId: number;
  screenX: number;
  screenY: number;
  name: string;
  magnitude: number;
}

export interface LabelablePlanet {
  body: BodyId;
  screenX: number;
  screenY: number;
  name: string;
}

export interface LabelableConstellation {
  abbr: string;
  fullName: string;
  screenX: number;
  screenY: number;
}

export interface LabelableObjects {
  stars: LabelableStar[];
  planets: LabelablePlanet[];
  constellationCentroids: LabelableConstellation[];
}

const HOVER_RADIUS_PX = 14;
const TAP_STICKY_MS = 2500;
const DRAG_THRESHOLD_PX = 6;

interface HoverTarget {
  label: string;
  screenX: number;
  screenY: number;
}

export function mountObjectLabels(
  canvas: HTMLCanvasElement,
  getLabels: () => LabelableObjects
): void {
  // Overlay container — absolutely sized to the canvas, positioned by the
  // canvas's parent so CSS alignment matches.
  const overlay = document.createElement("div");
  overlay.className = "object-labels";
  overlay.setAttribute("aria-hidden", "true"); // all info is in canvas + a11y summary
  const parent = canvas.parentElement ?? document.body;
  parent.appendChild(overlay);

  // Permanent label layer (always-on names per layer flag).
  const labelLayer = document.createElement("div");
  labelLayer.className = "object-labels-layer";
  overlay.append(labelLayer);

  // Tooltip element (singleton, hidden until hover/tap).
  const tooltip = document.createElement("div");
  tooltip.className = "object-labels-tooltip";
  tooltip.hidden = true;
  overlay.append(tooltip);

  let stickyUntilMs = 0;
  let stickyTarget: HoverTarget | null = null;

  const showTooltip = (target: HoverTarget): void => {
    tooltip.textContent = target.label;
    tooltip.hidden = false;
    // Offset slightly above-right so the cursor doesn't cover the label.
    const left = target.screenX + 10;
    const top = target.screenY - 22;
    tooltip.style.transform = `translate(${left}px, ${top}px)`;
  };

  const hideTooltip = (): void => {
    tooltip.hidden = true;
    tooltip.textContent = "";
  };

  // Draw always-on labels per the current `layers` flags. Called every frame
  // via animationFrame; the getLabels callback provides fresh projections.
  let rafHandle = 0;
  const renderLoop = (): void => {
    rafHandle = requestAnimationFrame(renderLoop);
    const { layers } = getObservation();
    const lbls = getLabels();

    // Clear previous frame's DOM labels. We use innerHTML="" which, for a
    // flat list of <span> nodes with no listeners, is cheaper than removing
    // one at a time.
    labelLayer.replaceChildren();

    if (layers.planetLabels) {
      for (const p of lbls.planets) {
        labelLayer.append(buildLabel(p.name, p.screenX, p.screenY, "object-labels-planet"));
      }
    }
    if (layers.constellationLabels) {
      for (const c of lbls.constellationCentroids) {
        labelLayer.append(
          buildLabel(c.fullName, c.screenX, c.screenY, "object-labels-constellation")
        );
      }
    }
    if (layers.brightStarLabels) {
      // Sort by brightness then cap at the top 20.
      const brightest = lbls.stars.slice().sort((a, b) => a.magnitude - b.magnitude).slice(0, 20);
      for (const s of brightest) {
        labelLayer.append(buildLabel(s.name, s.screenX, s.screenY, "object-labels-star"));
      }
    }

    // Honour sticky tap tooltip expiry.
    if (stickyTarget && performance.now() > stickyUntilMs) {
      stickyTarget = null;
      hideTooltip();
    } else if (stickyTarget) {
      showTooltip(stickyTarget);
    }
  };
  rafHandle = requestAnimationFrame(renderLoop);

  // Keep overlay size in lockstep with the canvas. The canvas uses
  // position:absolute inset:0; we mirror that.
  overlay.style.position = "absolute";
  overlay.style.inset = "0";
  overlay.style.pointerEvents = "none";

  // --- Hover picking -------------------------------------------------------

  const pickNearest = (cssX: number, cssY: number): HoverTarget | null => {
    const lbls = getLabels();
    const { layers } = getObservation();

    let best: HoverTarget | null = null;
    let bestDist = HOVER_RADIUS_PX * HOVER_RADIUS_PX;

    const consider = (label: string, x: number, y: number): void => {
      const dx = x - cssX;
      const dy = y - cssY;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestDist) {
        bestDist = d2;
        best = { label, screenX: x, screenY: y };
      }
    };

    // Stars are always pickable (even with labels off) because the user
    // might want to ID one by hovering.
    for (const s of lbls.stars) {
      consider(s.name, s.screenX, s.screenY);
    }
    for (const p of lbls.planets) {
      consider(p.name, p.screenX, p.screenY);
    }
    if (layers.constellationLabels) {
      for (const c of lbls.constellationCentroids) {
        consider(c.fullName, c.screenX, c.screenY);
      }
    }

    return best;
  };

  const handlePointerMove = (ev: PointerEvent): void => {
    // Skip the hover path while a tap-sticky tooltip is active so they don't
    // fight each other.
    if (stickyTarget && performance.now() < stickyUntilMs) return;

    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const hit = pickNearest(x, y);
    if (hit) showTooltip(hit);
    else hideTooltip();
  };
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerleave", () => {
    if (!stickyTarget) hideTooltip();
  });

  // --- Tap handling --------------------------------------------------------

  let downX = 0;
  let downY = 0;
  let downPointer: number | null = null;

  canvas.addEventListener("pointerdown", (ev) => {
    downPointer = ev.pointerId;
    downX = ev.clientX;
    downY = ev.clientY;
  });
  canvas.addEventListener("pointerup", (ev) => {
    if (downPointer !== ev.pointerId) return;
    downPointer = null;
    const dx = ev.clientX - downX;
    const dy = ev.clientY - downY;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) return; // was a drag, not a tap
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const hit = pickNearest(x, y);
    if (hit) {
      stickyTarget = hit;
      stickyUntilMs = performance.now() + TAP_STICKY_MS;
      showTooltip(hit);
    } else {
      stickyTarget = null;
      hideTooltip();
    }
  });
  canvas.addEventListener("pointercancel", () => {
    downPointer = null;
  });

  // Re-render on store changes (layer toggles flip labels on/off instantly).
  subscribe(() => {
    // The raf loop picks up layers next tick; nothing to do here. Kept so
    // additional per-subscribe behaviour is easy to add later.
  });

  // Defensive cleanup hook — not used in production but keeps the module
  // testable without leaking timers/RAF in jsdom harnesses.
  (overlay as HTMLElement & { __dispose?: () => void }).__dispose = () => {
    cancelAnimationFrame(rafHandle);
    canvas.removeEventListener("pointermove", handlePointerMove);
  };
}

function buildLabel(
  text: string,
  screenX: number,
  screenY: number,
  extraClass: string
): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = `object-labels-item ${extraClass}`;
  el.textContent = text;
  // translate() offsets from the corner to the anchor point. We bias the
  // label slightly up-right of the object so it doesn't sit directly on top.
  el.style.transform = `translate(${screenX + 8}px, ${screenY - 10}px)`;
  return el;
}
