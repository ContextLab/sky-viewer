// T061 — Service worker. Precaches the HTML shell + data files.
// Cache-first for same-origin; network-fallback for everything else.
// Covers FR-013 (offline after first load) and SC-010.

/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

const CACHE_VERSION = "sky-viewer-v1";
const PRECACHE: string[] = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./data/stars.bin",
  "./data/constellations.json",
  "./data/world.svg",
  "./data/cities.json",
  "./data/tz.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      await cache.addAll(PRECACHE).catch(() => {
        // If some files fail to cache (e.g. offline on first load), add
        // them one-by-one; swallow individual failures. We'll backfill
        // via the fetch handler below as they load normally.
        return Promise.all(
          PRECACHE.map((url) => cache.add(url).catch(() => {})),
        );
      });
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // FR-016: no third-party caching

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const net = await fetch(req);
        // Opportunistic backfill for anything same-origin that wasn't precached.
        if (net.ok) cache.put(req, net.clone()).catch(() => {});
        return net;
      } catch (err) {
        // Offline and not in cache: return 504.
        return new Response("offline", { status: 504, statusText: "Offline" });
      }
    })(),
  );
});

export {};
