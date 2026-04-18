// T058 — Field-of-view control. Binds gestures (wheel on desktop, pinch on
// touch, global +/- keys) to the shared canvas, and mounts an interactive
// panel showing the current FOV numerically plus a draggable scale bar.
// Implements FR-005a.
import { getObservation, setObservation, subscribe } from "../app/observation-store";

const MIN_FOV = 30;
const MAX_FOV = 180;
const KEY_STEP_DEG = 5;
const KEY_STEP_LARGE_DEG = 30;
const WHEEL_STEP_DEG = 5;

interface TouchPoint {
  id: number;
  x: number;
  y: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function mountFovControl(
  canvasForGestures: HTMLCanvasElement,
  indicatorParent: HTMLElement
): void {
  // ---------------------------------------------------------------------------
  // Indicator UI.
  const panel = document.createElement("div");
  panel.className = "panel fov-control";
  panel.setAttribute("aria-label", "Field of view");

  const readout = document.createElement("span");
  readout.className = "readout fov-readout";
  panel.append(readout);

  // The bar acts as a slider: role="slider" + full ARIA contract.
  const bar = document.createElement("div");
  bar.className = "fov-bar";
  bar.setAttribute("role", "slider");
  bar.setAttribute("aria-label", "Field of view");
  bar.setAttribute("aria-valuemin", String(MIN_FOV));
  bar.setAttribute("aria-valuemax", String(MAX_FOV));
  bar.setAttribute("aria-valuenow", String(getObservation().fovDeg));
  bar.tabIndex = 0;
  const marker = document.createElement("div");
  marker.className = "fov-bar-marker";
  bar.append(marker);
  panel.append(bar);

  indicatorParent.append(panel);

  const applyFov = (fovDeg: number): void => {
    const clamped = clamp(fovDeg, MIN_FOV, MAX_FOV);
    readout.textContent = `FOV: ${Math.round(clamped)}°`;
    const pct = ((clamped - MIN_FOV) / (MAX_FOV - MIN_FOV)) * 100;
    marker.style.setProperty("--fov-pct", `${pct}%`);
    bar.setAttribute("aria-valuenow", String(Math.round(clamped)));
    bar.setAttribute(
      "aria-valuetext",
      `${Math.round(clamped)} degrees`
    );
  };
  subscribe((obs) => applyFov(obs.fovDeg));
  applyFov(getObservation().fovDeg);

  // ---------------------------------------------------------------------------
  // Direct interaction on the FOV bar: pointer-down → set-from-x, then drag.
  // This is in addition to the canvas gestures below; both paths write to
  // the same store so they stay in sync.
  const fovFromClientX = (clientX: number): number => {
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return getObservation().fovDeg;
    const t = (clientX - rect.left) / rect.width;
    const tClamped = clamp(t, 0, 1);
    return MIN_FOV + tClamped * (MAX_FOV - MIN_FOV);
  };

  let barDragPointerId: number | null = null;
  bar.addEventListener("pointerdown", (ev: PointerEvent) => {
    barDragPointerId = ev.pointerId;
    try {
      bar.setPointerCapture(ev.pointerId);
    } catch {
      // Capture failures are non-fatal; drag still works via window-level
      // pointermove (browsers without setPointerCapture still dispatch
      // events to the original target while the button is down).
    }
    setObservation({ fovDeg: fovFromClientX(ev.clientX) });
    ev.preventDefault();
  });
  bar.addEventListener("pointermove", (ev: PointerEvent) => {
    if (barDragPointerId === null || ev.pointerId !== barDragPointerId) return;
    setObservation({ fovDeg: fovFromClientX(ev.clientX) });
    ev.preventDefault();
  });
  const endBarDrag = (ev: PointerEvent): void => {
    if (barDragPointerId === null || ev.pointerId !== barDragPointerId) return;
    try {
      bar.releasePointerCapture(ev.pointerId);
    } catch {
      // Ignore.
    }
    barDragPointerId = null;
  };
  bar.addEventListener("pointerup", endBarDrag);
  bar.addEventListener("pointercancel", endBarDrag);

  // Focused-widget keyboard: ArrowLeft/Right ±5°, Shift ±30°, Home → 90°.
  bar.addEventListener("keydown", (ev: KeyboardEvent) => {
    const cur = getObservation().fovDeg;
    const step = ev.shiftKey ? KEY_STEP_LARGE_DEG : KEY_STEP_DEG;
    if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") {
      setObservation({ fovDeg: clamp(cur - step, MIN_FOV, MAX_FOV) });
      ev.preventDefault();
    } else if (ev.key === "ArrowRight" || ev.key === "ArrowUp") {
      setObservation({ fovDeg: clamp(cur + step, MIN_FOV, MAX_FOV) });
      ev.preventDefault();
    } else if (ev.key === "Home") {
      setObservation({ fovDeg: 90 });
      ev.preventDefault();
    } else if (ev.key === "End") {
      setObservation({ fovDeg: MAX_FOV });
      ev.preventDefault();
    } else if (ev.key === "PageDown") {
      setObservation({ fovDeg: clamp(cur - KEY_STEP_LARGE_DEG, MIN_FOV, MAX_FOV) });
      ev.preventDefault();
    } else if (ev.key === "PageUp") {
      setObservation({ fovDeg: clamp(cur + KEY_STEP_LARGE_DEG, MIN_FOV, MAX_FOV) });
      ev.preventDefault();
    }
  });

  // ---------------------------------------------------------------------------
  // Wheel (desktop). One notch = ±WHEEL_STEP_DEG. Zoom-in (deltaY < 0) shrinks
  // FOV. Respect deltaMode: PIXEL (0), LINE (1 ≈ 16 px), PAGE (2 ≈ 100 lines).
  canvasForGestures.addEventListener(
    "wheel",
    (ev: WheelEvent) => {
      let dy = ev.deltaY;
      if (ev.deltaMode === 1) dy *= 16;
      else if (ev.deltaMode === 2) dy *= 16 * 20;
      if (dy === 0) return;
      const notches = Math.sign(dy) * Math.max(1, Math.min(4, Math.abs(dy) / 60));
      const cur = getObservation().fovDeg;
      const next = clamp(cur + notches * WHEEL_STEP_DEG, MIN_FOV, MAX_FOV);
      setObservation({ fovDeg: next });
      ev.preventDefault();
    },
    { passive: false }
  );

  // ---------------------------------------------------------------------------
  // Pinch (touch). Track exactly the two touches that were present at gesture
  // start. newFov = startFov / (currentDist / startDist).
  const activeTouches = new Map<number, TouchPoint>();
  let pinchStartDist = 0;
  let pinchStartFov = 0;
  let pinching = false;

  const dist = (a: TouchPoint, b: TouchPoint): number =>
    Math.hypot(a.x - b.x, a.y - b.y);

  const snapshotTouches = (): [TouchPoint, TouchPoint] | null => {
    const pts = Array.from(activeTouches.values());
    if (pts.length < 2) return null;
    const a = pts[0];
    const b = pts[1];
    if (!a || !b) return null;
    return [a, b];
  };

  canvasForGestures.addEventListener(
    "touchstart",
    (ev: TouchEvent) => {
      for (const t of Array.from(ev.changedTouches)) {
        activeTouches.set(t.identifier, {
          id: t.identifier,
          x: t.clientX,
          y: t.clientY,
        });
      }
      const pair = snapshotTouches();
      if (pair && !pinching) {
        pinching = true;
        pinchStartDist = dist(pair[0], pair[1]);
        pinchStartFov = getObservation().fovDeg;
      }
    },
    { passive: true }
  );
  canvasForGestures.addEventListener(
    "touchmove",
    (ev: TouchEvent) => {
      let touched = false;
      for (const t of Array.from(ev.changedTouches)) {
        if (activeTouches.has(t.identifier)) {
          activeTouches.set(t.identifier, {
            id: t.identifier,
            x: t.clientX,
            y: t.clientY,
          });
          touched = true;
        }
      }
      if (!touched || !pinching) return;
      const pair = snapshotTouches();
      if (!pair) return;
      const d = dist(pair[0], pair[1]);
      if (pinchStartDist <= 0 || d <= 0) return;
      const ratio = d / pinchStartDist;
      const next = clamp(pinchStartFov / ratio, MIN_FOV, MAX_FOV);
      setObservation({ fovDeg: next });
      ev.preventDefault();
    },
    { passive: false }
  );
  const endTouch = (ev: TouchEvent): void => {
    for (const t of Array.from(ev.changedTouches)) {
      activeTouches.delete(t.identifier);
    }
    if (activeTouches.size < 2 && pinching) {
      pinching = false;
    }
  };
  canvasForGestures.addEventListener("touchend", endTouch, { passive: true });
  canvasForGestures.addEventListener("touchcancel", endTouch, { passive: true });

  // ---------------------------------------------------------------------------
  // Global keyboard. Skip when an input has focus. (The bar widget's own
  // keydown handler above handles focused-widget keys like ArrowLeft.)
  document.addEventListener("keydown", (ev) => {
    if (isEditableTarget(ev.target)) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    // If the FOV bar itself has focus, its keydown handler already
    // processed the event — don't double-handle.
    if (ev.target === bar) return;
    const cur = getObservation().fovDeg;
    if (ev.key === "+" || ev.key === "=") {
      // Zoom in = smaller FOV.
      setObservation({ fovDeg: clamp(cur - KEY_STEP_DEG, MIN_FOV, MAX_FOV) });
      ev.preventDefault();
    } else if (ev.key === "-" || ev.key === "_") {
      setObservation({ fovDeg: clamp(cur + KEY_STEP_DEG, MIN_FOV, MAX_FOV) });
      ev.preventDefault();
    }
  });
}
