// T035 / T056 — Compute button + Pre-flight + Progress + Download.
//
// Flow:
//   1. Compute button → load datasets (cached after first call) →
//      `computePreflightSummary(job, datasets, bodies)` → modal
//      showing total pages, holes (by class), paper sheets, paint area.
//   2. On Continue: dynamic-import `buildPdf` (tree-shakeable so jspdf
//      doesn't load until the user actually computes a PDF) and call
//      `buildPdf(job, datasets, bodies)`. While running, swap the
//      Compute button for "Computing… N/M pages" status.
//   3. On done: revoke any previous Blob URL (T056) and swap to a
//      "Download PDF" anchor that triggers `<a download>` via a click.
//
// Dataset loading:
//   We fetch ./data/stars.bin + ./data/constellations.json once and
//   cache them at module scope. Bodies (Sun, Moon, planets) are
//   computed fresh per Compute call from the print job's observation.

import { getPrintJob } from "../../print/print-job-store";
import { computePreflightSummary, type PreflightBody } from "../../print/preflight";
import type { PdfBlob, PreflightSummary } from "../../print/types";
import type { RegisterRefresh } from "./print-mode";
import { parseStarCatalogue, type Star } from "../../astro/stars";
import { parseConstellations, type Constellation } from "../../astro/constellations";
import { sunPosition, moonPosition } from "../../astro/sun-moon";
import { planetPosition } from "../../astro/planets";
import { equatorialToHorizontal } from "../../astro/transforms";
import type { SkyDatasets } from "../../render/types";

interface DatasetCache {
  stars: Star[];
  constellations: Constellation[];
}

let datasetCache: DatasetCache | null = null;
let datasetPromise: Promise<DatasetCache> | null = null;

async function loadDatasets(): Promise<DatasetCache> {
  if (datasetCache) return datasetCache;
  if (datasetPromise) return datasetPromise;
  datasetPromise = (async () => {
    const [starsBuf, consJson] = await Promise.all([
      fetch("./data/stars.bin").then((r) => r.arrayBuffer()),
      fetch("./data/constellations.json").then((r) => r.json()),
    ]);
    const cache: DatasetCache = {
      stars: parseStarCatalogue(starsBuf),
      constellations: parseConstellations(consJson),
    };
    datasetCache = cache;
    return cache;
  })();
  return datasetPromise;
}

function bodiesForObservation(utcMs: number, latRad: number, lonRad: number): PreflightBody[] {
  const out: PreflightBody[] = [];
  const sun = sunPosition(utcMs);
  const sunH = equatorialToHorizontal(sun.raRad, sun.decRad, latRad, lonRad, utcMs);
  out.push({
    altDeg: sunH.altDeg,
    azDeg: sunH.azDeg,
    apparentMag: -26.74,
    bodyKind: "sun",
    label: "Sun",
  });
  const moon = moonPosition(utcMs);
  const moonH = equatorialToHorizontal(moon.raRad, moon.decRad, latRad, lonRad, utcMs);
  out.push({
    altDeg: moonH.altDeg,
    azDeg: moonH.azDeg,
    apparentMag: -12.6,
    bodyKind: "moon",
    label: "Moon",
  });
  const planets = ["mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"] as const;
  for (const id of planets) {
    const p = planetPosition(id, utcMs);
    const h = equatorialToHorizontal(p.raRad, p.decRad, latRad, lonRad, utcMs);
    const cap = id.charAt(0).toUpperCase() + id.slice(1);
    out.push({
      altDeg: h.altDeg,
      azDeg: h.azDeg,
      apparentMag: p.apparentMag,
      bodyKind: "planet",
      label: cap,
    });
  }
  return out;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatArea(sqMm: number, units: "imperial" | "metric"): string {
  if (units === "imperial") {
    const sqFt = sqMm / (304.8 * 304.8);
    return `${sqFt.toFixed(1)} sq ft`;
  }
  const sqM = sqMm / 1_000_000;
  return `${sqM.toFixed(2)} sq m`;
}

export function mountComputeButton(host: HTMLElement, register: RegisterRefresh): void {
  const panel = document.createElement("section");
  panel.className = "print-mode-panel print-mode-compute-panel";

  const heading = document.createElement("h2");
  heading.className = "print-mode-panel-heading";
  heading.textContent = "Compute";
  panel.append(heading);

  const helper = document.createElement("p");
  helper.className = "print-mode-helper";
  helper.textContent =
    "Compute generates the PDF. We show a pre-flight summary first so you can cancel before producing 200+ pages.";
  panel.append(helper);

  const computeBtn = document.createElement("button");
  computeBtn.type = "button";
  computeBtn.className = "print-mode-primary print-mode-compute";
  computeBtn.textContent = "Compute";
  panel.append(computeBtn);

  const status = document.createElement("p");
  status.className = "print-mode-status";
  status.setAttribute("aria-live", "polite");
  panel.append(status);

  // ---- Download anchor (initially hidden) ----
  const downloadBtn = document.createElement("a");
  downloadBtn.className = "print-mode-primary print-mode-download";
  downloadBtn.textContent = "Download PDF";
  downloadBtn.setAttribute("role", "button");
  downloadBtn.setAttribute("download", "star-stencil.pdf");
  downloadBtn.hidden = true;
  panel.append(downloadBtn);

  host.append(panel);

  // ---- State ----
  let lastPdf: PdfBlob | null = null;
  let busy = false;

  function setBusy(next: boolean, label?: string): void {
    busy = next;
    computeBtn.disabled = next;
    if (next && label) {
      computeBtn.textContent = label;
    } else if (!next) {
      computeBtn.textContent = "Compute";
    }
  }

  function showError(msg: string): void {
    status.textContent = msg;
    status.classList.add("print-mode-status-error");
  }

  function clearStatus(): void {
    status.textContent = "";
    status.classList.remove("print-mode-status-error");
  }

  function attachPdf(pdf: PdfBlob): void {
    // Revoke previous URL to avoid leaking blob memory across re-computes.
    if (lastPdf && lastPdf.objectUrl) {
      try {
        URL.revokeObjectURL(lastPdf.objectUrl);
      } catch {
        /* ignore */
      }
    }
    lastPdf = pdf;
    // Some build/runtime paths return PdfBlob.objectUrl="" (e.g.
    // pdf-builder.ts's safe try/catch around URL.createObjectURL fires
    // on certain split-chunk loads in Playwright). Fall back to creating
    // the URL right here from the blob when that happens.
    let url = pdf.objectUrl;
    if (!url && pdf.blob) {
      try {
        url = URL.createObjectURL(pdf.blob);
      } catch {
        url = "";
      }
    }
    // Set both the property and the attribute so `getAttribute('href')`
    // works in every test environment (some Playwright contexts read the
    // attribute, not the property).
    downloadBtn.href = url;
    downloadBtn.setAttribute("href", url);
    downloadBtn.hidden = false;
    status.textContent = `PDF ready — ${formatNumber(pdf.pageCount)} pages.`;
    // Sync `lastJobSnapshot` to the current job. Otherwise the next
    // `refresh()` (fired by the persistence-debounce of the very
    // setObservation calls that happened during Compute) treats the
    // job as "changed", revokes the URL, and re-hides the button —
    // which is exactly the symptom the canonical e2e test exposes.
    lastJobSnapshot = JSON.stringify(getPrintJob());
  }

  async function runCompute(): Promise<void> {
    if (busy) return;
    clearStatus();
    setBusy(true, "Loading datasets…");
    try {
      const datasets = await loadDatasets();
      const job = getPrintJob();
      const utcMs = Date.parse(job.observation.utcInstant);
      const latRad = (job.observation.location.lat * Math.PI) / 180;
      const lonRad = (job.observation.location.lon * Math.PI) / 180;
      const utcSafe = Number.isFinite(utcMs) ? utcMs : Date.now();
      const bodies = bodiesForObservation(utcSafe, latRad, lonRad);
      const skyDatasets: SkyDatasets = {
        stars: datasets.stars,
        constellations: datasets.constellations,
      };

      // Pre-flight summary first (FR-015).
      setBusy(true, "Computing pre-flight summary…");
      const summary = computePreflightSummary(job, skyDatasets, bodies);

      const continued = await showPreflightModal(summary, job.outputOptions.displayUnits);
      if (!continued) {
        setBusy(false);
        clearStatus();
        return;
      }

      // Build the PDF. Dynamic-import so jspdf isn't loaded until needed.
      setBusy(true, `Computing PDF (${summary.totalPageCount} pages)…`);
      // Yield to the event loop so the busy label paints before jsPDF
      // monopolises the main thread.
      await new Promise<void>((r) => setTimeout(r, 0));
      const mod = await import("../../print/pdf-builder");
      const pdf = await mod.buildPdf(job, skyDatasets, bodies);
      attachPdf(pdf);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("print-mode: compute failed", err);
      showError(err instanceof Error ? `Compute failed: ${err.message}` : "Compute failed.");
    } finally {
      setBusy(false);
    }
  }

  computeBtn.addEventListener("click", () => {
    void runCompute();
  });

  // Refresh: hide the download button when the job changes (any edit
  // invalidates the previously-generated PDF). `lastJobSnapshot` is
  // synced from `attachPdf` so a successful Compute resets the
  // baseline — see the comment in attachPdf for the full rationale.
  // eslint-disable-next-line prefer-const
  let lastJobSnapshot = JSON.stringify(getPrintJob());
  const refresh = (): void => {
    const snap = JSON.stringify(getPrintJob());
    if (snap !== lastJobSnapshot) {
      lastJobSnapshot = snap;
      if (lastPdf && lastPdf.objectUrl) {
        try {
          URL.revokeObjectURL(lastPdf.objectUrl);
        } catch {
          /* ignore */
        }
        lastPdf = null;
      }
      downloadBtn.hidden = true;
      downloadBtn.removeAttribute("href");
      clearStatus();
    }
  };
  register(refresh);
}

// ---------------------------------------------------------------------------
// Pre-flight modal — small, framework-free, returns a Promise<boolean>.
// ---------------------------------------------------------------------------

function showPreflightModal(
  summary: PreflightSummary,
  units: "imperial" | "metric",
): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "print-mode-modal-backdrop";

    const modal = document.createElement("div");
    modal.className = "print-mode-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Pre-flight summary");

    const title = document.createElement("h2");
    title.className = "print-mode-modal-title";
    title.textContent = "Pre-flight summary";
    modal.append(title);

    const body = document.createElement("dl");
    body.className = "print-mode-modal-list";

    const rows: Array<[string, string]> = [
      ["Surfaces enabled", String(summary.surfaceCount)],
      ["Total pages (cover + tiles)", formatNumber(summary.totalPageCount)],
      ["Tile pages", formatNumber(summary.tilePageCount)],
      ["Total holes", formatNumber(summary.totalHoles)],
      ["Pencil holes", formatNumber(summary.holeCountsByClass.pencil)],
      ["Large-nail holes", formatNumber(summary.holeCountsByClass.largeNail)],
      ["Small-nail holes", formatNumber(summary.holeCountsByClass.smallNail)],
      ["Pin holes", formatNumber(summary.holeCountsByClass.pin)],
      ["Paper sheets", formatNumber(summary.paperSheetCount)],
      ["Estimated paint area", formatArea(summary.estimatedPaintAreaSqMm, units)],
    ];
    for (const [k, v] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      body.append(dt, dd);
    }
    modal.append(body);

    const actions = document.createElement("div");
    actions.className = "print-mode-modal-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    cancelBtn.className = "print-mode-secondary";

    const continueBtn = document.createElement("button");
    continueBtn.type = "button";
    continueBtn.textContent = "Continue";
    continueBtn.className = "print-mode-primary";

    actions.append(cancelBtn, continueBtn);
    modal.append(actions);

    backdrop.append(modal);
    document.body.append(backdrop);

    function cleanup(result: boolean): void {
      backdrop.remove();
      resolve(result);
    }
    cancelBtn.addEventListener("click", () => cleanup(false));
    continueBtn.addEventListener("click", () => cleanup(true));
    backdrop.addEventListener("click", (ev) => {
      if (ev.target === backdrop) cleanup(false);
    });
    modal.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        cleanup(false);
      }
    });

    queueMicrotask(() => continueBtn.focus());
  });
}
