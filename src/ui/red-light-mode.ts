// Red Light Mode — astronomer's dark-adaptation overlay.
//
// Purpose: preserve the user's rod-cell night vision. Human scotopic
// vision is ~9× more sensitive to red-end wavelengths than blue/green,
// so a saturated-red overlay lets the retina keep its low-light
// adaptation while still letting the user read the UI and see the sky.
// This is what pilots, astronomers, and submariners use.
//
// Implementation: a full-screen fixed-position `<div class="red-veil">`
// with `mix-blend-mode: multiply` and a saturated red background. The
// multiply blend guarantees that any green or blue channel is driven
// to near-zero while red channels pass through. Cheap, instant to
// toggle, and does not touch the canvas rendering path at all.
//
// Contract:
//   export function mountRedLightMode(parent: HTMLElement): void
//
// Side effects when active:
//   - Appends a `<div class="red-veil">` to document.body (once).
//   - Adds `red-light-active` class to document.body.
//   - Button aria-pressed mirrors active state.

let mounted = false;
let isActive = false;
let buttonEl: HTMLButtonElement | null = null;
let veilEl: HTMLDivElement | null = null;

function ensureVeil(): HTMLDivElement {
  if (veilEl) return veilEl;
  const veil = document.createElement("div");
  veil.className = "red-veil";
  // Hidden by default — only displayed when active. aria-hidden so
  // screen readers don't waste a breath on it.
  veil.setAttribute("aria-hidden", "true");
  veil.hidden = true;
  document.body.appendChild(veil);
  veilEl = veil;
  return veil;
}

function updateButtonUi(): void {
  if (!buttonEl) return;
  buttonEl.setAttribute("aria-pressed", String(isActive));
  // A circled-dot glyph evokes a red lamp / observatory bulb.
  buttonEl.textContent = isActive
    ? "\u25A0 Exit Night Vision"
    : "\u25CF Night Vision Mode";
  buttonEl.title = isActive
    ? "Turn off the red night-vision overlay"
    : "Apply a red overlay to preserve dark-adapted night vision (astronomer's red-light mode)";
}

function activate(): void {
  if (isActive) return;
  const veil = ensureVeil();
  veil.hidden = false;
  document.body.classList.add("red-light-active");
  isActive = true;
  updateButtonUi();
}

function deactivate(): void {
  if (!isActive) return;
  if (veilEl) veilEl.hidden = true;
  document.body.classList.remove("red-light-active");
  isActive = false;
  updateButtonUi();
}

/**
 * Mount a Red Light Mode toggle button inside `parent`. Subsequent
 * calls are no-ops (the module maintains a single overlay).
 */
export function mountRedLightMode(parent: HTMLElement): void {
  if (mounted) return;
  mounted = true;

  const panel = document.createElement("div");
  panel.className = "panel red-light-mode";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "red-light-mode-button";
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => {
    if (isActive) deactivate();
    else activate();
  });
  buttonEl = button;

  panel.append(button);
  parent.append(panel);

  // Pre-create the veil so toggling is instant (no layout flash on
  // first click). It's hidden until activate() is called.
  ensureVeil();

  updateButtonUi();
}

/** Test-only accessors. Exported so unit tests can inspect state. */
export function _redLightIsActive(): boolean {
  return isActive;
}
