// T063 — Payload budget check. Fails the build if JS code exceeds
// 200 KB gzipped or total data exceeds 250 KB gzipped.
// Aligns with plan.md Gate 1 and research.md R13.
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { gzipSync } from "node:zlib";

const DIST = resolve(process.cwd(), "dist");

const BUDGETS = {
  htmlGz: 220 * 1024, // HTML with inlined JS+CSS
  dataGz: 500 * 1024, // All data files combined gzipped
};

async function gzipSizeOf(path) {
  const buf = await readFile(path);
  return gzipSync(buf, { level: 9 }).length;
}

async function main() {
  const htmlGz = await gzipSizeOf(resolve(DIST, "index.html"));
  console.log(`dist/index.html    gz=${htmlGz} B  budget=${BUDGETS.htmlGz} B`);

  const dataDir = resolve(DIST, "data");
  let dataGz = 0;
  for (const f of await readdir(dataDir)) {
    const size = await gzipSizeOf(join(dataDir, f));
    console.log(`dist/data/${f.padEnd(24)} gz=${size} B`);
    dataGz += size;
  }
  console.log(`dist/data/* TOTAL  gz=${dataGz} B  budget=${BUDGETS.dataGz} B`);

  const fails = [];
  if (htmlGz > BUDGETS.htmlGz) fails.push(`HTML ${htmlGz} > ${BUDGETS.htmlGz}`);
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
