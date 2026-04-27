// T004 — esbuild bundler + dev server.
// Produces dist/app.js + dist/app.css from src/app/main.ts and src/styles.css.
// The inlining step (tools/inline-html.mjs) runs after this to emit dist/index.html.
import { build, context } from "esbuild";
import { writeFile, mkdir, copyFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";

const ROOT = process.cwd();
const OUT = resolve(ROOT, "dist");
const SERVE = process.argv.includes("--serve");

const sharedOptions = {
  entryPoints: {
    app: resolve(ROOT, "src/app/main.ts"),
    "sw/service-worker": resolve(ROOT, "src/sw/service-worker.ts"),
  },
  bundle: true,
  minify: !SERVE,
  sourcemap: SERVE,
  target: ["es2020"],
  format: "esm",
  // Code splitting: dynamic `import()` calls produce separate chunks loaded
  // on demand (e.g. jspdf inside src/print/* lazy-loads only when Print
  // Mode's Compute runs). Keeps the initial app payload under the
  // 200 KB-gzipped constitution budget.
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  outdir: OUT,
  metafile: true,
  loader: { ".glsl": "text" },
  define: { "process.env.NODE_ENV": SERVE ? '"development"' : '"production"' },
  logLevel: "info",
};

async function copyCss() {
  await mkdir(OUT, { recursive: true });
  await copyFile(resolve(ROOT, "src/styles.css"), resolve(OUT, "app.css"));
}

async function copyStaticAssets() {
  // Copy index.html shell and /data/* into dist/ so dev + prod both work.
  await copyFile(resolve(ROOT, "index.html"), resolve(OUT, "index.html"));
  const dataDir = resolve(ROOT, "data");
  if (existsSync(dataDir)) {
    const outData = resolve(OUT, "data");
    await mkdir(outData, { recursive: true });
    for (const entry of await readdir(dataDir, { withFileTypes: true })) {
      if (entry.isFile()) {
        await copyFile(resolve(dataDir, entry.name), resolve(outData, entry.name));
      }
    }
  }
}

if (SERVE) {
  const ctx = await context(sharedOptions);
  await ctx.watch();
  await copyCss();
  await copyStaticAssets();

  // Simple static HTTP server on :5173.
  const server = createServer((req, res) => {
    const urlPath = (req.url || "/").split("?")[0];
    const filePath = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
    const full = resolve(OUT, filePath);
    if (!existsSync(full)) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    const ext = filePath.split(".").pop() || "";
    const types = {
      html: "text/html; charset=utf-8",
      js: "application/javascript",
      css: "text/css",
      json: "application/json",
      svg: "image/svg+xml",
      bin: "application/octet-stream",
    };
    res.setHeader("Content-Type", types[ext] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    createReadStream(full).pipe(res);
  });
  server.listen(5173, () => console.log("dev server → http://localhost:5173/"));
} else {
  const result = await build(sharedOptions);
  await copyCss();
  await copyStaticAssets();
  await writeFile(resolve(OUT, "meta.json"), JSON.stringify(result.metafile, null, 2));
  console.log("build → dist/");
}
