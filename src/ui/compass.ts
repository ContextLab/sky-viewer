// T057 — Compass widget. Circular SVG rose with N/E/S/W labels; rotates so
// the observer's facing direction stays pointing up. Supports drag-to-rotate
// (pointer events), keyboard (arrow keys / Home), and aria slider semantics
// for FR-005 + FR-014.
import { getObservation, setObservation, subscribe } from "../app/observation-store";

const SVG_NS = "http://www.w3.org/2000/svg";
const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

function cardinalFor(bearingDeg: number): string {
  // Eight 45° slices centred on each cardinal.
  const normalized = ((bearingDeg % 360) + 360) % 360;
  const idx = Math.round(normalized / 45) % 8;
  return CARDINALS[idx] ?? "N";
}

function formatReadout(bearingDeg: number): string {
  const normalized = ((bearingDeg % 360) + 360) % 360;
  return `Facing ${cardinalFor(normalized)} (${Math.round(normalized)}°)`;
}

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

export function mountCompass(parent: HTMLElement): void {
  const panel = document.createElement("div");
  panel.className = "panel compass";
  panel.setAttribute("aria-label", "Compass");

  const size = 110;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 4;

  const root = svg("svg", {
    class: "compass-svg",
    width: size,
    height: size,
    viewBox: `0 0 ${size} ${size}`,
    role: "slider",
    "aria-label": "Facing direction (compass bearing)",
    "aria-valuemin": 0,
    "aria-valuemax": 360,
    "aria-valuenow": 0,
    tabindex: 0,
  }) as SVGSVGElement;

  // Outer ring (static; sits in screen space).
  root.append(
    svg("circle", {
      cx,
      cy,
      r: outerR,
      class: "compass-ring",
      fill: "rgba(255,255,255,0.04)",
      stroke: "rgba(255,255,255,0.22)",
      "stroke-width": 1,
    })
  );

  // Rotating group: rose + cardinals + ticks.
  // We rotate by -bearing so the current heading stays at the top (12 o'clock).
  const rose = svg("g", { class: "compass-rose" }) as SVGGElement;
  root.append(rose);

  // Minor ticks every 22.5°, major ticks every 45°.
  for (let i = 0; i < 16; i++) {
    const angleDeg = i * 22.5;
    const isMajor = i % 2 === 0;
    const inner = outerR - (isMajor ? 10 : 5);
    const outer = outerR - 1;
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    const x1 = cx + inner * Math.cos(rad);
    const y1 = cy + inner * Math.sin(rad);
    const x2 = cx + outer * Math.cos(rad);
    const y2 = cy + outer * Math.sin(rad);
    rose.append(
      svg("line", {
        x1,
        y1,
        x2,
        y2,
        stroke: isMajor ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.25)",
        "stroke-width": isMajor ? 1.2 : 0.8,
      })
    );
  }

  // N/E/S/W labels. N gets accent colour so it stands out when rotated.
  const labels: Array<{ text: string; deg: number; accent: boolean }> = [
    { text: "N", deg: 0, accent: true },
    { text: "E", deg: 90, accent: false },
    { text: "S", deg: 180, accent: false },
    { text: "W", deg: 270, accent: false },
  ];
  const labelRadius = outerR - 18;
  for (const { text, deg, accent } of labels) {
    const rad = ((deg - 90) * Math.PI) / 180;
    const x = cx + labelRadius * Math.cos(rad);
    const y = cy + labelRadius * Math.sin(rad);
    const t = svg("text", {
      x,
      y,
      "text-anchor": "middle",
      "dominant-baseline": "central",
      "font-size": 12,
      "font-weight": accent ? 700 : 500,
      fill: accent ? "var(--accent)" : "var(--fg)",
      class: accent ? "compass-label compass-label-n" : "compass-label",
    });
    t.textContent = text;
    rose.append(t);
  }

  // Central "facing up" arrow — this sits in screen space (NOT rotated),
  // since "up" always means "where the viewer is looking".
  const arrow = svg("g", { class: "compass-arrow" });
  const arrowPath = svg("path", {
    d: `M ${cx} ${cy - outerR + 6} L ${cx - 6} ${cy - 4} L ${cx} ${cy - 8} L ${cx + 6} ${cy - 4} Z`,
    fill: "var(--accent)",
    stroke: "rgba(0,0,0,0.55)",
    "stroke-width": 0.8,
  });
  arrow.append(arrowPath);
  root.append(arrow);

  panel.append(root);

  const readout = document.createElement("div");
  readout.className = "readout compass-readout";
  readout.setAttribute("aria-hidden", "true"); // aria-valuenow on slider already conveys it
  panel.append(readout);

  parent.append(panel);

  // ---------------------------------------------------------------------------
  // State sync.
  const applyBearing = (bearingDeg: number): void => {
    const normalized = ((bearingDeg % 360) + 360) % 360;
    rose.setAttribute("transform", `rotate(${-normalized} ${cx} ${cy})`);
    root.setAttribute("aria-valuenow", String(Math.round(normalized)));
    root.setAttribute("aria-valuetext", formatReadout(normalized));
    readout.textContent = formatReadout(normalized);
  };
  subscribe((obs) => applyBearing(obs.bearingDeg));
  applyBearing(getObservation().bearingDeg);

  // ---------------------------------------------------------------------------
  // Drag-to-rotate. We compute the angle of the pointer relative to the centre
  // of the SVG; dragging is a direct mapping (dragging to 3 o'clock from 12
  // sets bearing = 90°). Uses pointer events for unified mouse/touch/pen.
  let activePointer: number | null = null;
  let dragStartAngle = 0;
  let dragStartBearing = 0;

  const pointerAngleDeg = (ev: PointerEvent): number => {
    const rect = root.getBoundingClientRect();
    const px = ev.clientX - (rect.left + rect.width / 2);
    const py = ev.clientY - (rect.top + rect.height / 2);
    // atan2 returns angle from +x axis CCW. We want compass (0° = up, CW).
    const rad = Math.atan2(py, px);
    let deg = (rad * 180) / Math.PI + 90;
    if (deg < 0) deg += 360;
    return deg;
  };

  root.addEventListener("pointerdown", (ev) => {
    if (activePointer !== null) return;
    activePointer = ev.pointerId;
    dragStartAngle = pointerAngleDeg(ev);
    dragStartBearing = getObservation().bearingDeg;
    root.setPointerCapture(ev.pointerId);
    root.focus();
    ev.preventDefault();
  });
  root.addEventListener("pointermove", (ev) => {
    if (activePointer !== ev.pointerId) return;
    const now = pointerAngleDeg(ev);
    const delta = now - dragStartAngle;
    setObservation({ bearingDeg: dragStartBearing + delta });
  });
  const endDrag = (ev: PointerEvent): void => {
    if (activePointer !== ev.pointerId) return;
    activePointer = null;
    if (root.hasPointerCapture(ev.pointerId)) root.releasePointerCapture(ev.pointerId);
  };
  root.addEventListener("pointerup", endDrag);
  root.addEventListener("pointercancel", endDrag);

  // ---------------------------------------------------------------------------
  // Keyboard. Focus lives on the SVG slider.
  root.addEventListener("keydown", (ev) => {
    const step = ev.shiftKey ? 30 : 5;
    const cur = getObservation().bearingDeg;
    if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") {
      setObservation({ bearingDeg: cur - step });
      ev.preventDefault();
    } else if (ev.key === "ArrowRight" || ev.key === "ArrowUp") {
      setObservation({ bearingDeg: cur + step });
      ev.preventDefault();
    } else if (ev.key === "Home") {
      setObservation({ bearingDeg: 0 });
      ev.preventDefault();
    } else if (ev.key === "End") {
      setObservation({ bearingDeg: 180 });
      ev.preventDefault();
    }
  });
}
