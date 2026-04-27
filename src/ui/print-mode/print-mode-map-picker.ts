// 003 — Issue #3: dedicated map picker for Print Mode that writes to
// print-job-store.observation.location. Mirrors src/ui/map-picker.ts in
// look + behaviour (city autocomplete + tap-to-pin world map +
// "Use my location" geolocation), but does NOT share state with it.
//
// Pure adapter — does not modify the main map-picker. Reuses the same
// /data/cities.json and /data/world.svg payloads (no extra network).
//
// Public API: openPrintModeLocationPicker(onPick) presents the modal and
// invokes the callback with { lat, lon, label } when the user confirms.

import { resolveTz } from "../tz-resolver";

interface City {
  name: string;
  asciiName: string;
  country: string;
  lat: number;
  lon: number;
  population: number;
}

export interface PickedLocation {
  lat: number;
  lon: number;
  label: string | null;
  timeZone?: string;
  utcOffsetMinutes?: number;
}

let citiesCache: City[] | null = null;
let citiesPromise: Promise<City[]> | null = null;
let worldSvgCache: string | null = null;
let worldSvgPromise: Promise<string> | null = null;

async function loadCities(): Promise<City[]> {
  if (citiesCache) return citiesCache;
  if (!citiesPromise) {
    citiesPromise = fetch("data/cities.json")
      .then((r) => {
        if (!r.ok) throw new Error(`cities.json HTTP ${r.status}`);
        return r.json() as Promise<City[]>;
      })
      .then((data) => {
        citiesCache = data;
        return data;
      });
  }
  return citiesPromise;
}

async function loadWorldSvg(): Promise<string> {
  if (worldSvgCache) return worldSvgCache;
  if (!worldSvgPromise) {
    worldSvgPromise = fetch("data/world.svg")
      .then((r) => {
        if (!r.ok) throw new Error(`world.svg HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        worldSvgCache = text;
        return text;
      });
  }
  return worldSvgPromise;
}

function normaliseQuery(q: string): string {
  return q
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

function searchCities(cities: City[], q: string, max = 8): City[] {
  const needle = normaliseQuery(q);
  if (!needle) return [];
  const out: City[] = [];
  for (const c of cities) {
    const n1 = c.asciiName.toLowerCase();
    const n2 = c.name.toLowerCase();
    if (n1.startsWith(needle) || n2.startsWith(needle)) {
      out.push(c);
      if (out.length >= max) break;
    }
  }
  return out;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function nearestCity(cities: City[], lat: number, lon: number): City | null {
  let best: City | null = null;
  let bestD = Infinity;
  for (const c of cities) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function getFocusable(root: HTMLElement): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  return Array.from(nodes).filter(
    (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
  );
}

interface Pin {
  lat: number;
  lon: number;
  label: string | null;
}

/**
 * Open the print-mode location picker. Returns when the modal closes;
 * `onPick` is called only on confirm (cancel/Escape resolves silently).
 */
export function openPrintModeLocationPicker(
  onPick: (pick: PickedLocation) => void,
): void {
  // Re-use the main map-picker's stylesheet (it lives under the
  // .map-picker-* prefix and is injected on first call). It's safe to
  // depend on its presence in production because src/app/main.ts mounts
  // the parent map picker on load. As a hardening measure, we still
  // ensure the styles are present — duplicate <style> tags with the
  // same id are silently ignored by the browser.
  // (Avoid re-importing the styles from main map-picker so we don't
  // pull `mountMapPicker` into the print-mode bundle.)
  ensureLocalStyles();

  const previouslyFocused = document.activeElement as HTMLElement | null;

  const backdrop = document.createElement("div");
  backdrop.className = "map-picker-backdrop print-mode-map-picker-backdrop";
  backdrop.addEventListener("click", (ev) => {
    if (ev.target === backdrop) close();
  });

  const dialog = document.createElement("div");
  dialog.className = "map-picker panel print-mode-map-picker";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "print-mode-map-picker-title");

  const title = document.createElement("h2");
  title.id = "print-mode-map-picker-title";
  title.textContent = "Search location";
  dialog.append(title);

  // Search row.
  const searchRow = document.createElement("div");
  searchRow.className = "map-picker-search-row";
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "Search cities";
  searchInput.setAttribute("aria-label", "Search cities");
  searchInput.setAttribute("aria-autocomplete", "list");
  searchInput.setAttribute("aria-controls", "print-mode-map-picker-results");
  searchInput.autocomplete = "off";
  searchInput.spellcheck = false;
  const geoBtn = document.createElement("button");
  geoBtn.type = "button";
  geoBtn.textContent = "Use my location";
  geoBtn.setAttribute("aria-label", "Use my current location");
  searchRow.append(searchInput, geoBtn);
  dialog.append(searchRow);

  const resultsList = document.createElement("ul");
  resultsList.className = "map-picker-results";
  resultsList.id = "print-mode-map-picker-results";
  resultsList.setAttribute("role", "listbox");
  dialog.append(resultsList);

  const statusRegion = document.createElement("div");
  statusRegion.className = "map-picker-status";
  statusRegion.setAttribute("role", "status");
  statusRegion.setAttribute("aria-live", "polite");
  dialog.append(statusRegion);

  // Map.
  const mapWrap = document.createElement("div");
  mapWrap.className = "map-picker-svg-wrap";
  mapWrap.setAttribute("role", "application");
  mapWrap.setAttribute("aria-label", "World map. Tap to drop a pin.");
  mapWrap.tabIndex = 0;
  const pin = document.createElement("div");
  pin.className = "map-picker-pin";
  pin.hidden = true;
  mapWrap.append(pin);
  dialog.append(mapWrap);

  const readout = document.createElement("div");
  readout.className = "map-picker-readout";
  readout.setAttribute("aria-live", "polite");
  readout.textContent = "No location selected.";
  dialog.append(readout);

  // Actions.
  const actions = document.createElement("div");
  actions.className = "map-picker-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "map-picker-confirm";
  confirmBtn.textContent = "Confirm";
  confirmBtn.disabled = true;
  actions.append(cancelBtn, confirmBtn);
  dialog.append(actions);

  backdrop.append(dialog);
  document.body.append(backdrop);

  // State.
  let currentPin: Pin | null = null;
  let activeResultIdx = -1;
  let lastResults: City[] = [];

  function setPin(next: Pin): void {
    currentPin = next;
    positionPin();
    const latStr = next.lat.toFixed(3);
    const lonStr = next.lon.toFixed(3);
    readout.textContent = next.label
      ? `${next.label} (${latStr}, ${lonStr})`
      : `Pin at (${latStr}, ${lonStr})`;
    confirmBtn.disabled = false;
  }

  function positionPin(): void {
    if (!currentPin) {
      pin.hidden = true;
      return;
    }
    const xFrac = (currentPin.lon - -180) / 360;
    const yFrac = (90 - currentPin.lat) / 180;
    pin.style.left = `${xFrac * 100}%`;
    pin.style.top = `${yFrac * 100}%`;
    pin.hidden = false;
  }

  function clientToLatLon(clientX: number, clientY: number): Pin | null {
    const rect = mapWrap.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const xFrac = (clientX - rect.left) / rect.width;
    const yFrac = (clientY - rect.top) / rect.height;
    if (xFrac < 0 || xFrac > 1 || yFrac < 0 || yFrac > 1) return null;
    const lon = -180 + xFrac * 360;
    const lat = 90 - yFrac * 180;
    return { lat, lon, label: null };
  }

  loadWorldSvg()
    .then((svgText) => {
      mapWrap.insertAdjacentHTML("afterbegin", svgText);
      const svgEl = mapWrap.querySelector("svg");
      if (svgEl) {
        svgEl.setAttribute("preserveAspectRatio", "none");
        svgEl.setAttribute("aria-hidden", "true");
      }
      positionPin();
    })
    .catch((err) => {
      const msg = document.createElement("div");
      msg.className = "map-picker-error";
      msg.textContent = "Map unavailable (offline and not yet cached).";
      mapWrap.append(msg);
      // eslint-disable-next-line no-console
      console.warn("print-mode-map-picker: world.svg failed", err);
    });

  mapWrap.addEventListener("click", (ev) => {
    const p = clientToLatLon(ev.clientX, ev.clientY);
    if (!p) return;
    setPin(p);
  });

  // Search.
  let searchToken = 0;
  searchInput.addEventListener("input", () => {
    const q = searchInput.value;
    const token = ++searchToken;
    if (!q.trim()) {
      resultsList.replaceChildren();
      statusRegion.textContent = "";
      lastResults = [];
      activeResultIdx = -1;
      return;
    }
    loadCities()
      .then((cities) => {
        if (token !== searchToken) return;
        const matches = searchCities(cities, q, 8);
        lastResults = matches;
        activeResultIdx = -1;
        renderResults(matches);
        statusRegion.textContent =
          matches.length === 0
            ? "No matches."
            : `${matches.length} match${matches.length === 1 ? "" : "es"}.`;
      })
      .catch((err) => {
        statusRegion.textContent = "City search unavailable.";
        // eslint-disable-next-line no-console
        console.warn("print-mode-map-picker: cities.json failed", err);
      });
  });

  function renderResults(matches: City[]): void {
    resultsList.replaceChildren();
    matches.forEach((c, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.id = `print-mode-map-picker-result-${i}`;
      const nm = document.createElement("span");
      nm.textContent = c.name;
      const ctry = document.createElement("span");
      ctry.className = "country";
      ctry.textContent = c.country;
      li.append(nm, ctry);
      li.addEventListener("click", () => selectCity(c));
      resultsList.append(li);
    });
  }

  function selectCity(c: City): void {
    setPin({ lat: c.lat, lon: c.lon, label: c.name });
    searchInput.value = c.name;
    resultsList.replaceChildren();
    statusRegion.textContent = `${c.name} selected.`;
    lastResults = [];
    activeResultIdx = -1;
  }

  searchInput.addEventListener("keydown", (ev) => {
    if (lastResults.length === 0) return;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      activeResultIdx = Math.min(lastResults.length - 1, activeResultIdx + 1);
      const items = Array.from(resultsList.querySelectorAll("li"));
      items.forEach((el, i) => {
        if (i === activeResultIdx) el.setAttribute("aria-selected", "true");
        else el.removeAttribute("aria-selected");
      });
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      activeResultIdx = Math.max(0, activeResultIdx - 1);
      const items = Array.from(resultsList.querySelectorAll("li"));
      items.forEach((el, i) => {
        if (i === activeResultIdx) el.setAttribute("aria-selected", "true");
        else el.removeAttribute("aria-selected");
      });
    } else if (ev.key === "Enter") {
      const idx = activeResultIdx >= 0 ? activeResultIdx : 0;
      const c = lastResults[idx];
      if (c) {
        ev.preventDefault();
        selectCity(c);
      }
    }
  });

  // Geolocation.
  geoBtn.addEventListener("click", () => {
    if (!("geolocation" in navigator)) return;
    statusRegion.textContent = "Requesting location...";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        loadCities()
          .then((cities) => {
            const near = nearestCity(cities, latitude, longitude);
            const label = near ? near.name : null;
            setPin({ lat: latitude, lon: longitude, label });
            statusRegion.textContent = near ? `Located near ${near.name}.` : "Location set.";
          })
          .catch(() => {
            setPin({ lat: latitude, lon: longitude, label: null });
          });
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.warn("print-mode-map-picker: geolocation denied", err);
      },
      { maximumAge: 60_000, timeout: 10_000 },
    );
  });

  function close(): void {
    backdrop.remove();
    if (previouslyFocused && document.contains(previouslyFocused)) {
      previouslyFocused.focus();
    }
  }

  cancelBtn.addEventListener("click", () => close());
  confirmBtn.addEventListener("click", () => {
    if (!currentPin) return;
    const out: PickedLocation = {
      lat: currentPin.lat,
      lon: currentPin.lon,
      label: currentPin.label,
    };
    try {
      const tz = resolveTz(currentPin.lat, currentPin.lon, Date.now());
      out.timeZone = tz.zone;
      out.utcOffsetMinutes = tz.offsetMinutes;
    } catch {
      // tz table not loaded yet — proceed without it.
    }
    onPick(out);
    close();
  });

  // Focus trap + Escape.
  dialog.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      close();
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

  queueMicrotask(() => searchInput.focus());
}

/**
 * Inject a minimal stylesheet for the print-mode map picker. The base
 * styles (.map-picker-*) are owned by src/ui/map-picker.ts; here we only
 * add print-mode-specific overrides.
 */
function ensureLocalStyles(): void {
  if (document.getElementById("print-mode-map-picker-styles")) return;
  const style = document.createElement("style");
  style.id = "print-mode-map-picker-styles";
  // Re-declare the base styles under .print-mode-map-picker-backdrop so
  // print-mode usage doesn't rely on the parent map picker having
  // already run (it usually has, but defence-in-depth is cheap here).
  style.textContent = `
.print-mode-map-picker-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(3, 5, 12, 0.6);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  z-index: 60;
  display: flex;
  align-items: stretch;
  justify-content: flex-end;
}
.print-mode-map-picker {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: min(520px, 100%);
  max-height: 100dvh;
  padding: 0.8rem 1rem 1rem;
  background: var(--ui-bg);
  border-left: 1px solid var(--ui-border);
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.5);
  color: var(--fg);
  overflow-y: auto;
}
.print-mode-map-picker .map-picker-svg-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 2 / 1;
  background: #0a1024;
  border: 1px solid var(--ui-border);
  border-radius: 0.45rem;
  overflow: hidden;
  touch-action: none;
}
.print-mode-map-picker .map-picker-svg-wrap svg {
  width: 100%;
  height: 100%;
  display: block;
}
.print-mode-map-picker .map-picker-svg-wrap svg path {
  fill: #2a3454;
  stroke: #475078;
  stroke-width: 0.3;
  vector-effect: non-scaling-stroke;
}
.print-mode-map-picker .map-picker-pin {
  position: absolute;
  width: 14px;
  height: 14px;
  margin-left: -7px;
  margin-top: -7px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid #111;
  box-shadow: 0 0 0 2px var(--accent);
  pointer-events: none;
}
.print-mode-map-picker .map-picker-pin[hidden] { display: none; }
.print-mode-map-picker .map-picker-results {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 10.5rem;
  overflow-y: auto;
  border: 1px solid var(--ui-border);
  border-radius: 0.4rem;
  background: rgba(255, 255, 255, 0.04);
}
.print-mode-map-picker .map-picker-results:empty { display: none; }
.print-mode-map-picker .map-picker-results li {
  padding: 0.35rem 0.55rem;
  cursor: pointer;
  font-size: var(--fs-sm);
  display: flex;
  justify-content: space-between;
  gap: 0.4rem;
}
.print-mode-map-picker .map-picker-results li:hover,
.print-mode-map-picker .map-picker-results li[aria-selected="true"] {
  background: rgba(245, 215, 110, 0.22);
}
.print-mode-map-picker .map-picker-results li .country {
  color: var(--fg-muted);
}
.print-mode-map-picker .map-picker-search-row {
  display: flex;
  gap: 0.4rem;
  align-items: stretch;
}
.print-mode-map-picker .map-picker-search-row input[type="text"] {
  flex: 1;
  min-width: 0;
}
.print-mode-map-picker .map-picker-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: auto;
  padding-top: 0.4rem;
}
.print-mode-map-picker .map-picker-confirm {
  background: rgba(245, 215, 110, 0.22);
  border-color: var(--accent);
}
.print-mode-map-picker .map-picker-readout {
  font-size: var(--fs-sm);
  color: var(--fg-muted);
  min-height: 1.2em;
}
.print-mode-map-picker .map-picker-status {
  font-size: var(--fs-sm);
  color: var(--fg-muted);
  min-height: 1.2em;
}
.print-mode-map-picker .map-picker-error {
  color: var(--danger);
  font-size: var(--fs-sm);
}
`;
  document.head.append(style);
}
