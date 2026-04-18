// T049 / T050 / T051 / T053 — Map picker overlay.
// Offline-capable location chooser: inline world.svg with tap-to-pin,
// city search autocomplete over cities.json, and opt-in geolocation.
// Resolves the picked location's IANA tz via src/ui/tz-resolver.

import { resolveTz } from "./tz-resolver";

interface City {
  name: string;
  asciiName: string;
  country: string;
  lat: number;
  lon: number;
  population: number;
}

export interface MapPickerResult {
  lat: number;
  lon: number;
  label: string | null;
  timeZone?: string;
  utcOffsetMinutes?: number;
}

// Module-scoped caches so repeated opens don't refetch.
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

function ensureStylesInjected(): void {
  if (document.getElementById("map-picker-styles")) return;
  const style = document.createElement("style");
  style.id = "map-picker-styles";
  style.textContent = `
.map-picker-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(3, 5, 12, 0.6);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  z-index: 40;
  display: flex;
  align-items: stretch;
  justify-content: flex-end;
}
.map-picker {
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
@media (max-width: 640px) {
  .map-picker-backdrop { align-items: stretch; justify-content: stretch; }
  .map-picker { width: 100%; max-width: 100%; border-left: 0; }
}
.map-picker h2 {
  margin: 0 0 0.2rem;
  font-size: var(--fs-lg);
  color: var(--fg);
}
.map-picker .map-picker-search-row {
  display: flex;
  gap: 0.4rem;
  align-items: stretch;
}
.map-picker input[type="text"] {
  flex: 1;
  min-width: 0;
}
.map-picker .map-picker-results {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 10.5rem;
  overflow-y: auto;
  border: 1px solid var(--ui-border);
  border-radius: 0.4rem;
  background: rgba(255, 255, 255, 0.04);
}
.map-picker .map-picker-results:empty {
  display: none;
}
.map-picker .map-picker-results li {
  padding: 0.35rem 0.55rem;
  cursor: pointer;
  font-size: var(--fs-sm);
  display: flex;
  justify-content: space-between;
  gap: 0.4rem;
}
.map-picker .map-picker-results li:hover,
.map-picker .map-picker-results li[aria-selected="true"] {
  background: rgba(245, 215, 110, 0.22);
}
.map-picker .map-picker-results li .country {
  color: var(--fg-muted);
}
.map-picker .map-picker-svg-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 2 / 1;
  background: #0a1024;
  border: 1px solid var(--ui-border);
  border-radius: 0.45rem;
  overflow: hidden;
  touch-action: none;
}
.map-picker .map-picker-svg-wrap svg {
  width: 100%;
  height: 100%;
  display: block;
}
.map-picker .map-picker-svg-wrap svg path {
  fill: #2a3454;
  stroke: #475078;
  stroke-width: 0.3;
  vector-effect: non-scaling-stroke;
}
.map-picker .map-picker-pin {
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
  transition: opacity 120ms;
}
.map-picker .map-picker-pin[hidden] { display: none; }
.map-picker .map-picker-readout {
  font-size: var(--fs-sm);
  color: var(--fg-muted);
  min-height: 1.2em;
}
.map-picker .map-picker-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: auto;
  padding-top: 0.4rem;
}
.map-picker .map-picker-confirm {
  background: rgba(245, 215, 110, 0.22);
  border-color: var(--accent);
}
.map-picker .map-picker-status {
  font-size: var(--fs-sm);
  color: var(--fg-muted);
  min-height: 1.2em;
}
.map-picker .map-picker-error {
  color: var(--danger);
  font-size: var(--fs-sm);
}
`;
  document.head.append(style);
}

// Get all tabbable elements inside a container for focus-trap.
function getFocusable(root: HTMLElement): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  return Array.from(nodes).filter(
    (el) => !el.hasAttribute("disabled") && el.offsetParent !== null
  );
}

/**
 * Normalise a search query: lowercase, strip diacritics.
 */
function normaliseQuery(q: string): string {
  return q
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function searchCities(cities: City[], q: string, max = 8): City[] {
  const needle = normaliseQuery(q);
  if (!needle) return [];
  const out: City[] = [];
  // cities.json is pre-sorted by population (desc), so a linear scan returns
  // the top matches first.
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

interface Pin {
  lat: number;
  lon: number;
  label: string | null;
}

export function mountMapPicker(
  triggerHost: HTMLElement,
  tzLoaded: Promise<void>,
  onPick: (pick: MapPickerResult) => void
): void {
  ensureStylesInjected();

  const triggerBtn = document.createElement("button");
  triggerBtn.type = "button";
  triggerBtn.className = "map-picker-trigger";
  triggerBtn.textContent = "Location";
  triggerBtn.setAttribute("aria-haspopup", "dialog");
  triggerBtn.addEventListener("click", () => openPicker());
  triggerHost.append(triggerBtn);

  let overlay: HTMLElement | null = null;
  let previouslyFocused: HTMLElement | null = null;

  function openPicker(): void {
    if (overlay) return;
    previouslyFocused = document.activeElement as HTMLElement | null;

    const backdrop = document.createElement("div");
    backdrop.className = "map-picker-backdrop";
    backdrop.addEventListener("click", (ev) => {
      if (ev.target === backdrop) closePicker();
    });

    const dialog = document.createElement("div");
    dialog.className = "map-picker panel";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "map-picker-title");

    const title = document.createElement("h2");
    title.id = "map-picker-title";
    title.textContent = "Choose a location";
    dialog.append(title);

    // ---- Search row ----
    const searchRow = document.createElement("div");
    searchRow.className = "map-picker-search-row";

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search cities";
    searchInput.setAttribute("aria-label", "Search cities");
    searchInput.setAttribute("aria-autocomplete", "list");
    searchInput.setAttribute("aria-controls", "map-picker-results");
    searchInput.autocomplete = "off";
    searchInput.spellcheck = false;

    const geoBtn = document.createElement("button");
    geoBtn.type = "button";
    geoBtn.textContent = "Use my location";
    geoBtn.setAttribute("aria-label", "Use my current location");
    geoBtn.title = "Ask the browser for your current location";

    searchRow.append(searchInput, geoBtn);
    dialog.append(searchRow);

    const resultsList = document.createElement("ul");
    resultsList.className = "map-picker-results";
    resultsList.id = "map-picker-results";
    resultsList.setAttribute("role", "listbox");
    dialog.append(resultsList);

    const statusRegion = document.createElement("div");
    statusRegion.className = "map-picker-status";
    statusRegion.setAttribute("role", "status");
    statusRegion.setAttribute("aria-live", "polite");
    dialog.append(statusRegion);

    // ---- Map ----
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

    // ---- Actions ----
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
    overlay = backdrop;

    // ---- State ----
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
      // viewBox is -180 -90 360 180, so:
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

    // ---- Load SVG ----
    loadWorldSvg()
      .then((svgText) => {
        // Insert directly so it inherits our CSS path fills.
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
        console.warn("map-picker: world.svg failed", err);
      });

    mapWrap.addEventListener("click", (ev) => {
      const p = clientToLatLon(ev.clientX, ev.clientY);
      if (!p) return;
      setPin(p);
    });
    mapWrap.addEventListener("keydown", (ev) => {
      if (!currentPin && (ev.key === "Enter" || ev.key === " ")) {
        ev.preventDefault();
        setPin({ lat: 0, lon: 0, label: null });
      }
    });

    // ---- Search interactions ----
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
          console.warn("map-picker: cities.json failed", err);
        });
    });

    function renderResults(matches: City[]): void {
      resultsList.replaceChildren();
      matches.forEach((c, i) => {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.id = `map-picker-result-${i}`;
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

    function setActiveResult(idx: number): void {
      activeResultIdx = idx;
      const items = Array.from(resultsList.querySelectorAll("li"));
      items.forEach((el, i) => {
        if (i === idx) el.setAttribute("aria-selected", "true");
        else el.removeAttribute("aria-selected");
      });
      const active = items[idx];
      if (active) {
        searchInput.setAttribute("aria-activedescendant", active.id);
        active.scrollIntoView({ block: "nearest" });
      } else {
        searchInput.removeAttribute("aria-activedescendant");
      }
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
        setActiveResult(Math.min(lastResults.length - 1, activeResultIdx + 1));
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        setActiveResult(Math.max(0, activeResultIdx - 1));
      } else if (ev.key === "Enter") {
        if (activeResultIdx >= 0) {
          ev.preventDefault();
          const c = lastResults[activeResultIdx];
          if (c) selectCity(c);
        } else if (lastResults.length > 0) {
          ev.preventDefault();
          const c = lastResults[0];
          if (c) selectCity(c);
        }
      }
    });

    // ---- Geolocation ----
    geoBtn.addEventListener("click", () => {
      if (!("geolocation" in navigator)) {
        // eslint-disable-next-line no-console
        console.warn("map-picker: geolocation API absent");
        return;
      }
      statusRegion.textContent = "Requesting location...";
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          loadCities()
            .then((cities) => {
              const near = nearestCity(cities, latitude, longitude);
              const label = near ? `Nearest: ${near.name}` : null;
              setPin({ lat: latitude, lon: longitude, label });
              statusRegion.textContent = near
                ? `Located near ${near.name}.`
                : "Location set.";
            })
            .catch(() => {
              setPin({ lat: latitude, lon: longitude, label: null });
              statusRegion.textContent = "Location set.";
            });
        },
        (err) => {
          // eslint-disable-next-line no-console
          console.warn("map-picker: geolocation denied or failed", err);
        },
        { maximumAge: 60000, timeout: 10000 }
      );
    });

    // ---- Confirm / cancel ----
    confirmBtn.addEventListener("click", () => {
      if (!currentPin) return;
      const pick: MapPickerResult = {
        lat: currentPin.lat,
        lon: currentPin.lon,
        label: currentPin.label,
      };
      tzLoaded
        .then(() => {
          try {
            const tz = resolveTz(currentPin!.lat, currentPin!.lon, Date.now());
            pick.timeZone = tz.zone;
            pick.utcOffsetMinutes = tz.offsetMinutes;
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn("map-picker: tz resolution failed", err);
          }
        })
        .catch(() => {
          // tz table failed to load; proceed without tz fields.
        })
        .finally(() => {
          onPick(pick);
          closePicker();
        });
    });

    cancelBtn.addEventListener("click", () => closePicker());

    // ---- Accessibility: focus trap + Escape ----
    dialog.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        closePicker();
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

    // Initial focus after a microtask so the element is in the DOM.
    queueMicrotask(() => searchInput.focus());
  }

  function closePicker(): void {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    if (previouslyFocused && document.contains(previouslyFocused)) {
      previouslyFocused.focus();
    }
    previouslyFocused = null;
  }
}
