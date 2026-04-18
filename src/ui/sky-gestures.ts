// Single-finger / mouse / pen drag on the sky canvas to rotate the view.
//
// Horizontal drag ↔ bearingDeg; vertical drag ↔ pitchDeg. We scale the
// drag by the current horizontal FOV so that dragging across one full
// canvas width rotates by approximately one FOV-worth of sky, which
// feels right at every zoom level.
//
// Two-finger pinch on the canvas is owned by fov-control.ts. If a
// second pointer appears while we are dragging, we bail out of the
// drag so pinch can take over without fighting.
import { getObservation, setObservation } from "../app/observation-store";

const MIN_PITCH = -30;
const MAX_PITCH = 90;

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Wire pointer-based drag-to-rotate gestures on the sky canvas.
 * Horizontal drag updates bearingDeg, vertical drag updates pitchDeg.
 */
export function mountSkyGestures(canvas: HTMLCanvasElement): void {
  // Track all active pointers on the canvas so we can detect the
  // "second finger came down → abort drag, let pinch handle it" case.
  const activePointerIds = new Set<number>();

  // Drag state. `dragPointerId === null` means no drag is in progress.
  let dragPointerId: number | null = null;
  let lastX = 0;
  let lastY = 0;

  const endDrag = (): void => {
    if (dragPointerId === null) return;
    try {
      if (canvas.hasPointerCapture(dragPointerId)) {
        canvas.releasePointerCapture(dragPointerId);
      }
    } catch {
      /* capture may already be gone */
    }
    dragPointerId = null;
  };

  canvas.addEventListener("pointerdown", (ev: PointerEvent) => {
    // Skip events that originated on a UI control sitting atop the
    // canvas. Pointer events on children of #ui-overlay shouldn't
    // reach the canvas, but pointerdown on any overlaying element
    // still fires here with a different target, so filter.
    if (ev.target !== canvas) return;

    activePointerIds.add(ev.pointerId);

    // If a drag was already in progress and a second pointer came
    // down, let fov-control's pinch take over.
    if (dragPointerId !== null && ev.pointerId !== dragPointerId) {
      endDrag();
      return;
    }

    // If two+ pointers are down at drag start, this is not a drag —
    // it's a pinch being owned by fov-control. Don't start a drag.
    if (activePointerIds.size > 1) return;

    dragPointerId = ev.pointerId;
    lastX = ev.clientX;
    lastY = ev.clientY;
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch {
      /* capture not supported in this env (jsdom, etc.) */
    }
  });

  canvas.addEventListener("pointermove", (ev: PointerEvent) => {
    if (dragPointerId !== ev.pointerId) return;
    // If a second pointer slipped in between pointerdown and now, bail.
    if (activePointerIds.size > 1) {
      endDrag();
      return;
    }

    const dx = ev.clientX - lastX;
    const dy = ev.clientY - lastY;
    lastX = ev.clientX;
    lastY = ev.clientY;

    // Canvas size in CSS pixels. Guard against zero (can happen in
    // offscreen test canvases) so we never divide by zero.
    const w = Math.max(1, canvas.clientWidth || canvas.width);
    const h = Math.max(1, canvas.clientHeight || canvas.height);
    const obs = getObservation();
    const fovDeg = obs.fovDeg;
    // Vertical FOV = horizontal FOV × (h/w). Use that so vertical drag
    // speed matches the on-screen angular speed the user is reading.
    const aspectInverse = h / w;

    // Positive dx (finger moves right) → bearing increases, i.e. view
    // rotates to the right.
    const dBearingDeg = (dx / w) * fovDeg;
    // Positive dy (finger moves DOWN) → pitch increases, i.e. the
    // view appears to "look up". This mirrors a map/panorama's pull
    // gesture: dragging the sky down brings the upper sky into view.
    const dPitchDeg = (dy / h) * fovDeg * aspectInverse;

    const nextBearing = obs.bearingDeg + dBearingDeg;
    const nextPitch = clamp(obs.pitchDeg + dPitchDeg, MIN_PITCH, MAX_PITCH);
    setObservation({ bearingDeg: nextBearing, pitchDeg: nextPitch });
  });

  const handleEnd = (ev: PointerEvent): void => {
    activePointerIds.delete(ev.pointerId);
    if (dragPointerId === ev.pointerId) {
      endDrag();
    }
  };
  canvas.addEventListener("pointerup", handleEnd);
  canvas.addEventListener("pointercancel", handleEnd);
  canvas.addEventListener("pointerleave", (ev) => {
    // pointerleave without pointerup (e.g. mouse exits the window) —
    // treat as drag cancellation.
    if (dragPointerId === ev.pointerId) {
      endDrag();
    }
  });
}
