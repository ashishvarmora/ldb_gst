/*
 * Service worker. Deliberately the smallest one that makes the app installable.
 *
 * WHAT THIS DOES NOT CACHE, AND WHY IT MUST NOT
 *
 * Every page here is server-rendered against a Supabase auth cookie, and the
 * Cache Storage this worker owns is keyed by ORIGIN, not by user. Caching a
 * rendered page would therefore mean one officer's balance, trucks and records
 * sitting in a cache that the next person to sign in on the same phone can be
 * served from. On a shared device that is a data leak, not a stale page.
 *
 * So: no HTML is cached, no API response is cached, nothing carrying a cookie
 * is cached. The only things kept are content-hashed build assets, which are
 * immutable and hold no user data, and one offline notice.
 *
 * A fetch handler is also what Chrome requires before it will offer to install
 * an app at all, so the offline fallback below is doing double duty.
 */

/* Bump to throw away everything the previous worker kept. */
const VERSION = "v1";
const ASSETS = `assets-${VERSION}`;
const SHELL = `shell-${VERSION}`;

const OFFLINE_URL = "/offline";

/** The only HTML this worker is allowed to keep: it has no user data on it. */
const SHELL_URLS = [OFFLINE_URL, "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // Individually, so one 404 cannot fail the whole install.
      await Promise.allSettled(SHELL_URLS.map((url) => cache.add(new Request(url, { cache: "reload" }))));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([ASSETS, SHELL]);
      const names = await caches.keys();
      await Promise.all(names.filter((name) => !keep.has(name)).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

/** Content-hashed build output. The hash is the version, so it never goes stale. */
function isImmutableAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

/** Our own icons and manifest. Small, public, and wanted while offline. */
function isPublicIcon(url) {
  return /^\/(icon-|apple-icon|favicon)/.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Anything that changes state stays entirely between the page and the server.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Razorpay's checkout, Supabase's endpoints and every other cross-origin call
  // fall through above. What is left is our own GETs.

  if (isImmutableAsset(url) || isPublicIcon(url)) {
    event.respondWith(cacheFirst(request, isImmutableAsset(url) ? ASSETS : SHELL));
    return;
  }

  /*
   * A page. Always from the network - see the note at the top of this file -
   * and when the network is not there, the offline notice instead of the
   * browser's own error page. Nothing is written to a cache on this path.
   */
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(SHELL);
          const offline = await cache.match(OFFLINE_URL);
          return (
            offline ??
            new Response("You are offline.", {
              status: 503,
              headers: { "content-type": "text/plain; charset=utf-8" },
            })
          );
        }
      })(),
    );
  }

  // Everything else - data requests, server action posts' GET siblings, route
  // handlers - is left to the browser untouched.
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  // Opaque and error responses are not worth keeping, and a partial 206 cannot
  // be replayed from a cache correctly.
  if (response.ok && response.type === "basic") {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}
