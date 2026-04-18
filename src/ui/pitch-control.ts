// Pitch (tilt) widget. Vertical SVG slider-like indicator showing the
// current view pitch relative to the horizon with drag + keyboard
// controls. Mirrors compass.ts's structure (SVG slider with aria
// semantics, pointer drag, keyboard handling).
import { getObservation, setObservation, subscribe } from "../app/observation-store";

const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_PITCH = -30;
const MAX_PITCH = 90;

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function formatReadout(pitchDeg: number): string {
  const rounded = Math.round(pitchDeg);
  if (rounded === 0) return "Level with horizon (0°)";
  if (rounded > 0) return `${rounded}° above horizon`;
  return `${Math.abs(rounded)}° below horizon`;
}

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

export function mountPitchControl(parent: HTMLElement): void {
  const panel = document.createElement("div");
  panel.className = "panel pitch-control";
  panel.setAttribute("aria-label", "Pitch");

  const width = 44;
  const height = 110;
  const cx = width / 2;
  // The vertical axis runs between topY (pitch = +90) and bottomY
  // (pitch = −30), with the horizon line at whatever fraction of the
  // range 0° lands.
  const topY = 8;
  const bottomY = height - 8;
  const trackLen = bottomY - topY;

  const root = svg("svg", {
    class: "pitch-svg",
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    role: "slider",
    "aria-label": "Pitch (view tilt above horizon)",
    "aria-valuemin": MIN_PITCH,
    "aria-valuemax": MAX_PITCH,
    "aria-valuenow": 0,
    "aria-orientation": "vertical",
    tabindex: 0,
  }) as SVGSVGElement;

  // Helper: map pitchDeg → y on the track.
  const pitchToY = (pitchDeg: number): number => {
    const t = (pitchDeg - MIN_PITCH) / (MAX_PITCH - MIN_PITCH);
    // +pitch = up, so higher pitch → smaller y (closer to top).
    return bottomY - t * trackLen;
  };
  const yToPitch = (y: number): number => {
    const t = 1 - (y - topY) / trackLen;
    return clamp(MIN_PITCH + t * (MAX_PITCH - MIN_PITCH), MIN_PITCH, MAX_PITCH);
  };

  // Track background.
  root.append(
    svg("line", {
      x1: cx,
      y1: topY,
      x2: cx,
      y2: bottomY,
      stroke: "rgba(255,255,255,0.22)",
      "stroke-width": 2,
      "stroke-linecap": "round",
    })
  );

  // Degree ticks. Longer tick + label at −30, 0, 30, 60, 90; 0 is the
  // horizon and gets the accent colour.
  const TICKS: Array<{ deg: number; major: boolean; accent: boolean }> = [
    { deg: -30, major: true, accent: false },
    { deg: 0, major: true, accent: true },
    { deg: 30, major: true, accent: false },
    { deg: 60, major: true, accent: false },
    { deg: 90, major: true, accent: false },
  ];
  for (const { deg, major, accent } of TICKS) {
    const y = pitchToY(deg);
    const len = major ? 8 : 4;
    root.append(
      svg("line", {
        x1: cx - len,
        y1: y,
        x2: cx + len,
        y2: y,
        stroke: accent ? "var(--accent)" : "rgba(255,255,255,0.45)",
        "stroke-width": accent ? 1.5 : 1,
      })
    );
    const label = svg("text", {
      x: cx + len + 4,
      y: y + 3,
      "font-size": 9,
      fill: accent ? "var(--accent)" : "var(--fg-muted)",
      class: "pitch-label",
    });
    label.textContent = `${deg}`;
    root.append(label);
  }

  // Indicator triangle that slides up/down to show current pitch.
  const indicator = svg("path", {
    d: "",
    fill: "var(--accent)",
    stroke: "rgba(0,0,0,0.55)",
    "stroke-width": 0.8,
    class: "pitch-indicator",
  }) as SVGPathElement;
  root.append(indicator);

  panel.append(root);

  const readout = document.createElement("div");
  readout.className = "readout pitch-readout";
  readout.setAttribute("aria-hidden", "true");
  panel.append(readout);

  parent.append(panel);

  const applyPitch = (pitchDeg: number): void => {
    const clamped = clamp(pitchDeg, MIN_PITCH, MAX_PITCH);
    const y = pitchToY(clamped);
    // Small right-pointing arrow whose tip sits at (cx, y).
    indicator.setAttribute(
      "d",
      `M ${cx - 8} ${y - 5} L ${cx} ${y} L ${cx - 8} ${y + 5} Z`
    );
    root.setAttribute("aria-valuenow", String(Math.round(clamped)));
    root.setAttribute("aria-valuetext", formatReadout(clamped));
    readout.textContent = formatReadout(clamped);
  };
  subscribe((obs) => applyPitch(obs.pitchDeg));
  applyPitch(getObservation().pitchDeg);

  // Drag on the widget: set pitch to whatever degree value corresponds
  // to the pointer's vertical position on the track.
  let activePointer: number | null = null;
  const pointerY = (ev: PointerEvent): number => {
    const rect = root.getBoundingClientRect();
    return ev.clientY - rect.top;
  };
  root.addEventListener("pointerdown", (ev) => {
    if (activePointer !== null) return;
    activePointer = ev.pointerId;
    setObservation({ pitchDeg: yToPitch(pointerY(ev)) });
    try {
      root.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    root.focus();
    ev.preventDefault();
  });
  root.addEventListener("pointermove", (ev) => {
    if (activePointer !== ev.pointerId) return;
    setObservation({ pitchDeg: yToPitch(pointerY(ev)) });
  });
  const endDrag = (ev: PointerEvent): void => {
    if (activePointer !== ev.pointerId) return;
    activePointer = null;
    try {
      if (root.hasPointerCapture(ev.pointerId)) {
        root.releasePointerCapture(ev.pointerId);
      }
    } catch {
      /* ignore */
    }
  };
  root.addEventListener("pointerup", endDrag);
  root.addEventListener("pointercancel", endDrag);

  // Keyboard on the focused widget.
  root.addEventListener("keydown", (ev) => {
    const step = ev.shiftKey ? 30 : 5;
    const cur = getObservation().pitchDeg;
    if (ev.key === "ArrowUp") {
      setObservation({ pitchDeg: clamp(cur + step, MIN_PITCH, MAX_PITCH) });
      ev.preventDefault();
    } else if (ev.key === "ArrowDown") {
      setObservation({ pitchDeg: clamp(cur - step, MIN_PITCH, MAX_PITCH) });
      ev.preventDefault();
    } else if (ev.key === "Home") {
      setObservation({ pitchDeg: 0 });
      ev.preventDefault();
    } else if (ev.key === "End") {
      setObservation({ pitchDeg: MAX_PITCH });
      ev.preventDefault();
    }
  });
}
