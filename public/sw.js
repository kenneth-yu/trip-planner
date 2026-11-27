const CACHE = "trips-offline-0798b9aaae43";
const NAVIGATION_TIMEOUT_MS = 8000;
const OFFLINE_PATH = "/offline";
const ICON_PATHS = ["/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png", "/icon.svg"];
const CACHED_PATHS = [OFFLINE_PATH, ...ICON_PATHS];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CACHED_PATHS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)))),
  );
});

async function navigate(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS);
  try {
    return await fetch(request, { signal: controller.signal });
  } catch (error) {
    const offline = await caches.match(OFFLINE_PATH);
    if (offline) return offline;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (request.mode === "navigate") {
    event.respondWith(navigate(request));
    return;
  }
  const url = new URL(request.url);
  if (url.origin === self.location.origin && ICON_PATHS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
  }
});
