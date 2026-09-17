/**
 * Readflow service worker — çevrimdışı okuma.
 *
 * Kural: yalnızca GET ve aynı origin. Sayfalar ağ-önce (network-first) alınır,
 * kopyası önbelleğe yazılır; ağ yoksa (Tailscale koptu, Mac uykuda) önbellekten
 * okunur. API istekleri ASLA önbelleğe alınmaz — bayat veri gösterip kullanıcıyı
 * yanıltmaktansa hata vermek doğrudur.
 */
const CACHE = "readflow-v1";
const OFFLINE_URL = "/offline";
/** Önbellekte tutulacak en fazla sayfa (en eskisi düşer). */
const MAX_PAGES = 60;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, "/icon-192.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  const pages = keys.filter((request) => !request.url.includes("/_next/"));
  for (const request of pages.slice(0, Math.max(0, pages.length - MAX_PAGES))) {
    await cache.delete(request);
  }
}

/** Sayfalar: ağ-önce, kopyası önbelleğe; ağ yoksa önbellek, o da yoksa çevrimdışı sayfası. */
async function pageStrategy(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      await cache.put(request, response.clone());
      await trim(cache);
    }
    return response;
  } catch {
    const cached = (await cache.match(request)) ?? (await cache.match(request.url.split("?")[0]));
    return cached ?? (await cache.match(OFFLINE_URL)) ?? Response.error();
  }
}

/** Statik varlıklar içerik-adresli: önbellek-önce. */
async function assetStrategy(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.endsWith(".png") || url.pathname.endsWith(".svg")) {
    event.respondWith(assetStrategy(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(pageStrategy(request));
  }
});
