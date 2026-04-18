// T062 — Post-build HTML inliner.
// Reads dist/app.js and dist/app.css and inlines them into dist/index.html
// so the page loads as a single HTML document (per FR-001).
// The service worker and data files remain separate (precached by SW on install).
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DIST = resolve(process.cwd(), "dist");

async function main() {
  const html = await readFile(resolve(DIST, "index.html"), "utf8");
  const js = await readFile(resolve(DIST, "app.js"), "utf8");
  const css = await readFile(resolve(DIST, "app.css"), "utf8");

  // Inline CSS by replacing <link rel="stylesheet" ...>.
  // Inline JS by replacing <script type="module" src="./app.js"></script>.
  const withCss = html.replace(
    /<link\s+rel=["']stylesheet["']\s+href=["']\.\/app\.css["']\s*\/?>/i,
    `<style>\n${css}\n</style>`,
  );
  const withJs = withCss.replace(
    /<script\s+type=["']module["']\s+src=["']\.\/app\.js["']\s*>\s*<\/script>/i,
    `<script type="module">\n${js}\n</script>`,
  );

  await writeFile(resolve(DIST, "index.html"), withJs, "utf8");
  // Leave dist/app.js + dist/app.css around for the service worker to precache
  // (the SW caches them by their URL, even though the page no longer references them).
  console.log("inline-html: CSS + JS inlined into dist/index.html");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
