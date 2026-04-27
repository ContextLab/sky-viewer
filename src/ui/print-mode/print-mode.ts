// T031 / T036 / T036a — Print Mode overlay shell.
//
// Mounts a "Print Mode" trigger button. Clicking opens a full-screen
// overlay (role="dialog", focus-trapped, Esc-to-close) hosting:
//   - Observation editor (T036a)
//   - Room editor (T032)
//   - Feature panel (T033)
//   - Output options (T034)
//   - Compute / Pre-flight / Download (T035)
//
// Subscribes to the print-job-store ONCE here so descendant widgets
// share a single subscription. Each child widget reads the latest job
// via getPrintJob() in its own refresh callback registered via the
// `register` helper below.
//
// State (room, features, observation, output options) is persisted via
// the store; closing the overlay does NOT reset the job (T055).

import { getPrintJob, subscribe } from "../../print/print-job-store";
import { mountObservationEditor } from "./observation-editor";
import { mountRoomEditor } from "./room-editor";
import { mountFeaturePanel } from "./feature-panel";
import { mountOutputOptions } from "./output-options";
import { mountComputeButton } from "./compute-progress";

let stylesInjected = false;

function ensureStylesInjected(): void {
  if (stylesInjected) return;
  // Styles live in src/styles.css under .print-mode-* selectors. We only
  // gate the trigger here — no per-widget injection.
  stylesInjected = true;
}

function getFocusable(root: HTMLElement): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  return Array.from(nodes).filter(
    (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
  );
}

export function mountPrintMode(triggerHost: HTMLElement): void {
  ensureStylesInjected();

  const triggerBtn = document.createElement("button");
  triggerBtn.type = "button";
  triggerBtn.className = "print-mode-trigger";
  triggerBtn.textContent = "🖨 Print Mode";
  triggerBtn.setAttribute("aria-haspopup", "dialog");
  triggerBtn.setAttribute("aria-label", "Open Print Mode");
  triggerBtn.title = "Open Print Mode — generate a star-stencil PDF";
  triggerBtn.addEventListener("click", () => openOverlay());
  triggerHost.append(triggerBtn);

  let overlayEl: HTMLElement | null = null;
  let previouslyFocused: HTMLElement | null = null;
  let unsubscribe: (() => void) | null = null;
  // Per-widget refresh callbacks. Each child widget registers its own
  // refresh via the `register` helper passed to it; the single store
  // subscription below fans out to all of them.
  const refreshers: Array<() => void> = [];

  function register(refresh: () => void): void {
    refreshers.push(refresh);
  }

  function openOverlay(): void {
    if (overlayEl) return;
    previouslyFocused = document.activeElement as HTMLElement | null;
    refreshers.length = 0;

    const backdrop = document.createElement("div");
    backdrop.className = "print-mode-backdrop";
    backdrop.addEventListener("click", (ev) => {
      if (ev.target === backdrop) closeOverlay();
    });

    const dialog = document.createElement("div");
    dialog.className = "print-mode-overlay";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Print Mode");
    dialog.tabIndex = -1;

    // ---- Header ----
    const header = document.createElement("header");
    header.className = "print-mode-header";

    const title = document.createElement("h1");
    title.className = "print-mode-title";
    title.textContent = "Print Mode — Star Stencil PDF";
    header.append(title);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "print-mode-close";
    closeBtn.textContent = "Close";
    closeBtn.setAttribute("aria-label", "Close Print Mode");
    closeBtn.addEventListener("click", () => closeOverlay());
    header.append(closeBtn);

    dialog.append(header);

    // ---- Body: three-column on desktop, stacked on mobile ----
    const body = document.createElement("div");
    body.className = "print-mode-body";

    const colObservation = document.createElement("section");
    colObservation.className = "print-mode-col print-mode-col-observation";

    const colRoom = document.createElement("section");
    colRoom.className = "print-mode-col print-mode-col-room";

    const colOutput = document.createElement("section");
    colOutput.className = "print-mode-col print-mode-col-output";

    body.append(colObservation, colRoom, colOutput);
    dialog.append(body);

    backdrop.append(dialog);
    document.body.append(backdrop);
    overlayEl = backdrop;

    // ---- Mount child widgets ----
    // Observation editor: date / time / location / facing direction.
    mountObservationEditor(colObservation, register);

    // Room editor: SVG floor-plan + ceiling/eye height + observer position.
    mountRoomEditor(colRoom, register);
    // Feature panel: light fixture placement + paint/no-paint toggles.
    mountFeaturePanel(colRoom, register);

    // Output options + Compute button.
    mountOutputOptions(colOutput, register);
    mountComputeButton(colOutput, register);

    // ---- Single store subscription, fans out to widget refreshers ----
    const fanOut = (): void => {
      for (const r of refreshers) r();
    };
    unsubscribe = subscribe(() => fanOut());
    // Initial paint with current store state.
    fanOut();
    // Touch the store getter so static analysis flags any unused-import
    // regressions early.
    void getPrintJob();

    // ---- Esc + focus trap ----
    dialog.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        closeOverlay();
        return;
      }
      if (ev.key === "Tab") {
        const focusables = getFocusable(dialog);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
        const active = document.activeElement as HTMLElement | null;
        if (ev.shiftKey && active === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && active === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    });

    // Initial focus: close button is first tabbable; jump to it on a
    // microtask so the element is in the DOM before focus.
    queueMicrotask(() => closeBtn.focus());
  }

  function closeOverlay(): void {
    if (!overlayEl) return;
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    refreshers.length = 0;
    overlayEl.remove();
    overlayEl = null;
    if (previouslyFocused && document.contains(previouslyFocused)) {
      previouslyFocused.focus();
    }
    previouslyFocused = null;
  }
}

/** Type for child-widget refresh registration. Re-exported for the
 *  observation-editor, room-editor, feature-panel, output-options, and
 *  compute-progress modules to consume. */
export type RegisterRefresh = (refresh: () => void) => void;
