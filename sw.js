/* CuriO — The Daybook service worker.
 * Goals: (1) work offline, (2) keep the "push to GitHub Pages = instantly live"
 * property, (3) require zero build step.
 *
 * Strategy:
 *   - Navigations (the HTML page): network-first, fall back to cache when offline.
 *     This means a fresh deploy is picked up as soon as the user is online, but the
 *     app still opens with no connection.
 *   - Everything else same-origin (css/js/images/icons/fonts): stale-while-revalidate
 *     — instant from cache, refreshed in the background.
 *   - Cross-origin (Google Fonts): cache-first runtime caching.
 *
 * Bump CACHE_VERSION whenever the precached shell changes.
 */
const CACHE_VERSION = "tle-v12";
const CACHE = CACHE_VERSION;

// Core app shell — cached on install so the app boots offline.
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./manifest.json",
  "./favicon.ico",
  "./favicon-16.png?v=4",
  "./favicon-32.png?v=4",
  "./apple-touch-icon.png?v=4",
  "./icon-192.png?v=4",
  "./icon-512.png?v=4",
  "./icon-192-maskable.png?v=4",
  "./icon-512-maskable.png?v=4",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Don't fail the whole install if one optional asset 404s.
      Promise.allSettled(PRECACHE.map((url) => cache.add(url)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 1. Page navigations: network-first (so deploys land), cache fallback for offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // 2. Google Fonts (cross-origin): cache-first.
  if (url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com") {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached || fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        }).catch(() => cached)
      )
    );
    return;
  }

  // 3. Same-origin assets: network-first (always latest when online, cache fallback offline).
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req))
    );
  }
});

// Show the daily reminder notification when periodic background sync fires.
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "curio-daily") {
    event.waitUntil(
      self.registration.showNotification("CuriO — The Daybook", {
        body: "Today's wonder is ready. ✦",
        icon: "icon-192.png?v=4",
        badge: "favicon-32.png?v=4",
        tag: "curio-daily",
      })
    );
  }
});

// Focus or open the app when a notification is tapped.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow("./");
    })
  );
});
