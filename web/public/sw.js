// Passo Service Worker for Offline PWA Capabilities
// Bumped from v1: v1 cached Next's in-app navigation payloads (`?_rsc=`) cache-first and
// forever, so after a deploy a tab switch could be answered with another build's page
// data -- which Next rejects by reloading the whole app (white flash, everything
// fading back in). Activating v2 deletes that cache.
// v3: adds the push handlers below.
const CACHE_NAME = "passo-pwa-v3";
const STATIC_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Only handle GET requests and skip API or WebSocket requests
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Let API requests pass directly to network (handled by TanStack Query offline cache)
  if (url.pathname.startsWith("/api") || url.port === "8000") {
    return;
  }

  // Next's client-side navigations and prefetches (the page data behind every tab
  // switch) must always come from the server that built the running app. Never touch
  // them: a cached copy from another build makes Next fall back to a full page reload.
  if (url.searchParams.has("_rsc") || event.request.headers.get("RSC") === "1") {
    return;
  }

  // Network-first with cache fallback for HTML navigation
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        return caches.match("/");
      })
    );
    return;
  }

  // Cache-first only for files that can never change under the same URL: Next's
  // content-hashed build output, and the icons. Everything else goes to the network.
  const immutable =
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") || STATIC_ASSETS.includes(url.pathname));
  if (!immutable) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (
          !networkResponse ||
          networkResponse.status !== 200 ||
          networkResponse.type !== "basic"
        ) {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      });
    })
  );
});

// ---- push --------------------------------------------------------------------------
// Reminders sent by the server (training_plan/push.py) while the app is closed. The
// payload is {title, body, tag, url}; a tag replaces an earlier notification with the
// same one instead of stacking a second "Pranzo".
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Passo", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Passo";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || undefined,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url || "/today" },
      vibrate: [18, 60, 24],
      renotify: !!data.tag,
    })
  );
});

// Tapping the notification opens the app on the screen the reminder is about -- the
// already-open window if there is one, a new one otherwise.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/today", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

// The browser rotated the subscription: tell the server about the new one.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) => client.postMessage({ type: "passo-push-resubscribe" }));
    })
  );
});
