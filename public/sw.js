/**
 * FleetProof Service Worker
 *
 * Safe Application Shell and Static Asset Caching for Offline Driver Use.
 *
 * Rules:
 * - Cache‑first for versioned immutable static assets (/_next/static/…)
 * - Network‑only for navigations with an offline fallback page
 * - Do NOT cache API routes, RSC payloads, HTML, or any dynamic JSON
 * - All other requests are fetched from the network each time (no caching)
 * - Never touch IndexedDB data during activation
 */

const CACHE_NAME = "fleetproof-shell-v2";
const ESSENTIAL_ASSETS = [
  "/offline.html",
  "/manifest.json",
  "/icon-192.svg",
  "/icon-512.svg",
];

// Guard against execution in a non‑Service‑Worker environment (e.g., node tests)
if (typeof self !== "undefined") {
  // Install – pre‑cache the essential static assets
  self.addEventListener("install", (event) => {
    event.waitUntil(
      caches
        .open(CACHE_NAME)
        .then((cache) => cache.addAll(ESSENTIAL_ASSETS))
        .then(() => self.skipWaiting())
    );
  });

  // Activate – delete old caches
  self.addEventListener("activate", (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter((n) => n.startsWith("fleetproof-") && n !== CACHE_NAME)
              .map((n) => caches.delete(n))
          )
        )
        .then(() => self.clients.claim())
    );
  });

  // Fetch handling – delegated to a pure function for easy testing
  self.addEventListener("fetch", (event) => handleFetch(event));
}

/**
 * Core fetch logic.
 * Returns nothing (void) – side‑effects are performed via event.respondWith().
 */
function handleFetch(event) {
  const url = new URL(event.request.url);

  // 1️⃣ Never cache or intercept API routes
  if (url.pathname.startsWith("/api/")) return;

  // 2️⃣ Only handle GET requests
  if (event.request.method !== "GET") return;

  // 3️⃣ Immutable static assets – cache‑first
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((resp) => {
          if (resp.status === 200) {
            const ct = resp.headers.get("Content-Type") || "";
            if (!ct.startsWith("text/html")) {
              const clone = resp.clone();
              caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
            }
          }
          return resp;
        });
      })
    );
    return;
  }

  // 4️⃣ Navigations – network‑only with offline fallback
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/offline.html"))
    );
    return;
  }

  // 5️⃣ All other requests – network‑only (no caching). This block safely
  // covers RSC payloads (/_next/data/…), dynamic JSON, images, fonts, etc.
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
}

// Export for test environments (Node)
if (typeof module !== "undefined") {
  module.exports = { handleFetch };
}
