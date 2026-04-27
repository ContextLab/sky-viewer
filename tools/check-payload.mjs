// T063 / T060 — Payload budget check. Fails the build if:
//   * dist/index.html (with inlined main bundle) gzipped exceeds htmlGz.
//   * The INITIAL-LOAD code budget (HTML + dist/*.js — the synchronously
//     loaded entry chunk) gzipped exceeds initialCodeGz (200 KB per the
//     constitution + R13). Dynamic chunks under dist/chunks/ (jspdf,
//     html2canvas, etc.) are loaded on-demand and excluded from the
//     initial-load budget — they are reported but not gated.
//   * Total data files gzipped exceed dataGz.
// Aligns with plan.md Gate 1 and research.md R13.
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { gzipSync } from "node:zlib";

const DIST = resolve(process.cwd(), "dist");

const BUDGETS = {
  htmlGz: 220 * 1024, // HTML with inlined JS+CSS
  initialCodeGz: 200 * 1024, // INITIAL load: HTML + entry .js (constitution + R13)
  dataGz: 500 * 1024, // All data files combined gzipped
};

async function gzipSizeOf(path) {
  const buf = await readFile(path);
  return gzipSync(buf, { level: 9 }).length;
}

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function gzipFolderTotal(folder, ext) {
  let total = 0;
  if (!(await pathExists(folder))) return total;
  for (const f of await readdir(folder)) {
    if (ext && !f.endsWith(ext)) continue;
    const size = await gzipSizeOf(join(folder, f));
    console.log(`${folder.replace(DIST + "/", "")}/${f.padEnd(28)} gz=${size} B`);
    total += size;
  }
  return total;
}

async function main() {
  const htmlGz = await gzipSizeOf(resolve(DIST, "index.html"));
  console.log(`dist/index.html              gz=${htmlGz} B  budget=${BUDGETS.htmlGz} B`);

  // Initial-load budget = HTML (inlined main bundle) + entry-bundle
  // .js files at the dist root. Dynamic chunks under dist/chunks/ are
  // jspdf + transitive deps loaded ONLY when the user clicks Compute,
  // so they don't count against the initial-page-load budget.
  const rootJsGz = await gzipFolderTotal(DIST, ".js");
  const initialCodeGz = htmlGz + rootJsGz;
  console.log(
    `INITIAL load (HTML + entry)  gz=${initialCodeGz} B  budget=${BUDGETS.initialCodeGz} B`,
  );

  // Report dynamic chunks for visibility — they don't gate the build,
  // but the totals are useful in CI logs and for tracking jspdf weight.
  const chunksJsGz = await gzipFolderTotal(resolve(DIST, "chunks"), ".js");
  console.log(`dynamic chunks/ TOTAL        gz=${chunksJsGz} B  (on-demand, not gated)`);

  const dataDir = resolve(DIST, "data");
  let dataGz = 0;
  for (const f of await readdir(dataDir)) {
    const size = await gzipSizeOf(join(dataDir, f));
    console.log(`dist/data/${f.padEnd(24)} gz=${size} B`);
    dataGz += size;
  }
  console.log(`dist/data/* TOTAL            gz=${dataGz} B  budget=${BUDGETS.dataGz} B`);

  const fails = [];
  if (htmlGz > BUDGETS.htmlGz) fails.push(`HTML ${htmlGz} > ${BUDGETS.htmlGz}`);
  if (initialCodeGz > BUDGETS.initialCodeGz) {
    fails.push(`initial code ${initialCodeGz} > ${BUDGETS.initialCodeGz}`);
  }
  if (dataGz > BUDGETS.dataGz) fails.push(`data total ${dataGz} > ${BUDGETS.dataGz}`);

  if (fails.length) {
    console.error("\nPAYLOAD BUDGET EXCEEDED:\n  " + fails.join("\n  "));
    process.exit(1);
  }
  console.log("payload check: OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
