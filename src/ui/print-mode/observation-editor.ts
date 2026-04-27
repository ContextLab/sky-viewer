// T036a — Observation editor for Print Mode.
//
// Per the analyze-report C1 fix, this is a small from-scratch editor
// that reads/writes the print-job-store's `observation` field. It does
// NOT reuse the parent feature's `mountDateTimeInput` / `mountMapPicker`
// / `mountCompass` widgets, because those import the main observation
// store directly. Recreating a small dedicated editor avoids cross-store
// coupling and keeps both stores' refresh paths independent (FR-002).
//
// UI:
//   - Date input (HTML <input type="date">)
//   - Time input (HTML <input type="time">)
//   - Location: read-only readout "label (lat, lon)" + a "Change…"
//     button that opens a lat/lon prompt dialog.
//   - Facing direction: numeric degrees input (0..360) with a small SVG
//     compass rose preview.

import { getPrintJob, setPrintJob } from "../../print/print-job-store";
import type { RegisterRefresh } from "./print-mode";
import { openPrintModeLocationPicker } from "./print-mode-map-picker";

const SVG_NS = "http://www.w3.org/2000/svg";

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function reLocalizeUtc(localDate: string, localTime: string, offsetMinutes: number): string {
  // Build a Date from "YYYY-MM-DD" + "HH:MM" interpreted in the
  // observer's timezone (offsetMinutes is east-positive). Returns an
  // ISO 8601 UTC string. Falls back to the unchanged value if the
  // inputs don't parse — the print-job-store does not re-derive
  // utcInstant itself.
  const parts = localDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tparts = localTime.match(/^(\d{2}):(\d{2})$/);
  if (!parts || !tparts) return new Date().toISOString();
  const y = Number(parts[1]);
  const mo = Number(parts[2]) - 1;
  const d = Number(parts[3]);
  const hh = Number(tparts[1]);
  const mm = Number(tparts[2]);
  // UTC ms = local ms - offsetMinutes (east-positive).
  const utcMs = Date.UTC(y, mo, d, hh, mm, 0, 0) - offsetMinutes * 60_000;
  return new Date(utcMs).toISOString();
}

export function mountObservationEditor(host: HTMLElement, register: RegisterRefresh): void {
  const panel = document.createElement("section");
  panel.className = "print-mode-panel print-mode-observation";

  const heading = document.createElement("h2");
  heading.className = "print-mode-panel-heading";
  heading.textContent = "Observation";
  panel.append(heading);

  const helper = document.createElement("p");
  helper.className = "print-mode-helper";
  helper.textContent =
    "Date, time, location, and facing direction for the rendered sky.";
  panel.append(helper);

  // ---- Date + Time row ----
  const dateTimeRow = document.createElement("div");
  dateTimeRow.className = "print-mode-row";

  const dateLabel = document.createElement("label");
  dateLabel.className = "print-mode-field";
  const dateSpan = document.createElement("span");
  dateSpan.textContent = "Date";
  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.className = "print-mode-input";
  dateInput.setAttribute("aria-label", "Observation date");
  dateLabel.append(dateSpan, dateInput);

  const timeLabel = document.createElement("label");
  timeLabel.className = "print-mode-field";
  const timeSpan = document.createElement("span");
  timeSpan.textContent = "Time";
  const timeInput = document.createElement("input");
  timeInput.type = "time";
  timeInput.step = "60";
  timeInput.className = "print-mode-input";
  timeInput.setAttribute("aria-label", "Observation time");
  timeLabel.append(timeSpan, timeInput);

  dateTimeRow.append(dateLabel, timeLabel);
  panel.append(dateTimeRow);

  dateInput.addEventListener("change", () => {
    const job = getPrintJob();
    const newLocal = dateInput.value || job.observation.localDate;
    const utc = reLocalizeUtc(newLocal, job.observation.localTime, job.observation.utcOffsetMinutes);
    setPrintJob({
      observation: {
        ...job.observation,
        localDate: newLocal,
        utcInstant: utc,
      },
    });
  });
  timeInput.addEventListener("change", () => {
    const job = getPrintJob();
    const newLocal = timeInput.value || job.observation.localTime;
    const utc = reLocalizeUtc(job.observation.localDate, newLocal, job.observation.utcOffsetMinutes);
    setPrintJob({
      observation: {
        ...job.observation,
        localTime: newLocal,
        utcInstant: utc,
      },
    });
  });

  // ---- Location ----
  const locField = document.createElement("div");
  locField.className = "print-mode-field";
  const locHeading = document.createElement("span");
  locHeading.textContent = "Location";
  const locReadout = document.createElement("div");
  locReadout.className = "print-mode-readout print-mode-location-readout";
  const locActions = document.createElement("div");
  locActions.className = "print-mode-row";
  const searchBtn = document.createElement("button");
  searchBtn.type = "button";
  searchBtn.className = "print-mode-secondary";
  searchBtn.textContent = "Search location…";
  searchBtn.title = "Open the city/map picker";
  const changeBtn = document.createElement("button");
  changeBtn.type = "button";
  changeBtn.className = "print-mode-secondary";
  changeBtn.textContent = "Type lat/lon…";
  locActions.append(searchBtn, changeBtn);
  locField.append(locHeading, locReadout, locActions);
  panel.append(locField);

  searchBtn.addEventListener("click", () => {
    openPrintModeLocationPicker((pick) => {
      const job = getPrintJob();
      const next: typeof job.observation = {
        ...job.observation,
        location: { lat: pick.lat, lon: pick.lon, label: pick.label ?? null },
      };
      if (typeof pick.timeZone === "string") {
        next.timeZone = pick.timeZone;
      }
      if (typeof pick.utcOffsetMinutes === "number") {
        next.utcOffsetMinutes = pick.utcOffsetMinutes;
      }
      setPrintJob({ observation: next });
    });
  });

  changeBtn.addEventListener("click", () => {
    const job = getPrintJob();
    const cur = job.observation.location;
    const promptInitial = `${cur.lat.toFixed(4)}, ${cur.lon.toFixed(4)}`;
    const next = window.prompt(
      "Enter latitude, longitude (decimal degrees, comma-separated):",
      promptInitial,
    );
    if (next === null) return;
    const m = next.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) {
      window.alert("Could not parse. Use format: 43.7044, -72.2887");
      return;
    }
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      window.alert("Latitude must be in [-90, 90]; longitude in [-180, 180].");
      return;
    }
    const labelInput = window.prompt(
      "Optional location label (leave blank for none):",
      cur.label ?? "",
    );
    setPrintJob({
      observation: {
        ...job.observation,
        location: {
          lat,
          lon,
          label: labelInput && labelInput.trim().length > 0 ? labelInput.trim() : null,
        },
      },
    });
  });

  // ---- Facing direction ----
  const dirField = document.createElement("div");
  dirField.className = "print-mode-field";
  const dirHeading = document.createElement("span");
  dirHeading.textContent = "Facing direction";
  const dirRow = document.createElement("div");
  dirRow.className = "print-mode-row print-mode-direction-row";

  const dirInput = document.createElement("input");
  dirInput.type = "number";
  dirInput.min = "0";
  dirInput.max = "360";
  dirInput.step = "1";
  dirInput.className = "print-mode-input print-mode-direction-input";
  dirInput.setAttribute("aria-label", "Facing direction in degrees (0-360)");

  const dirSuffix = document.createElement("span");
  dirSuffix.className = "print-mode-suffix";
  dirSuffix.textContent = "°";

  // Tiny compass rose preview.
  const rose = svg("svg", {
    class: "print-mode-rose",
    width: 44,
    height: 44,
    viewBox: "0 0 44 44",
    "aria-hidden": "true",
  }) as SVGSVGElement;
  rose.append(
    svg("circle", {
      cx: 22,
      cy: 22,
      r: 20,
      fill: "rgba(255,255,255,0.04)",
      stroke: "rgba(255,255,255,0.22)",
      "stroke-width": 1,
    }),
  );
  const arrow = svg("path", {
    d: "M 22 5 L 18 22 L 22 18 L 26 22 Z",
    fill: "var(--accent)",
    stroke: "rgba(0,0,0,0.55)",
    "stroke-width": 0.6,
  });
  rose.append(arrow);
  // North label.
  const nLabel = svg("text", {
    x: 22,
    y: 36,
    "text-anchor": "middle",
    "font-size": 8,
    "font-weight": 600,
    fill: "var(--fg-muted)",
  });
  nLabel.textContent = "N";
  rose.append(nLabel);

  dirRow.append(dirInput, dirSuffix, rose);
  dirField.append(dirHeading, dirRow);
  panel.append(dirField);

  dirInput.addEventListener("change", () => {
    const job = getPrintJob();
    const raw = Number(dirInput.value);
    if (!Number.isFinite(raw)) return;
    const wrapped = ((raw % 360) + 360) % 360;
    setPrintJob({
      observation: {
        ...job.observation,
        bearingDeg: wrapped,
      },
    });
  });

  host.append(panel);

  // ---- Refresh from store ----
  const refresh = (): void => {
    const obs = getPrintJob().observation;
    if (dateInput.value !== obs.localDate) dateInput.value = obs.localDate;
    if (timeInput.value !== obs.localTime) timeInput.value = obs.localTime;
    const labelStr = obs.location.label ?? "(unlabelled)";
    locReadout.textContent = `${labelStr}\n${obs.location.lat.toFixed(4)}°, ${obs.location.lon.toFixed(4)}°`;
    const bear = ((obs.bearingDeg % 360) + 360) % 360;
    if (Number(dirInput.value) !== Math.round(bear)) {
      dirInput.value = String(Math.round(bear));
    }
    arrow.setAttribute("transform", `rotate(${bear} 22 22)`);
  };
  register(refresh);
}
