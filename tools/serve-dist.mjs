// Preview server for `npm run preview` (used by Playwright).
// Serves dist/ at http://localhost:4173.
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const DIST = resolve(process.cwd(), "dist");
const PORT = 4173;

const TYPES = {
  html: "text/html; charset=utf-8",
  js: "application/javascript",
  mjs: "application/javascript",
  css: "text/css",
  json: "application/json",
  svg: "image/svg+xml",
  bin: "application/octet-stream",
  png: "image/png",
  jpg: "image/jpeg",
};

const server = createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];
  const filePath = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
  const full = resolve(DIST, filePath);
  if (!full.startsWith(DIST) || !existsSync(full)) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  try {
    const st = statSync(full);
    if (st.isDirectory()) {
      // Serve index.html from a directory, like most static servers.
      const idx = resolve(full, "index.html");
      if (!existsSync(idx)) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      // Fall through by resolving to the index.
      res.setHeader("Content-Type", TYPES.html);
      createReadStream(idx).pipe(res);
      return;
    }
  } catch {
    res.statusCode = 500;
    res.end("stat failed");
    return;
  }
  const ext = (filePath.split(".").pop() || "").toLowerCase();
  res.setHeader("Content-Type", TYPES[ext] ?? "application/octet-stream");
  res.setHeader("Cache-Control", "no-store");
  // Service worker scope: allow ./sw/service-worker.js from root.
  if (filePath === "sw/service-worker.js") {
    res.setHeader("Service-Worker-Allowed", "/");
  }
  createReadStream(full).pipe(res);
});

server.listen(PORT, () => console.log(`preview → http://localhost:${PORT}/`));
